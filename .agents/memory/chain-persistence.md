---
name: Chain persistence layer
description: How the Emberchain ledger state is saved and loaded across restarts and deployments.
---

# Chain Persistence

## Storage strategy (dual write)
- **Primary:** PostgreSQL `chain_state` table — single JSONB row, id='main'. Survives redeploys because both dev and prod have their own Replit-managed PostgreSQL instances.
- **Fallback:** Local file at `artifacts/data/chain.json`. Used when the DB row is absent (first boot after migration). Keeps things running if PG is briefly unavailable.

## Startup sequence
1. `asyncLoadHook` (PG) tried first → returns state if row exists → log `[chain] State loaded from database.`
2. If PG returns null → `loadChainFile` (file) → log `[chain] State loaded from local file.`
3. If state loaded from file AND asyncPersistHook exists → immediately seeds the DB → log `[chain] Initial state seeded to database.`

## Write path
`persist()` is synchronous from the caller's view:
1. `saveChainFile()` — sync write to local file (instant, keeps file as backup)
2. `asyncPersistHook(data)` — fire-and-forget PG upsert, errors logged but not thrown

## Why
The deployed container filesystem is ephemeral — wiped on every redeploy. Before this change, mining rewards earned in the deployed app were lost on next publish. Now both dev and prod have independent persistent PostgreSQL state.

## Key files
- `artifacts/api-server/src/lib/db.ts` — `loadChainFromDB`, `saveChainToDB`, `createChainPersistenceHooks`
- `artifacts/api-server/src/lib/chain.ts` — passes hooks to `new Blockchain(dataFile, hooks)`
- `lib/chain-core/src/blockchain.ts` — constructor accepts `options.asyncLoadHook` and `options.asyncPersistHook`
- `lib/chain-core/src/persistence.ts` — unchanged; still handles the file path
- DB table: `chain_state (id TEXT PK, data JSONB, updated_at TIMESTAMPTZ)`
