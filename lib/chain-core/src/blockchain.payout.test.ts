/**
 * Proportional payout tests for Blockchain.submitShare() and applyBlock().
 *
 * Tested cases:
 *  1. Single miner receives 100% of blockReward (no fees, no transactions).
 *  2. Two miners receive proportional shares of blockReward.
 *  3. Rounding dust (integer division remainder) goes to the last share entry.
 *  4. Total distributed always equals blockReward + fees (no EMBR lost or over-issued).
 *  5. Zero-share fallback: when no shares exist, block finder gets 100%.
 *  6. submitShare rejects a duplicate nonce with "Duplicate share" error.
 *  7. submitShare rejects a stale parent hash with "Stale share" error.
 *  8. submitShare rejects a stale block number with "Stale share" error.
 *  9. submitShare rejects a difficulty mismatch with "Stale share" error.
 * 10. Block-finder with zero prior shares still gets credited after auto-promotion.
 * 11. Share map and nonce dedup set survive a mid-round server restart; payout
 *     remains proportional to pre-restart share counts.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Blockchain, EMBERCHAIN_CONFIG } from "./blockchain.js";
import { getBalance } from "./state.js";
import { hashHeader, MAX_TARGET } from "./mining.js";
import type { MinableHeader } from "./mining.js";
import type { PrefixedHexString } from "@ethereumjs/util";

// ─── Helpers ────────────────────────────────────────────────────────────────

const ADDR_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as PrefixedHexString;
const ADDR_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as PrefixedHexString;
const ADDR_C = "0xcccccccccccccccccccccccccccccccccccccccc" as PrefixedHexString;

/** Cast to any so we can poke private fields from tests. */
function priv(bc: Blockchain): any {
  return bc as any;
}

/** Build a minimal MinableHeader for the next block on top of `bc`. */
function nextHeader(bc: Blockchain, miner: PrefixedHexString): MinableHeader {
  const blocks: any[] = priv(bc).blocks;
  const parent = blocks[blocks.length - 1];
  return {
    number: parent.number + 1,
    parentHash: parent.hash as PrefixedHexString,
    timestamp: Date.now(),
    miner,
    difficulty: priv(bc).difficulty as bigint,
    transactionsRoot: "0x0000000000000000000000000000000000000000000000000000000000000000" as PrefixedHexString,
  };
}

/**
 * Find the smallest nonce whose hash meets `target` by trying 0, 1, 2, …
 * With difficulty=1 every nonce qualifies immediately (nonce 0 always works).
 */
function findNonce(header: MinableHeader, target: bigint): bigint {
  for (let n = 0n; n < 100_000n; n++) {
    const { hashValue } = hashHeader(header, n);
    if (hashValue <= target) return n;
  }
  throw new Error("Could not find a valid nonce within 100 000 attempts");
}

/**
 * Create a fresh Blockchain with difficulty set to 1 so any nonce meets both
 * the block target (MAX_TARGET / 1 = MAX_TARGET) and the share target (also
 * capped at MAX_TARGET).  Uses a temp directory so tests don't interfere.
 */
