// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IUniswapV2Router02.sol";

/**
 * @dev Mock Uniswap V2 Router for unit tests.
 *      Simulates swaps at a 1:1 rate and addLiquidityETH with no-op LP minting.
 *      The mock WETH address is set at deploy time.
 */
contract MockUniswapV2Router is IUniswapV2Router02 {
    using SafeERC20 for IERC20;

    address private _weth;
    address private _factory;

    /// @dev Multiplier for output amount: outputAmount = inputAmount * swapRate / 1e18
    ///      Default 1e18 = 1:1
    uint256 public swapRate = 1e18;

    constructor(address weth_, address factory_) {
        _weth = weth_;
        _factory = factory_;
    }

    function setSwapRate(uint256 rate) external {
        swapRate = rate;
    }

    function factory() external view override returns (address) { return _factory; }
    function WETH() external view override returns (address) { return _weth; }

    function addLiquidity(
        address, address, uint amountADesired, uint amountBDesired,
        uint, uint, address, uint
    ) external pure override returns (uint, uint, uint) {
        return (amountADesired, amountBDesired, amountADesired);
    }

    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint, uint,
        address to,
        uint
    ) external payable override returns (uint amountToken, uint amountETH, uint liquidity) {
        // Pull tokens from caller
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountTokenDesired);
        amountToken = amountTokenDesired;
        amountETH = msg.value;
        liquidity = amountTokenDesired + msg.value;
        // "LP tokens" — just return without minting anything for simplicity
        (amountToken, amountETH, liquidity);
    }

    function swapExactTokensForTokens(
        uint amountIn, uint,
        address[] calldata path,
        address to,
        uint
    ) external override returns (uint[] memory amounts) {
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        uint256 out = (amountIn * swapRate) / 1e18;
        amounts[path.length - 1] = out;

        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(path[path.length - 1]).safeTransfer(to, out);
    }

    function swapExactETHForTokens(
        uint,
        address[] calldata path,
        address to,
        uint
    ) external payable override returns (uint[] memory amounts) {
        uint256 out = (msg.value * swapRate) / 1e18;
        amounts = new uint[](path.length);
        amounts[0] = msg.value;
        amounts[path.length - 1] = out;
        IERC20(path[path.length - 1]).safeTransfer(to, out);
    }

    function swapExactTokensForETH(
        uint amountIn, uint,
        address[] calldata path,
        address to,
        uint
    ) external override returns (uint[] memory amounts) {
        uint256 out = (amountIn * swapRate) / 1e18;
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = out;
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        (bool ok, ) = to.call{value: out}("");
        require(ok, "Mock: ETH transfer failed");
    }

    function swapTokensForExactTokens(
        uint amountOut, uint amountInMax,
        address[] calldata path,
        address to,
        uint
    ) external override returns (uint[] memory amounts) {
        uint256 amountIn = (amountOut * 1e18) / swapRate;
        require(amountIn <= amountInMax, "Mock: excessive input");
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOut;
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(path[path.length - 1]).safeTransfer(to, amountOut);
    }

    /// @dev Simulates a token → exact ETH swap. Pulls input tokens, delivers native ETH to `to`.
    function swapTokensForExactETH(
        uint amountOut, uint amountInMax,
        address[] calldata path,
        address to,
        uint
    ) external override returns (uint[] memory amounts) {
        uint256 amountIn = (amountOut * 1e18) / swapRate;
        require(amountIn <= amountInMax, "Mock: excessive input");
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOut;
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        // Deliver native ETH to `to`
        (bool ok, ) = to.call{value: amountOut}("");
        require(ok, "Mock: ETH delivery failed");
    }

    function getAmountsOut(uint amountIn, address[] calldata path)
        external view override returns (uint[] memory amounts)
    {
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = (amountIn * swapRate) / 1e18;
    }

    function getAmountsIn(uint amountOut, address[] calldata path)
        external view override returns (uint[] memory amounts)
    {
        amounts = new uint[](path.length);
        amounts[path.length - 1] = amountOut;
        amounts[0] = (amountOut * 1e18) / swapRate;
    }

    receive() external payable {}
}
