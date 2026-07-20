---
name: Running TypeScript in this workspace
description: How to execute TypeScript files directly for testing/debugging in this pnpm monorepo
---

## Rule

Use `pnpm dlx tsx <file.ts>` from the package directory that owns the dependencies (e.g. `lib/chain-core`).

**Why:** The build pipeline uses esbuild with `moduleResolution: "bundler"` — it resolves extensionless TypeScript imports at bundle time. Plain `node --experimental-strip-types` fails on extensionless relative imports (Node's ESM resolver requires extensions). `tsx` handles this transparently and resolves node_modules from the nearest `package.json`.

**How to apply:**
- Place test/scratch scripts inside the package directory (not `/tmp`) so `node_modules` resolution finds workspace deps.
- Run: `cd lib/chain-core && pnpm dlx tsx my-test.ts`
- `pnpm dlx tsx` downloads tsx on demand if not cached — there is no global tsx binary in this workspace.
- `npx tsx` also works if `pnpm dlx` is slow, but `pnpm dlx` is preferred for consistency.