async function makeChain(tmpDir: string, id: string): Promise<Blockchain> {
  const bc = new Blockchain(join(tmpDir, `chain-${id}.json`));
  await bc.whenReady();
  // Difficulty 1 → blockTarget = MAX_TARGET → any hash is a valid block & share.
  priv(bc).difficulty = 1n;
  return bc;
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe("proportional payout — applyBlock()", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "emberchain-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("single miner receives 100% of blockReward", async () => {
    const bc = await makeChain(tmpDir, "single");
    const sm = priv(bc).stateManager;
    const header = nextHeader(bc, ADDR_A);
    const { hashHex, hashValue } = hashHeader(header, 0n);
    assert.ok(hashValue <= MAX_TARGET, "nonce 0 must meet target with difficulty=1");

    priv(bc).currentRoundShares = new Map([[ADDR_A.toLowerCase(), 3]]);

    await priv(bc).applyBlock(header, [], 0n, hashHex);

    const balA = await getBalance(sm, ADDR_A);
    const expected = BigInt(EMBERCHAIN_CONFIG.blockReward);
    assert.equal(balA, expected, `miner A should have the full block reward (${expected})`);
  });

  test("two miners receive proportional shares (3:1 split)", async () => {
    const bc = await makeChain(tmpDir, "two-miners");
    const sm = priv(bc).stateManager;
    const header = nextHeader(bc, ADDR_A);
    const { hashHex } = hashHeader(header, 0n);

    // A has 3 shares, B has 1 share → A gets 75%, B gets 25%.
    priv(bc).currentRoundShares = new Map([
      [ADDR_A.toLowerCase(), 3],
      [ADDR_B.toLowerCase(), 1],
    ]);

    await priv(bc).applyBlock(header, [], 0n, hashHex);

    const total = BigInt(EMBERCHAIN_CONFIG.blockReward);
    const balA = await getBalance(sm, ADDR_A);
    const balB = await getBalance(sm, ADDR_B);

    // A's expected share = total * 3 / 4 (integer division)
    const expectedA = (total * 3n) / 4n;
    // B gets the remainder (rounding dust goes to last entry)
    const expectedB = total - expectedA;

    assert.equal(balA, expectedA, `miner A should receive ${expectedA}`);
    assert.equal(balB, expectedB, `miner B should receive ${expectedB}`);
    assert.equal(balA + balB, total, "A + B must equal the total reward");
  });

  test("rounding dust goes to the last entry", async () => {
    const bc = await makeChain(tmpDir, "rounding");
    const sm = priv(bc).stateManager;
    const header = nextHeader(bc, ADDR_A);
    const { hashHex } = hashHeader(header, 0n);

    // 3 miners with equal shares → total / 3 may leave dust.
    // e.g. 5 EMBR (5_000_000_000_000_000_000) / 3 = 1_666_666_666_666_666_666 with remainder 2.
    priv(bc).currentRoundShares = new Map([
      [ADDR_A.toLowerCase(), 1],
      [ADDR_B.toLowerCase(), 1],
      [ADDR_C.toLowerCase(), 1],
    ]);

    await priv(bc).applyBlock(header, [], 0n, hashHex);

    const balA = await getBalance(sm, ADDR_A);
    const balB = await getBalance(sm, ADDR_B);
    const balC = await getBalance(sm, ADDR_C);
    const total = BigInt(EMBERCHAIN_CONFIG.blockReward);

    // All three balances together must equal total (no EMBR lost)
    assert.equal(balA + balB + balC, total, "all three payouts must sum to blockReward");

    // The first two get floor(total/3); C gets the remainder.
    const share = total / 3n;
    assert.equal(balA, share, "A should get floor(total/3)");
    assert.equal(balB, share, "B should get floor(total/3)");
    assert.equal(balC, total - 2n * share, "C absorbs the rounding dust");
  });

  test("total payouts always equal blockReward (no EMBR lost or over-issued)", async () => {
    // Run several different share distributions and confirm the invariant each time.
    const distributions: [number, number, number][] = [
      [1, 1, 0],
      [7, 3, 0],
      [1, 2, 3],
      [100, 1, 0],
      [51, 49, 0],
    ];
    for (const [a, b, c] of distributions) {
      const bc = await makeChain(tmpDir, `invariant-${a}-${b}-${c}`);
      const sm = priv(bc).stateManager;
      const header = nextHeader(bc, ADDR_A);
      const { hashHex } = hashHeader(header, 0n);

      const entries: [string, number][] = [];
      if (a) entries.push([ADDR_A.toLowerCase(), a]);
      if (b) entries.push([ADDR_B.toLowerCase(), b]);
      if (c) entries.push([ADDR_C.toLowerCase(), c]);
      priv(bc).currentRoundShares = new Map(entries);

      await priv(bc).applyBlock(header, [], 0n, hashHex);

      const total = BigInt(EMBERCHAIN_CONFIG.blockReward);
      const balA = a ? await getBalance(sm, ADDR_A) : 0n;
      const balB = b ? await getBalance(sm, ADDR_B) : 0n;
      const balC = c ? await getBalance(sm, ADDR_C) : 0n;

      assert.equal(
        balA + balB + balC,
        total,
        `distribution [${a},${b},${c}]: payouts must sum to blockReward`,
      );
    }
  });

  test("zero-share fallback credits block finder 100%", async () => {
    const bc = await makeChain(tmpDir, "zero-shares");
    const sm = priv(bc).stateManager;
    const header = nextHeader(bc, ADDR_B);
    const { hashHex } = hashHeader(header, 0n);

    // Intentionally leave currentRoundShares empty
    priv(bc).currentRoundShares = new Map();

    await priv(bc).applyBlock(header, [], 0n, hashHex);

    const balB = await getBalance(sm, ADDR_B);
    const expected = BigInt(EMBERCHAIN_CONFIG.blockReward);
    assert.equal(balB, expected, "block finder should receive the full reward when no shares exist");
  });
});

