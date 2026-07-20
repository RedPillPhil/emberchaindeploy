---
name: Browser mining architecture
description: How client-side PoW mining works — WebWorker, template API, submit flow, and hash compatibility.
---

# Browser Mining Architecture

## Why
The server used to mine blocks itself (fake from user's perspective). Mining now runs in the user's browser via a WebWorker — real keccak256 PoW on their CPU.

## Hash compatibility requirement
The WebWorker must produce the exact same hash as `lib/chain-core/src/mining.ts`:
```
keccak256(JSON.stringify({ number, parentHash, timestamp, miner, difficulty (decimal string), transactionsRoot, nonce (decimal string) }))
```
JSON key order must match. `difficulty` and `nonce` are BigInt, serialised as decimal strings.

## Flow
1. User clicks Ignite Forge → `GET /api/mining/template?minerAddress=0x…`
2. Server picks up to 40 pending txs (peek, NOT splice), returns `{ header, target (decimal bigint string), pendingTxHashes }`
3. Browser creates `artifacts/wallet/src/workers/mining.worker.ts` with `new Worker(new URL(...), { type: 'module' })`
4. Worker iterates nonces, posts `{ type: 'progress', hashRate, nonce, hash }` after each batch
5. Worker posts `{ type: 'found', nonce, blockHash }` when done
6. Main thread POSTs to `POST /api/mining/submit` with full header + winning nonce
7. Server validates PoW (`hashHeader(header, BigInt(nonce)).hashValue <= targetForDifficulty(BigInt(difficulty))`) and checks `parentHash === chain.tip.hash`
8. On success: txs pulled from mempool, `applyBlock` runs, difficulty retargets
9. On 409 "Stale template": browser fetches new template and restarts worker transparently

## Key files
- Worker: `artifacts/wallet/src/workers/mining.worker.ts`
- Blockchain methods: `getMiningTemplate()`, `submitMinedBlock()` in `lib/chain-core/src/blockchain.ts`
- API routes: `GET /mining/template`, `POST /mining/submit` in `artifacts/api-server/src/routes/mining.ts`
- Hooks: `useGetMiningTemplate`, `useSubmitBlock` in `lib/api-client-react/src/generated/api.ts`
- Page: `artifacts/wallet/src/pages/mining.tsx`

## Why
- `ethereum-cryptography` added to `@workspace/wallet` devDependencies so keccak is available in the browser bundle
- Worker uses `{ type: 'module' }` — Vite bundles it separately, imports work normally
- Intensity 1–5 maps to batchSizes 100/500/2000/8000/25000 (larger = more CPU, fewer yield points)

## Stale template handling
If `parentHash` doesn't match current chain tip, server returns 409. Browser silently fetches a fresh template and restarts. This is transparent to the user.
