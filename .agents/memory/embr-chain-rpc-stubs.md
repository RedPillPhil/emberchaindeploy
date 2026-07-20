---
name: EMBR chain RPC stubs that were incomplete
description: Two eth_ methods on the EMBR chain's JSON-RPC had stubs that broke Hardhat deployments; both are now fixed.
---

## eth_estimateGas was hardcoded to 21 000

`artifacts/api-server/src/routes/rpc.ts` returned `"0x5208"` (21 000) for all calls.
Hardhat uses that estimate as the transaction gas limit, so contract deployments ran out of gas immediately (status=0, only 21 000 gas used).

**Fix:** Added `Blockchain.estimateGas()` to `lib/chain-core/src/blockchain.ts` that dry-runs the call in a reversible EVM checkpoint and returns actual gas + 20% buffer. `eth_estimateGas` in rpc.ts now calls it.

**Why:** Any tooling that respects gas estimates (ethers.js, Hardhat, MetaMask) will silently fail to deploy contracts if this returns too low a value.

## eth_getCode always returned "0x"

Same file returned `"0x"` unconditionally. ethers.js calls `eth_getCode` after `waitForDeployment()` to confirm the contract is live; always returning `"0x"` would make every deployment appear to fail.

**Fix:** Added `Blockchain.getContractCode(address)` that reads from `stateManager.codeStack[0]` (where EthereumJS stores deployed bytecode). `eth_getCode` in rpc.ts now calls it.

## How to add methods to the Blockchain class

Pattern used in `callContract` and `estimateGas`:
```typescript
await this.stateManager.checkpoint();
try {
  const result = await this.evm.runCall({ ..., skipBalance: true });
  // use result
} finally {
  await this.stateManager.revert(); // always revert dry-runs
}
```
