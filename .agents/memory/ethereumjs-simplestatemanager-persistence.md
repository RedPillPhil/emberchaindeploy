---
name: EthereumJS SimpleStateManager for cheap persistence
description: How to persist EVM state cheaply without a real Merkle trie, using SimpleStateManager's checkpoint stack.
---

`@ethereumjs/statemanager`'s `SimpleStateManager` is an in-memory, Map-backed state manager EthereumJS ships specifically for cases where a full Merkle Patricia Trie is too heavy (single-node chains, test harnesses, hobby forks). It exposes the usual `getAccount`/`putAccount`/`getCode`/`putCode`/`getStorage`/`putStorage`/`checkpoint`/`commit`/`revert`/`shallowCopy` API.

Internally it keeps a checkpoint stack: `accountStack`, `codeStack`, `storageStack` — public arrays of Maps, one entry per checkpoint depth.

Key fact: after any `EVM.runCall()` completes — whether it succeeds or reverts — the stack always unwinds back to depth 1. So `accountStack[0]` / `codeStack[0]` / `storageStack[0]` is always the full, canonical state at rest between calls.

**Why this matters:** you don't need to separately track "which addresses exist" for persistence. Just dump/restore `stack[0]` of each Map as your serialized snapshot — no reachability walk needed.

**How to apply:** when building a custom single-node EVM chain that persists to disk (JSON file, KV store, etc.) and doesn't need a real state root/trie proof, reach for `SimpleStateManager` + this depth-1 dump/restore trick instead of standing up a full trie-backed `MerkleStateManager`.
