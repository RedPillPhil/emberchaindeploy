# EmberSwap Smart Contracts

Solidity contracts for the EmberSwap bridge and DEX on Base.

## Overview

Four contracts form the cross-chain infrastructure for EMBR:

| Contract | Chain | Purpose |
|---|---|---|
| `WrappedEMBR` | Base | ERC-20 representation of bridged EMBR (wEMBR) |
| `EmberchainBridge` | Base | Lock/mint on the Base side; relayer-controlled |
| `EmberBridge` | EMBR (7773) | Lock/release native EMBR on the EMBR chain |
| `EmberSwap` | Base | Uniswap V2 wrapper with 0.25% fee → EMBR liquidity + airdrop tracking |

## Bridge Flow

**EMBR → Base (bridging in)**
1. User calls `EmberBridge.lockEMBR{value: amount}(baseRecipient, nonce)` on chain 7773
2. Relayer watches for `BridgeOut` event, calls `EmberchainBridge.bridgeIn(recipient, amount, nonce)` on Base
3. wEMBR is minted to the recipient on Base

**Base → EMBR (bridging out)**
1. User calls `EmberchainBridge.bridgeOut(amount, embrRecipient, nonce)` on Base
2. wEMBR is burned; `BridgeOut` event emitted
3. Relayer calls `EmberBridge.releaseEMBR(recipient, amount, nonce)` on chain 7773
4. Native EMBR is released from escrow to the recipient

Nonce replay protection is permanent — a used nonce can never be reused across any number of restarts.

## EmberSwap Fee & Liquidity

Every swap through `EmberSwap` incurs a **0.25% protocol fee** on the input amount.

- The fee is converted to ETH (via Uniswap if the input is an ERC-20)
- Once the `autoLiquidityThreshold` accumulates (default 0.01 ETH), the contract automatically:
  1. Uses half the ETH to buy wEMBR via Uniswap
  2. Pairs it with the other half ETH and calls `addLiquidityETH`
  3. LP tokens remain in the contract as **protocol-owned liquidity** (permanently locked)

This deepens the wEMBR/ETH pool over time without any manual intervention.

## Airdrop Tracking

Every swap is tracked per wallet:
- `swapVolume[address]` — cumulative input token volume
- `swapCount[address]` — number of swaps

A `SwapTracked` event is emitted on every swap for off-chain indexing. Users are informed that their activity may qualify them for a future EMBR airdrop.

## Development

```bash
# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests (79 tests)
npx hardhat test

# Export ABIs to abis/
npx hardhat run scripts/export-abis.ts
```

## Deployment

```bash
# 1. Copy and fill in .env.example → .env
cp .env.example .env

# 2. Deploy to Base Sepolia (testnet)
pnpm deploy:testnet

# 3. Deploy EmberBridge to the EMBR chain
npx hardhat run scripts/deploy-embr-chain.ts --network embr

# 4. Export ABIs for relayer and UI
pnpm export-abis
```

Addresses are written to `deployed-addresses.json` after deployment.

## Deployed Addresses (Testnet)

See `deployed-addresses.json` — populated after `pnpm deploy:testnet`.

## Security Notes

- `WrappedEMBR.mint` and `burn` are gated to the bridge contract only
- `EmberchainBridge.bridgeIn` and `EmberBridge.releaseEMBR` are gated to the relayer address only
- All bridge functions have nonce-based replay protection
- All state-changing functions use `ReentrancyGuard`
- The relayer private key should be stored as an environment secret, never in code
- `EmberSwap` has `rescueETH` and `rescueToken` for emergency use (owner only)

## Contract Verification

After deployment, verify on Basescan:
```bash
npx hardhat verify --network base-sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

Set `BASESCAN_API_KEY` in `.env` first.
