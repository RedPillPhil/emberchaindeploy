---
name: ethereum-cryptography v3 secp256k1 API
description: Correct secp256k1 signing API for ethereum-cryptography 3.x, and why guessing from a hoisted @noble/curves version is unreliable.
---

`ethereum-cryptography` (checked at `3.2.0`) re-exports `secp256k1` straight from its own **internally pinned** `@noble/curves` dependency (`1.9.0` at time of writing) — found under `ethereum-cryptography`'s own `node_modules/@noble/curves`, not necessarily the version hoisted at the workspace root. A pnpm workspace can have a newer `@noble/curves` (e.g. `2.x`) hoisted at the top level with a materially different API; reading that version's `.d.ts` produces wrong guesses.

Confirmed real API surface for `@noble/curves@1.9.0`'s `secp256k1`:
- `secp256k1.utils.randomPrivateKey()` / `secp256k1.utils.isValidPrivateKey(bytes)` (not `randomSecretKey`/`isValidSecretKey` — those are a newer/different curves-version naming).
- `secp256k1.getPublicKey(privKeyBytes, false)` for uncompressed pubkey.
- `secp256k1.sign(msgHash, privKeyBytes, { prehash: false })` returns a `Signature` **object** (not raw bytes, and there is no `format: "recovered"` option on this version) — extract bytes via `sig.toCompactRawBytes()` (64 bytes r||s) and the recovery bit via `sig.recovery`.

**How to apply:** before trusting any `.d.ts` for a transitive crypto dependency in a pnpm monorepo, check which physical copy the importing package actually resolves (`node_modules/.pnpm/<pkg>/node_modules/<dep>`), not just whatever `.d.ts` shows up first in a workspace-wide search.
