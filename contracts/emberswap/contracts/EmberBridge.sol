// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title EmberBridge
 * @notice EMBR-chain-side bridge contract (chain ID 7773).
 *         EMBR is the native currency of the EMBR chain, so this contract
 *         holds native ETH-equivalent funds in escrow.
 *
 * Flow A — EMBR chain → Base (locking EMBR):
 *   1. User calls lockEMBR{value: amount}(baseRecipient).
 *   2. Contract holds the native EMBR in escrow and emits BridgeOut.
 *   3. Relayer mints wEMBR on Base via EmberchainBridge.bridgeIn().
 *
 * Flow B — Base → EMBR chain (releasing EMBR):
 *   1. User burns wEMBR on Base via EmberchainBridge.bridgeOut().
 *   2. Relayer calls releaseEMBR() here to return native EMBR to the user.
 *
 * Replay protection: nonces are tracked permanently in usedNonces.
 */
contract EmberBridge is Ownable, ReentrancyGuard {
    address public relayer;

    /// @dev nonce → used
    mapping(uint256 => bool) public usedNonces;

    /// @dev Total EMBR currently held in escrow
    uint256 public totalLocked;

    event BridgeOut(address indexed sender, address indexed baseRecipient, uint256 amount, uint256 indexed nonce);
    event BridgeIn(address indexed recipient, uint256 amount, uint256 indexed nonce);
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);

    modifier onlyRelayer() {
        require(msg.sender == relayer, "EmberBridge: caller is not the relayer");
        _;
    }

    constructor(address _relayer) Ownable(msg.sender) {
        require(_relayer != address(0), "EmberBridge: zero relayer");
        relayer = _relayer;
    }

    /**
     * @notice Lock native EMBR in escrow to bridge it to Base as wEMBR.
     * @param baseRecipient  The Base chain address that will receive wEMBR.
     * @param nonce          Unique nonce for this bridge request (generated off-chain or by the UI).
     */
    function lockEMBR(address baseRecipient, uint256 nonce) external payable nonReentrant {
        require(msg.value > 0, "EmberBridge: zero value");
        require(baseRecipient != address(0), "EmberBridge: zero recipient");
        require(!usedNonces[nonce], "EmberBridge: nonce already used");

        usedNonces[nonce] = true;
        totalLocked += msg.value;

        emit BridgeOut(msg.sender, baseRecipient, msg.value, nonce);
    }

    /**
     * @notice Release escrowed EMBR back to a user after they burned wEMBR on Base.
     *         Called exclusively by the relayer.
     * @param recipient  Address to receive the native EMBR.
     * @param amount     Amount of native EMBR (wei) to release.
     * @param nonce      Unique nonce from the Base BridgeOut event — prevents replay.
     */
    function releaseEMBR(
        address payable recipient,
        uint256 amount,
        uint256 nonce
    ) external onlyRelayer nonReentrant {
        require(recipient != address(0), "EmberBridge: zero recipient");
        require(amount > 0, "EmberBridge: zero amount");
        require(!usedNonces[nonce], "EmberBridge: nonce already used");
        require(address(this).balance >= amount, "EmberBridge: insufficient escrow");

        usedNonces[nonce] = true;
        totalLocked -= amount;

        (bool success, ) = recipient.call{value: amount}("");
        require(success, "EmberBridge: transfer failed");

        emit BridgeIn(recipient, amount, nonce);
    }

    /**
     * @notice Update the relayer address. Only owner.
     */
    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "EmberBridge: zero address");
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    receive() external payable {}
}
