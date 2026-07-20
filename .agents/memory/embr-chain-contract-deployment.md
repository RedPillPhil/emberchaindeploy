---
name: Deploying contracts to the EMBR chain
description: Lessons learned from deploying EmberBridge.sol to the custom EMBR chain (chain ID 7773) via Hardhat.
---

## The EMBR chain requires active mining to confirm txs

The EMBR chain only mines blocks when browser clients submit PoW shares. If no browser is open, pending transactions sit in the mempool forever and Hardhat's `waitForDeployment()` times out.

**Fix for deployment:** Start server-side mining via `POST /api/mining/start` with `{"minerAddress":"...","intensity":4}` before running the Hardhat script. Stop it afterward with `POST /api/mining/stop`.

**Why:** The chain is designed for browser miners. During automated deployments no browser is running, so the server must temporarily mine to confirm the deployment tx.

## New deployer addresses need EMBR for gas

A freshly-generated deployer key has 0 EMBR on the EMBR chain. The `submitRawEVMTransaction` balance check will reject the tx before it even reaches the mempool.

A temporary `bootstrapCredit` method was added to `Blockchain` for this purpose, exposed as a temporary admin route. After use, the route and its file (`routes/bootstrap.ts`) were deleted.

**Alternative for future deployments:** Simply send EMBR to the deployer address from any wallet that has funds.

## Hardhat telemetry blocks non-interactive shells

Hardhat prompts for telemetry consent on first run. In non-interactive environments this causes `readline was closed` and a non-zero exit. 

**Fix:** Always prefix Hardhat commands with `DO_NOT_TRACK=1 HARDHAT_DISABLE_TELEMETRY_PROMPT=true`.

Running commands as background jobs (`&`) re-triggers the prompt even after a prior foreground run said "yes" — always run Hardhat synchronously.

## Basescan verification requires V2 API config

The `@nomicfoundation/hardhat-verify` plugin now expects a single top-level `apiKey` (not per-network keys) for the Etherscan V2 API. The `customChains` entry for `base` must explicitly set `apiURL: "https://api.basescan.org/api"`.

Per-network keys still work mechanically but emit a deprecation error that causes non-zero exit in some environments.
