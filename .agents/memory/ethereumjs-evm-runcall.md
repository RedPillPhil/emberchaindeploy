---
name: EthereumJS EVM.runCall for lightweight chains
description: Why routing transfers/deploys/calls through EVM.runCall directly (instead of full @ethereumjs/tx + runTx) is enough for a custom chain.
---

`EVM.runCall()` (from `@ethereumjs/evm`) auto-detects CREATE vs CALL based on whether `message.to` is set, auto-increments the caller's nonce at checkpoint depth 0 (before any checkpoint, so it survives even if the call later reverts), auto-transfers `value`, and auto-reverts state changes (but not the nonce increment) on an exception.

**Why this matters:** for a custom/lightweight chain that doesn't need standard Ethereum RLP-encoded transactions or a real fee market, you can skip building `@ethereumjs/tx` objects and calling `runTx` entirely. Just construct your own lightweight signed-payload scheme, verify the signature yourself, then call `evm.runCall({ caller, to, value, data, gasLimit, ... })` directly for transfers, contract creation, and contract calls alike.

**How to apply:** reach for this when building a hobby/demo PoW or PoA chain that wants genuine EVM semantics (real opcodes, real gas accounting as a compute bound) without implementing the full Ethereum transaction/fee-market machinery. Also note `createEVM()` defaults to an `EVMMockBlockchain` when no `blockchain` option is passed — fine unless contracts use BLOCKHASH-dependent opcodes.
