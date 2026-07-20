// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title WrappedEMBR (wEMBR)
 * @notice ERC-20 representation of native EMBR on Base.
 *         Only the designated bridge contract may mint or burn tokens.
 *         The bridge address is set at deploy time and can be updated by the owner.
 */
contract WrappedEMBR is ERC20, Ownable {
    address public bridge;

    event BridgeUpdated(address indexed oldBridge, address indexed newBridge);

    modifier onlyBridge() {
        require(msg.sender == bridge, "wEMBR: caller is not the bridge");
        _;
    }

    constructor(address _bridge) ERC20("Wrapped EMBR", "wEMBR") Ownable(msg.sender) {
        require(_bridge != address(0), "wEMBR: zero bridge address");
        bridge = _bridge;
    }

    /**
     * @notice Mint wEMBR to a recipient. Called by the bridge when EMBR is locked on the EMBR chain.
     */
    function mint(address to, uint256 amount) external onlyBridge {
        _mint(to, amount);
    }

    /**
     * @notice Burn wEMBR from a holder. Called by the bridge when bridging back to EMBR chain.
     */
    function burn(address from, uint256 amount) external onlyBridge {
        _burn(from, amount);
    }

    /**
     * @notice Update the bridge contract address. Only owner.
     */
    function setBridge(address newBridge) external onlyOwner {
        require(newBridge != address(0), "wEMBR: zero address");
        emit BridgeUpdated(bridge, newBridge);
        bridge = newBridge;
    }
}