describe("submitShare() rejection cases", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "emberchain-share-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("duplicate nonce is rejected with 'Duplicate share' error", async () => {
    const bc = await makeChain(tmpDir, "dup");

    // Use a difficulty > 64 so the share target (difficulty/64 easier) is still
    // reachable, but a valid share nonce does NOT necessarily meet the full block
    // target.  This prevents the first submission from auto-promoting to a block
    // (which would advance the chain and make the second submission "stale"
    // rather than "duplicate").
    //
    // difficulty = 256 →
    //   blockTarget  = MAX_TARGET / 256
    //   shareTarget  = MAX_TARGET       (256 / 256 = 1, clamped to MAX_TARGET)
    //
    // We search for a nonce where:
    //   hashValue  > blockTarget   (not a full block)
    //   hashValue <= shareTarget   (valid share — all hashes qualify)
    const DIFFICULTY = 256n;
    priv(bc).difficulty = DIFFICULTY;

    const blocks: any[] = priv(bc).blocks;
    const parent = blocks[blocks.length - 1];
    const blockTarget = MAX_TARGET / DIFFICULTY;
    const shareTarget = MAX_TARGET / (DIFFICULTY / 64n); // = MAX_TARGET / 4

    const minableHdr: MinableHeader = {
      number: parent.number + 1,
      parentHash: parent.hash as PrefixedHexString,
      timestamp: Date.now(),
      miner: ADDR_A,
      difficulty: DIFFICULTY,
      transactionsRoot: "0x0000000000000000000000000000000000000000000000000000000000000000" as PrefixedHexString,
    };

    // Find a nonce that is a valid share but NOT a valid block.
    let shareOnlyNonce: bigint | null = null;
    for (let n = 0n; n < 1_000_000n; n++) {
      const { hashValue } = hashHeader(minableHdr, n);
      if (hashValue <= shareTarget && hashValue > blockTarget) {
        shareOnlyNonce = n;
        break;
      }
    }
    assert.ok(shareOnlyNonce !== null, "must find a share-only nonce within 1M attempts");

    const header = {
      number: parent.number + 1,
      parentHash: parent.hash as string,
      timestamp: minableHdr.timestamp,
      miner: ADDR_A as string,
      difficulty: DIFFICULTY.toString(),
      transactionsRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
    };

    // First submission must be accepted without promoting to a block.
    const r1 = await bc.submitShare({ minerAddress: ADDR_A, header, nonce: shareOnlyNonce!.toString() });
    assert.ok(r1.accepted, "first submission must be accepted");
    assert.ok(!r1.blockFound, "share-only nonce must NOT trigger block promotion");

    // Second submission of the exact same nonce must be rejected as a duplicate.
    await assert.rejects(
      () => bc.submitShare({ minerAddress: ADDR_A, header, nonce: shareOnlyNonce!.toString() }),
      (err: Error) => {
        assert.ok(err.message.startsWith("Duplicate share"), `expected 'Duplicate share', got: ${err.message}`);
        return true;
      },
    );
  });

  test("stale parent hash is rejected with 'Stale share' error", async () => {
    const bc = await makeChain(tmpDir, "stale-parent");
    const blocks: any[] = priv(bc).blocks;
    const parent = blocks[blocks.length - 1];

    const badParentHash = "0x" + "f".repeat(64); // definitely wrong hash

    await assert.rejects(
      () =>
        bc.submitShare({
          minerAddress: ADDR_A,
          header: {
            number: parent.number + 1,
            parentHash: badParentHash,
            timestamp: Date.now(),
            miner: ADDR_A,
            difficulty: "1",
            transactionsRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
          },
          nonce: "0",
        }),
      (err: Error) => {
        assert.ok(err.message.startsWith("Stale share"), `expected 'Stale share', got: ${err.message}`);
        return true;
      },
    );
  });

  test("stale block number is rejected with 'Stale share' error", async () => {
    const bc = await makeChain(tmpDir, "stale-number");
    const blocks: any[] = priv(bc).blocks;
    const parent = blocks[blocks.length - 1];

    await assert.rejects(
      () =>
        bc.submitShare({
          minerAddress: ADDR_A,
          header: {
            number: parent.number + 999, // wrong number
            parentHash: parent.hash as string,
            timestamp: Date.now(),
            miner: ADDR_A,
            difficulty: "1",
            transactionsRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
          },
          nonce: "0",
        }),
      (err: Error) => {
        assert.ok(err.message.startsWith("Stale share"), `expected 'Stale share', got: ${err.message}`);
        return true;
      },
    );
  });

  test("difficulty mismatch is rejected with 'Stale share' error", async () => {
    const bc = await makeChain(tmpDir, "stale-diff");
    const blocks: any[] = priv(bc).blocks;
    const parent = blocks[blocks.length - 1];

    await assert.rejects(
      () =>
        bc.submitShare({
          minerAddress: ADDR_A,
          header: {
            number: parent.number + 1,
            parentHash: parent.hash as string,
            timestamp: Date.now(),
            miner: ADDR_A,
            difficulty: "999999999", // doesn't match canonical difficulty=1
            transactionsRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
          },
          nonce: "0",
        }),
      (err: Error) => {
        assert.ok(err.message.startsWith("Stale share"), `expected 'Stale share', got: ${err.message}`);
        return true;
      },
    );
  });

  test("block-finder with zero prior shares earns their share via auto-promotion", async () => {
    const bc = await makeChain(tmpDir, "block-finder-zero-shares");
    const sm = priv(bc).stateManager;
    const blocks: any[] = priv(bc).blocks;
    const parent = blocks[blocks.length - 1];

    // Ensure no pre-existing shares so the auto-promotion path triggers the
    // zero-share fallback that credits the block finder 100%.
    priv(bc).currentRoundShares = new Map();

    const header = {
      number: parent.number + 1,
      parentHash: parent.hash as string,
      timestamp: Date.now(),
      miner: ADDR_C as string,
      difficulty: "1",
      transactionsRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
    };

    const result = await bc.submitShare({ minerAddress: ADDR_C, header, nonce: "0" });

    // With difficulty=1, every nonce meets the block target too.
    assert.ok(result.blockFound, "difficulty=1 should always trigger a block promotion");

    // Block was applied → ADDR_C should have received the full block reward.
    const balC = await getBalance(sm, ADDR_C);
    const expected = BigInt(EMBERCHAIN_CONFIG.blockReward);
    assert.equal(balC, expected, "block finder with no prior shares should receive the full reward");
  });
});

