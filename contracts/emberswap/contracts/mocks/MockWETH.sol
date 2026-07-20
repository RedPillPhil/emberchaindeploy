// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @dev Mock WETH for unit tests.
 *      Supports deposit (ETH → WETH) and withdraw (WETH → ETH) so that
 *      EmberSwap._collectFeeAsETH can unwrap WETH fees to native ETH.
 */
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    /// @dev Mint WETH without requiring ETH — for pre-funding tests
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Deposit ETH and mint an equivalent amount of WETH
    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    /**
     * @dev Burn WETH from caller and send native ETH back.
     *      The contract must hold enough ETH (seeded via deposit or direct send).
     */
    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "MockWETH: ETH transfer failed");
    }

    receive() external payable {}
}
