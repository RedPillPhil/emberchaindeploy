# Memory Index

- [EMBR chain RPC stubs](embr-chain-rpc-stubs.md) — eth_estimateGas was hardcoded to 21k and eth_getCode always returned "0x"; both are now fixed and break Hardhat deployments if regressed.
- [EMBR chain contract deployment](embr-chain-contract-deployment.md) — requires server-side mining during deploy, deployer needs EMBR funded first, Hardhat needs DO_NOT_TRACK=1.
- [EMBR chain EVM concurrency lock](embr-chain-evm-lock.md) — production chain hangs on eth_sendRawTransaction under mining load; fixed with withEvmLock() serialising applyBlock/callContract/estimateGas/submitRawEVMTransaction.
- [EMBR chain production deployment pattern](embr-chain-prod-deploy-pattern.md) — external RPC eth_sendRawTransaction hangs on prod; use an internal server-side admin endpoint calling chain.submitRawEVMTransaction() directly to bypass HTTP timeouts.

- [Chain DB persistence strategy](db-persist-strategy.md) — shares use persist(false) to skip DB; only block closes and financial events hit the DB.

- [Chain persistence layer](chain-persistence.md) — PostgreSQL primary + local file fallback; seeded from file on first boot; ephemeral deployed filesystem was the bug.
- [Browser mining architecture](browser-mining-architecture.md) — WebWorker PoW, template/submit API, hash compatibility with server, stale-template 409 retry flow.
- [EthereumJS SimpleStateManager for cheap persistence](ethereumjs-simplestatemanager-persistence.md) — checkpoint stack always returns to depth 1 after `runCall`, so index 0 is always canonical state.
- [EIP-2200 original storage cache must be cleared per tx](eip2200-original-storage-per-tx.md) — `originalStorageCache` must be cleared before each runCall in applyBlock or REFUND_EXHAUSTED fires when two txs touch the same slot in one block.
- [ethereum-cryptography v3 secp256k1 API](ethereum-cryptography-secp256k1-api.md) — its bundled `@noble/curves` version differs from the workspace-hoisted one; API shapes are not interchangeable.
- [EthereumJS EVM.runCall for lightweight chains](ethereumjs-evm-runcall.md) — auto CREATE/CALL detection, nonce/value semantics, lets you skip building full RLP transactions.
- [Privacy pool blinding factor arithmetic](privacy-blinding-arithmetic.md) — correct way to balance Pedersen commitments across inputs/outputs/fee for the shielded pool.
- [Running TypeScript in this workspace](ts-execution-in-workspace.md) — use `pnpm dlx tsx` for one-off TS scripts; esbuild bundler handles extensionless imports at build time.
