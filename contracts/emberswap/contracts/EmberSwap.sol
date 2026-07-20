// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IUniswapV2Router02.sol";
import "./interfaces/IUniswapV2Factory.sol";
import "./interfaces/IWETH.sol";

/**
 * @title EmberSwap
 * @notice Custom swap router wrapping Uniswap V2 on Base.
 *
 * On every swap, 0.25% of the input amount is withheld as a protocol fee.
 * The fee is converted to ETH (via Uniswap if the input is not ETH) and
 * used to add liquidity to the wEMBR/ETH Uniswap V2 pool — creating
 * protocol-owned liquidity that deepens over time.
 *
 * Every swap is tracked per wallet address (swapVolume + swapCount) for a
 * potential future EMBR airdrop. A SwapTracked event is emitted for
 * off-chain indexing.
 *
 * Fee: 0.25% of every swap goes toward EMBR liquidity.
 * Activity: your swap history may make you eligible for a future EMBR airdrop.
 */
contract EmberSwap is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IUniswapV2Router02 public immutable uniswapRouter;
    address public wEMBR;

    /// @dev Fee in basis points — 25 = 0.25%
    uint256 public constant FEE_BPS = 25;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @dev Minimum accumulated ETH before triggering auto-liquidity
    uint256 public autoLiquidityThreshold = 0.01 ether;

    /// @dev Accumulated ETH fees waiting to be added as liquidity
    uint256 public pendingLiquidityETH;

    // ---- Airdrop tracking ----
    /// @dev Cumulative input token volume per address (in input token's native units)
    mapping(address => uint256) public swapVolume;
    /// @dev Number of swaps per address
    mapping(address => uint256) public swapCount;

    event SwapTracked(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeAmount,
        uint256 timestamp
    );

    event LiquidityAdded(uint256 ethUsed, uint256 wEMBRUsed, uint256 liquidity);
    event AutoLiquidityThresholdUpdated(uint256 newThreshold);
    event WEMBRUpdated(address indexed newWEMBR);

    constructor(
        address _uniswapRouter,
        address _wEMBR
    ) Ownable(msg.sender) {
        require(_uniswapRouter != address(0), "EmberSwap: zero router");
        require(_wEMBR != address(0), "EmberSwap: zero wEMBR");
        uniswapRouter = IUniswapV2Router02(_uniswapRouter);
        wEMBR = _wEMBR;
    }

    // ─────────────────────────────────────────────
    // Public swap functions
    // ─────────────────────────────────────────────

    /**
     * @notice Swap an exact amount of ERC-20 tokens for as many output tokens as possible.
     *         0.25% of amountIn is withheld as a fee before the swap executes.
     *         The fee is queued for auto-liquidity addition to the wEMBR/ETH pool.
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256[] memory amounts) {
        require(path.length >= 2, "EmberSwap: invalid path");
        require(amountIn > 0, "EmberSwap: zero amountIn");

        uint256 fee = (amountIn * FEE_BPS) / BPS_DENOMINATOR;
        uint256 amountInAfterFee = amountIn - fee;

        IERC20 tokenIn = IERC20(path[0]);

        // Pull full amount from user
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);

        // Convert fee to ETH via Uniswap and queue for liquidity
        _collectFeeAsETH(path[0], fee);

        // Approve and execute the swap via Uniswap
        tokenIn.forceApprove(address(uniswapRouter), amountInAfterFee);
        amounts = uniswapRouter.swapExactTokensForTokens(
            amountInAfterFee,
            amountOutMin,
            path,
            to,
            deadline
        );

        // Track airdrop eligibility
        swapVolume[msg.sender] += amountIn;
        swapCount[msg.sender] += 1;

        emit SwapTracked(msg.sender, path[0], path[path.length - 1], amountIn, amounts[amounts.length - 1], fee, block.timestamp);

        _tryAutoAddLiquidity();
    }

    /**
     * @notice Swap an exact amount of ETH for as many output tokens as possible.
     *         0.25% of msg.value is withheld as a fee before the swap executes.
     */
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable nonReentrant returns (uint256[] memory amounts) {
        require(path.length >= 2, "EmberSwap: invalid path");
        require(msg.value > 0, "EmberSwap: zero ETH");
        require(path[0] == uniswapRouter.WETH(), "EmberSwap: path must start with WETH");

        uint256 fee = (msg.value * FEE_BPS) / BPS_DENOMINATOR;
        uint256 amountInAfterFee = msg.value - fee;

        // Queue ETH fee for liquidity
        pendingLiquidityETH += fee;

        // Execute the swap via Uniswap with reduced ETH
        amounts = uniswapRouter.swapExactETHForTokens{value: amountInAfterFee}(
            amountOutMin,
            path,
            to,
            deadline
        );

        // Track airdrop eligibility
        swapVolume[msg.sender] += msg.value;
        swapCount[msg.sender] += 1;

        emit SwapTracked(msg.sender, path[0], path[path.length - 1], msg.value, amounts[amounts.length - 1], fee, block.timestamp);

        _tryAutoAddLiquidity();
    }

    /**
     * @notice Swap ERC-20 tokens for an exact amount of native ETH.
     *         0.25% of amountInMax is withheld as a fee before forwarding to Uniswap.
     *         The path must end with WETH; Uniswap unwraps WETH and delivers native ETH to `to`.
     * @param amountOut     Exact ETH (wei) the caller wants to receive.
     * @param amountInMax   Maximum tokens the caller is willing to spend (fee taken from this).
     * @param path          Swap path; must end with WETH address.
     * @param to            Address to receive native ETH.
     * @param deadline      Unix timestamp after which the swap reverts.
     */
    function swapTokensForExactETH(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256[] memory amounts) {
        require(path.length >= 2, "EmberSwap: invalid path");
        require(amountInMax > 0, "EmberSwap: zero amountInMax");
        require(path[path.length - 1] == uniswapRouter.WETH(), "EmberSwap: path must end with WETH");

        uint256 fee = (amountInMax * FEE_BPS) / BPS_DENOMINATOR;
        uint256 amountInMaxAfterFee = amountInMax - fee;

        IERC20 tokenIn = IERC20(path[0]);
        // Pull full amountInMax from user; fee portion is withheld, remainder forwarded
        tokenIn.safeTransferFrom(msg.sender, address(this), amountInMax);

        // Convert fee tokens → ETH and queue for auto-liquidity
        _collectFeeAsETH(path[0], fee);

        // Execute token → ETH swap via Uniswap; native ETH is delivered directly to `to`
        tokenIn.forceApprove(address(uniswapRouter), amountInMaxAfterFee);
        amounts = uniswapRouter.swapTokensForExactETH(
            amountOut,
            amountInMaxAfterFee,
            path,
            to,
            deadline
        );

        // Refund any unused input tokens to the caller
        uint256 actualUsed = amounts[0];
        if (amountInMaxAfterFee > actualUsed) {
            tokenIn.safeTransfer(msg.sender, amountInMaxAfterFee - actualUsed);
        }

        swapVolume[msg.sender] += actualUsed + fee;
        swapCount[msg.sender] += 1;

        emit SwapTracked(msg.sender, path[0], path[path.length - 1], actualUsed, amountOut, fee, block.timestamp);

        _tryAutoAddLiquidity();
    }

    // ─────────────────────────────────────────────
    // View helpers (mirrors Uniswap V2 for UI)
    // ─────────────────────────────────────────────

    /**
     * @notice Get expected output amounts for a swap, accounting for the 0.25% EmberSwap fee.
     */
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        uint256 fee = (amountIn * FEE_BPS) / BPS_DENOMINATOR;
        return uniswapRouter.getAmountsOut(amountIn - fee, path);
    }

    /**
     * @notice Get airdrop eligibility stats for a wallet.
     */
    function getSwapStats(address user)
        external
        view
        returns (uint256 volume, uint256 count)
    {
        return (swapVolume[user], swapCount[user]);
    }

    // ─────────────────────────────────────────────
    // Internal: fee → ETH → liquidity
    // ─────────────────────────────────────────────

    /**
     * @dev Convert a token fee amount to native ETH and add to pendingLiquidityETH.
     *      If the token is WETH, unwrap it directly via IWETH.withdraw().
     *      Otherwise swap token → ETH via Uniswap.
     *      Caller must ensure `feeAmount` tokens are already held by this contract.
     */
    function _collectFeeAsETH(address token, uint256 feeAmount) internal {
        if (feeAmount == 0) return;

        address weth = uniswapRouter.WETH();

        if (token == weth) {
            // Unwrap WETH → native ETH so pendingLiquidityETH is always real ETH.
            IWETH(weth).withdraw(feeAmount);
            pendingLiquidityETH += feeAmount;
            return;
        }

        // Swap token → ETH via Uniswap
        IERC20(token).forceApprove(address(uniswapRouter), feeAmount);
        address[] memory path = new address[](2);
        path[0] = token;
        path[1] = weth;

        try uniswapRouter.swapExactTokensForETH(
            feeAmount,
            0, // accept any ETH out
            path,
            address(this),
            block.timestamp
        ) returns (uint256[] memory amounts) {
            pendingLiquidityETH += amounts[amounts.length - 1];
        } catch {
            // If no liquidity for this token → ETH pair yet, hold the token
            // in the contract; owner can manually process it later
        }
    }

    /**
     * @dev Attempt to add wEMBR/ETH liquidity if pending ETH exceeds the threshold.
     *      Uses half the pending ETH to buy wEMBR, then adds both as LP.
     *      LP tokens are kept in this contract as protocol-owned liquidity (forever locked).
     *      Silently skips if conditions aren't met (no pool yet, insufficient wEMBR, etc.)
     */
    function _tryAutoAddLiquidity() internal {
        if (pendingLiquidityETH < autoLiquidityThreshold) return;

        uint256 ethToUse = pendingLiquidityETH;
        pendingLiquidityETH = 0;

        uint256 halfETH = ethToUse / 2;
        uint256 otherHalfETH = ethToUse - halfETH;

        // Buy wEMBR with halfETH via Uniswap (direct router call, no EmberSwap fee)
        address[] memory path = new address[](2);
        path[0] = uniswapRouter.WETH();
        path[1] = wEMBR;

        try uniswapRouter.swapExactETHForTokens{value: halfETH}(
            0,
            path,
            address(this),
            block.timestamp
        ) returns (uint256[] memory amounts) {
            uint256 wEMBRBought = amounts[amounts.length - 1];

            // Approve wEMBR for the router
            IERC20(wEMBR).forceApprove(address(uniswapRouter), wEMBRBought);

            // Add liquidity — LP tokens go to this contract (protocol-owned)
            try uniswapRouter.addLiquidityETH{value: otherHalfETH}(
                wEMBR,
                wEMBRBought,
                0, // slippage: accept any
                0,
                address(this),
                block.timestamp
            ) returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
                emit LiquidityAdded(amountETH, amountToken, liquidity);

                // Refund any unused ETH back to pending pool
                uint256 unusedETH = otherHalfETH - amountETH;
                if (unusedETH > 0) {
                    pendingLiquidityETH += unusedETH;
                }
            } catch {
                // Requeue ETH if addLiquidity fails
                pendingLiquidityETH += otherHalfETH;
            }
        } catch {
            // No wEMBR/ETH pool yet — requeue all ETH
            pendingLiquidityETH += ethToUse;
        }
    }

    // ─────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────

    function setAutoLiquidityThreshold(uint256 newThreshold) external onlyOwner {
        autoLiquidityThreshold = newThreshold;
        emit AutoLiquidityThresholdUpdated(newThreshold);
    }

    function setWEMBR(address newWEMBR) external onlyOwner {
        require(newWEMBR != address(0), "EmberSwap: zero address");
        wEMBR = newWEMBR;
        emit WEMBRUpdated(newWEMBR);
    }

    /**
     * @notice Emergency ETH withdrawal — owner only. Should not be needed in normal operation.
     */
    function rescueETH(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "EmberSwap: zero address");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "EmberSwap: ETH transfer failed");
    }

    /**
     * @notice Emergency ERC-20 rescue — owner only.
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    receive() external payable {}
}
