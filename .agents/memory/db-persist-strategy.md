---
name: Chain DB Persistence Strategy
description: Which events save to DB vs local file only, and why shares are excluded from DB writes.
---

# Chain DB Persistence Strategy

## The Rule
`persist(toDB = true)` in `blockchain.ts` — pass `false` only for share submissions.

- **Block close (`applyBlock`)** → `persist()` (default, toDB=true) — must be durable
- **Share submission (`submitShare`)** → `persist(false)` — file only, shares are transient
- **All other events** (transactions, exchange listings, init) → `persist()` (default, toDB=true)

## Why
At max mining intensity, share submissions arrive 10–20× per second. Each `persist(true)` call fires an async DB upsert. With a pool of 5 connections and a 3s timeout, they queue up and start timing out — causing silent save failures. When the production server recycles, it reloads from the last successful DB save, rolling back any blocks mined since then (users lose earned EMBR).

## Why shares are safe to skip
Shares reset every round (when a block is found). If the server restarts mid-round, the current round's shares are lost — but the next round starts fresh. No EMBR is lost; miners just re-accumulate shares in the new round. This is standard behavior for any mining pool.

## How to apply
- If you add a new high-frequency event to `submitShare` or a similar hot path, always use `persist(false)`.
- Any event that changes balances, block history, or exchange state must use `persist()` (toDB=true).
- The local file save happens on every `persist()` call regardless of `toDB`, providing crash safety within a session.

## Future: multiple nodes
The single-node architecture means all state lives in one DB. Multi-node requires a P2P gossip layer (block propagation, chain sync, fork resolution) — a significant project. The current fix is appropriate for the single-node phase.
