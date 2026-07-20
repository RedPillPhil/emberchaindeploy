---
name: Privacy pool blinding factor arithmetic
description: How to correctly compute output blinding factors so Pedersen commitment balance checks pass for shield/private-send/unshield
---

## Rule

For `verifyCommitmentBalance(inputCommitments, outputCommitments, fee)` to hold, you need:

```
sum(input blindings) == sum(output blindings)   [mod CURVE_ORDER]
```

The `fee` term has zero blinding (it's a transparent value), so it doesn't affect the blinding sum.

**How to apply:**

- Compute `inputBlindingSum = mod(sum of all input note blindings)`.
- Assign **random** blindings to all outputs except the **last** one.
- Set the last output's blinding to `mod(inputBlindingSum - sum(earlier output blindings))`.

**Private send** (2 outputs: recipient + change):
- `recipientBlinding = randomBlindingFactor()`
- `changeBlinding = mod(inputBlindingSum - recipientBlinding)`

**Private send** (1 output, no change):
- `recipientBlinding = inputBlindingSum` (must carry the full sum; no freedom to randomize)

**Unshield** (treats the unshielded amount as the "fee" parameter in `verifyCommitmentBalance`):
- Change output (if any) uses `changeBlinding = inputBlindingSum` directly (all other blinding absorbed here, since the "fee" = unshielded amount has no blinding term to track)

**Why:** `verifyCommitmentBalance` checks `sum(inC) - sum(outC) - fee*G == identity`. The G term cancels because `sum(input amounts) = sum(output amounts) + fee` by coin selection. The H term cancels only if `sum(input blindings) = sum(output blindings)`.

**How to test:**
```ts
const ok = verifyCommitmentBalance([pedersenCommit(100n, b1)], [pedersenCommit(90n, b2), pedersenCommit(9n, b3)], 1n);
// ok === true iff b1 === b2 + b3 mod CURVE_ORDER
```