// ─── Restart-survival test ───────────────────────────────────────────────────

describe("mid-round server restart — share payout survives serialise/reload cycle", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "emberchain-restart-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("proportional payout uses pre-restart share counts after chain state is reloaded", async () => {
    // ── Phase 1: accumulate shares on the first instance ──────────────────────
    //
    // Use difficulty=256 so the share target (256× easier) equals MAX_TARGET,
    // meaning all hashes are valid shares.  We search for nonces that satisfy
    // the share requirement WITHOUT triggering a full block promotion, giving
    // us time to accumulate multiple shares before the round ends.
    const DIFFICULTY = 256n;
    const chainFile = join(tmpDir, "chain-restart-payout.json");

    const bc1 = new Blockchain(chainFile);
    await bc1.whenReady();
    priv(bc1).difficulty = DIFFICULTY;

    const blocks1: any[] = priv(bc1).blocks;
    const parent = blocks1[blocks1.length - 1];

    const blockTarget = MAX_TARGET / DIFFICULTY;
    const shareTarget = MAX_TARGET / (DIFFICULTY / 64n); // = MAX_TARGET / 4

    const minableHdr: MinableHeader = {
      number: parent.number + 1,
      parentHash: parent.hash as PrefixedHexString,
      timestamp: Date.now(),
      miner: ADDR_A,
      difficulty: DIFFICULTY,
      transactionsRoot: "0x0000000000000000000000000000000000000000000000000000000000000000" as PrefixedHexString,
    };

    const shareHeader = {
      number: parent.number + 1,
      parentHash: parent.hash as string,
      timestamp: minableHdr.timestamp,
      miner: ADDR_A as string,
      difficulty: DIFFICULTY.toString(),
      transactionsRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
    };

    // Collect nonces that are valid shares but NOT valid blocks.
    const shareOnlyNonces: bigint[] = [];
    for (let n = 0n; n < 1_000_000n && shareOnlyNonces.length < 3; n++) {
      const { hashValue } = hashHeader(minableHdr, n);
      if (hashValue <= shareTarget && hashValue > blockTarget) {
        shareOnlyNonces.push(n);
      }
    }
    assert.ok(shareOnlyNonces.length >= 3, "must find at least 3 share-only nonces within 1 M attempts");

    // ADDR_A submits 2 shares, ADDR_B submits 1 share.
    // Each submitShare call persists the updated share map to disk.
    const r1 = await bc1.submitShare({ minerAddress: ADDR_A, header: shareHeader, nonce: shareOnlyNonces[0]!.toString() });
    assert.ok(r1.accepted && !r1.blockFound, "first share must be accepted without block promotion");

    const r2 = await bc1.submitShare({ minerAddress: ADDR_A, header: shareHeader, nonce: shareOnlyNonces[1]!.toString() });
    assert.ok(r2.accepted && !r2.blockFound, "second share must be accepted without block promotion");

    const r3 = await bc1.submitShare({ minerAddress: ADDR_B, header: shareHeader, nonce: shareOnlyNonces[2]!.toString() });
    assert.ok(r3.accepted && !r3.blockFound, "third share (B) must be accepted without block promotion");

    // Verify the in-memory map is correct before simulating the restart.
    assert.equal(priv(bc1).currentRoundShares.get(ADDR_A.toLowerCase()), 2, "bc1: A must have 2 shares");
    assert.equal(priv(bc1).currentRoundShares.get(ADDR_B.toLowerCase()), 1, "bc1: B must have 1 share");

    // ── Phase 2: simulate a server restart ────────────────────────────────────
    //
    // Create a brand-new Blockchain instance from the same file.  This mirrors
    // a real process restart: all in-memory state is gone; only the persisted
    // JSON survives.
    const bc2 = new Blockchain(chainFile);
    await bc2.whenReady();

    // Confirm the share map was fully restored.
    assert.equal(
      priv(bc2).currentRoundShares.get(ADDR_A.toLowerCase()),
      2,
      "after restart: A's 2 shares must be restored from disk",
    );
    assert.equal(
      priv(bc2).currentRoundShares.get(ADDR_B.toLowerCase()),
      1,
      "after restart: B's 1 share must be restored from disk",
    );

    // Confirm the nonce dedup set was also restored (replaying an already-accepted
    // nonce on the new instance must still be rejected as a duplicate).
    const dedupeKey0 = `${parent.hash}:${shareOnlyNonces[0]!.toString()}`;
    assert.ok(
      priv(bc2).submittedShareNonces.has(dedupeKey0),
      "after restart: already-accepted nonce must still be in the dedup set",
    );

    // ── Phase 3: find the winning block on the restarted instance ─────────────
    //
    // Lower the difficulty to 1 so nonce 0 immediately meets the block target —
    // this keeps the test fast and deterministic without any PoW search.
    priv(bc2).difficulty = 1n;

    const sm2 = priv(bc2).stateManager;
    const hdr2 = nextHeader(bc2, ADDR_A);
    const { hashHex: winningHash } = hashHeader(hdr2, 0n);

    // applyBlock is private; cast through `any` to call it directly (same
    // pattern used throughout this test suite).
    await priv(bc2).applyBlock(hdr2, [], 0n, winningHash);

    // ── Phase 4: verify proportional payouts ──────────────────────────────────
    //
    // Share split: A=2, B=1 → total=3.
    // A receives floor(blockReward × 2 / 3); B receives the remainder.
    const total = BigInt(EMBERCHAIN_CONFIG.blockReward);
    const balA = await getBalance(sm2, ADDR_A);
    const balB = await getBalance(sm2, ADDR_B);

    const expectedA = (total * 2n) / 3n;
    const expectedB = total - expectedA; // absorbs rounding dust

    assert.equal(balA, expectedA, `A should receive 2/3 of blockReward (${expectedA})`);
    assert.equal(balB, expectedB, `B should receive 1/3 of blockReward + dust (${expectedB})`);
    assert.equal(balA + balB, total, "A + B must equal the full blockReward (no EMBR lost)");

    // The share map must be cleared after the block is applied.
    assert.equal(
      priv(bc2).currentRoundShares.size,
      0,
      "share map must be empty after the round closes",
    );
  });

  test("restarted instance rejects a duplicate nonce with 'Duplicate share' error", async () => {
    // ── Phase 1: submit a share on the first instance ─────────────────────────
    const DIFFICULTY = 256n;
    const chainFile = join(tmpDir, "chain-restart-dedup.json");

    const bc1 = new Blockchain(chainFile);
    await bc1.whenReady();
    priv(bc1).difficulty = DIFFICULTY;

    const blocks1: any[] = priv(bc1).blocks;
    const parent = blocks1[blocks1.length - 1];

    const blockTarget = MAX_TARGET / DIFFICULTY;
    const shareTarget = MAX_TARGET / (DIFFICULTY / 64n); // = MAX_TARGET / 4

    const minableHdr: MinableHeader = {
      number: parent.number + 1,
      parentHash: parent.hash as PrefixedHexString,
      timestamp: Date.now(),
      miner: ADDR_A,
      difficulty: DIFFICULTY,
      transactionsRoot: "0x0000000000000000000000000000000000000000000000000000000000000000" as PrefixedHexString,
    };

    // Find a nonce that qualifies as a share but NOT as a full block.
    let shareOnlyNonce: bigint | null = null;
    for (let n = 0n; n < 1_000_000n; n++) {
      const { hashValue } = hashHeader(minableHdr, n);
      if (hashValue <= shareTarget && hashValue > blockTarget) {
        shareOnlyNonce = n;
        break;
      }
    }
    assert.ok(shareOnlyNonce !== null, "must find a share-only nonce within 1M attempts");

    const shareHeader = {
      number: parent.number + 1,
      parentHash: parent.hash as string,
      timestamp: minableHdr.timestamp,
      miner: ADDR_A as string,
      difficulty: DIFFICULTY.toString(),
      transactionsRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
    };

    // Submit the share on bc1 — this persists the nonce to disk.
    const r1 = await bc1.submitShare({ minerAddress: ADDR_A, header: shareHeader, nonce: shareOnlyNonce!.toString() });
    assert.ok(r1.accepted && !r1.blockFound, "share must be accepted without block promotion");

    // ── Phase 2: simulate a server restart ────────────────────────────────────
    const bc2 = new Blockchain(chainFile);
    await bc2.whenReady();
    // Restore the same difficulty so the share header is still valid.
    priv(bc2).difficulty = DIFFICULTY;

    // ── Phase 3: re-submit the same nonce to the restarted instance ───────────
    // The persisted submittedShareNonces set must cause bc2 to reject this as a
    // duplicate even though bc2 is a brand-new in-memory instance.
    await assert.rejects(
      () => bc2.submitShare({ minerAddress: ADDR_A, header: shareHeader, nonce: shareOnlyNonce!.toString() }),
      (err: Error) => {
        assert.ok(
          err.message.startsWith("Duplicate share"),
          `expected 'Duplicate share', got: ${err.message}`,
        );
        return true;
      },
      "restarted instance must reject a previously-accepted nonce as a duplicate",
    );
  });
});
