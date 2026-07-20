# Emberchain

A single-node, self-hosted proof-of-work blockchain (ticker **EMBR**) with a real EVM for smart contracts, plus a web wallet to create wallets, send transactions, deploy/call contracts, and mine — all from the browser.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (chain engine lives behind this)
- `pnpm --filter @workspace/wallet run dev` — run the wallet frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `DATABASE_URL` — Postgres connection string (provisioned but not currently used by the chain itself; chain state is a JSON file, see below)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Chain engine: `lib/chain-core` — custom PoW consensus + EthereumJS (`@ethereumjs/evm`, `@ethereumjs/statemanager`, `@ethereumjs/common`, `@ethereumjs/util`) for real EVM execution, `ethereum-cryptography` (secp256k1/keccak256) for wallet crypto and signing
- DB: PostgreSQL + Drizzle ORM (provisioned, unused by the chain — see Architecture decisions)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Frontend: React + Vite, Tailwind, wouter, TanStack Query
- Build: esbuild (CJS bundle)

## Where things live

- `lib/chain-core/src` — the chain engine: `blockchain.ts` (Blockchain class: wallets, tx submission, mining loop, chain reads, **shielded pool**), `mining.ts` (PoW hashing/retargeting), `crypto.ts` (wallet keys, signing), `state.ts` (EVM state manager wrapper), `persistence.ts` (JSON file load/save), `common.ts` (EthereumJS Common config).
- `lib/chain-core/src/privacy/` — Monero-style privacy primitives: `curve.ts` (EC helpers, hash-to-curve), `stealth.ts` (stealth addresses via ECDH), `commitments.ts` (Pedersen commitments), `note-cipher.ts` (keccak-CTR symmetric note encryption), `ring.ts` (LSAG linkable ring signatures).
- `artifacts/api-server/src/routes/{wallets,chain,transactions,contracts,mining,privacy}.ts` — REST routes wrapping the `Blockchain` singleton (`src/lib/chain.ts`).
- `artifacts/api-server/data/chain.json` — persisted chain state (gitignored). Delete it to reset the chain to genesis.
- `lib/api-spec/openapi.yaml` — source of truth for the API contract.
- `artifacts/wallet` — the wallet frontend artifact (previewPath `/`). Includes **Privacy** page (`src/pages/privacy.tsx`).

## Architecture decisions

- **No real Merkle/state trie.** State is an in-memory `SimpleStateManager` (EthereumJS's own flat Map-backed manager for exactly this "too heavy for a full trie" case), persisted as a flat JSON dump. `stateRoot` on blocks is just the block hash, not a real root — acceptable because this is a single-node chain with no external verifiers to convince.
- **No gas fee market.** Gas limit is a pure compute bound (bounds EVM execution), not an economic mechanism — there's no gas price and no fee deducted. Simplification for a hobby fork; revisit if multi-party trust or spam resistance ever matters.
- **Custom lightweight signed-tx scheme, not full Ethereum RLP transactions.** Transactions go straight through `EVM.runCall()` rather than `@ethereumjs/tx` + `runTx`, since `runCall` already auto-detects CREATE vs CALL, auto-increments nonce, and auto-transfers value.
- **Server-side signing (security tradeoff, called out to the user).** The API takes the sender's raw private key in the request body and signs server-side. This is fine for a personal/demo single-node chain but is NOT how a production wallet should work — a real product would sign client-side and never transmit the private key.
- **PoW consensus is custom, EthereumJS `Common` is borrowed only for EVM opcode/gas semantics** (`createCustomCommon` on a Cancun hardfork config) — Emberchain's actual mining/difficulty/reward logic doesn't depend on any PoS assumptions from Common.

## Product

- Create or import an EMBR wallet (private key shown once).
- Check balance/nonce, view chain status and recent blocks/transactions.
- **Public transactions**: Send EMBR between addresses (fully visible, contract-capable).
- **Private transactions (shielded pool)**: Shield public EMBR into hidden notes → send privately → unshield back to a public address. Sender, recipient, and amount are hidden during a private send; only the shield/unshield boundaries are visible.
- Deploy smart contracts and make read-only contract calls.
- Start/stop mining to a chosen wallet address directly from the wallet UI, with live hash rate/difficulty/blocks-mined feedback.

## Privacy model & known limitations

The shielded pool uses Monero-style cryptography:
- **Stealth addresses** (ECDH): each note is sent to a one-time address derived from a Diffie-Hellman shared secret between sender and recipient. Only the recipient's private key can recognize and spend it.
- **Pedersen commitments**: hide amounts on-chain; commitment-balance checks prove value conservation without revealing amounts.
- **LSAG ring signatures**: hide which note was actually spent by including decoys from the unspent note pool in each signature. Ring size is `min(available unspent notes, 4 decoys) + 1 real`.
- **Linkable key images**: prevent double-spending without revealing which note was spent.

**Documented limitations (out of scope by design):**
- **No zero-knowledge range proofs** (Bulletproofs). Amount non-negativity is enforced by a server-side plaintext bounds check, not a trustless cryptographic proof. An operator could observe note plaintexts. This is consistent with the existing server-side-signing trust model.
- **Shield and unshield boundaries are visible**: source address + amount (on shield) and destination address + amount (on unshield) are recorded in the public shielded ledger. This is the same design as Zcash's transparent↔shielded transactions.
- **Anonymity set is small** in early use: ring signature decoys come from the pool of existing unspent notes. With few private transactions, the real signer is more guessable — users are warned on the Privacy screen.
- **Private contract calls / NFTs / DeFi**: not supported. Private transactions are EMBR-value transfers only; smart contract interactions stay on the public path.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `ethereum-cryptography` (installed at `3.2.0`) pins its own `@noble/curves@1.9.0` internally — this differs from whatever `@noble/curves` version may be hoisted at the workspace root, and the two have different APIs (e.g. `secp256k1.sign()` returns a `Signature` object with `.toCompactRawBytes()`/`.recovery` in 1.x, not a raw byte array). Always check the actually-resolved `@noble/curves` version under `ethereum-cryptography`'s own `node_modules` before trusting its `.d.ts`.
- After any `EVM.runCall()` completes (success or revert), `SimpleStateManager`'s internal checkpoint stack always returns to depth 1 — so `accountStack[0]`/`codeStack[0]`/`storageStack[0]` is always the full canonical state. This is what makes cheap dump/restore persistence possible without tracking "known addresses" separately.
- Delete `artifacts/api-server/data/chain.json` to reset the chain to genesis (new genesis timestamp is fixed at 2026-01-01, so balances/blocks start clean).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
