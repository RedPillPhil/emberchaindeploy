---
name: EIP-2200 original storage cache must be cleared per transaction
description: applyBlock runs multiple runCall()s without resetting originalStorageCache, causing spurious REFUND_EXHAUSTED if two txs in the same block touch the same storage slot.
---

## Rule
Call `(stateManager as any).originalStorageCache?.clear?.()` before each `runCall` in `applyBlock`.

## Why
`OriginalStorageCache.put()` only stores a slot's value on its **first** access (never overwrites). It is never cleared between transactions in the same block. When tx1 (e.g. `releaseEMBR`) sets `totalLocked` from 5→0, the cache records original=5. When tx2 (`lockEMBR`) then writes `totalLocked` from 0→amount, EIP-2200 gas logic sees: original=5 (non-zero, from cache), current=0 (canonical after tx1), new value=amount (non-zero). This hits the `subRefund(sstoreClearRefundEIP2200Gas)` path. Since gasRefund starts at 0 for tx2, `gasRefund -= 4800` goes negative → `REFUND_EXHAUSTED`.

## How to apply
Any time a new transaction is about to execute in `applyBlock`, clear the cache first so EIP-2200 treats the pre-this-transaction committed state as "original", not the pre-block state.

The fix is in `lib/chain-core/src/blockchain.ts` inside `applyBlock`, at the top of the per-tx loop.
