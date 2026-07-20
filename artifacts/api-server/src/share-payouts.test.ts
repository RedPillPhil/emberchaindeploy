/**
 * Integration tests: proportional share-based mining payouts.
 *
 * Validates:
 *   - submitShare() enforces header invariants (difficulty, block number, parentHash)
 *   - Duplicate nonces are rejected
 *   - Proportional payout maths are correct across every edge case
 *   - Zero-share-round fallback credits the block finder
 *   - submitShare auto-promote path runs the same payout logic as submitMinedBlock
 *   - Share map and nonce dedupe set both survive a server restart
 *   - Total payouts always equal blockReward (no EMBR created or destroyed)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Blockchain, hashHeader, targetForDifficulty, MAX_TARGET } from "@workspace/chain-core";
import type { MinableHeader } from "@workspace/chain-core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLOCK_REWARD = 5_000_000_000_000_000_000n; // 5 EMBR (18 decimals)

/**
 * Low test difficulty so block-winning nonces are found near-instantly.
 *   blockTarget  = MAX_TARGET / 100  →  ~1% of hashes win the block
 *   shareTarget  = blockTarget × 64  →  ~64% of hashes are valid shares
 */
const TEST_DIFFICULTY = 100n;
const TEST_DIFF_STR   = TEST_DIFFICULTY.toString();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolves once the Blockchain has finished its async init. */
async function ready(chain: Blockchain): Promise<void> {
  await chain.listExchangeListings();
}

type TemplateHeader = {
  number: number;
  parentHash: string;
  timestamp: number;
  miner: string;
  difficulty: string;
  transactionsRoot: string;
};

/** Adapt a TemplateHeader (string difficulty) to the MinableHeader shape (bigint difficulty). */
function toMinable(h: TemplateHeader): MinableHeader {
  return {
    number: h.number,
    parentHash: h.parentHash as `0x${string}`,
    timestamp: h.timestamp,
    miner: h.miner as `0x${string}`,
    difficulty: BigInt(h.difficulty),
    transactionsRoot: h.transactionsRoot as `0x${string}`,
  };
}

/** Brute-forces a nonce whose hash meets the block target (≤ blockTarget). */
function findBlockNonce(header: TemplateHeader, blockTarget: bigint): { nonce: bigint; hex: string } {
  const minable = toMinable(header);
  let nonce = BigInt(Math.floor(Math.random() * 1_000_000));
  for (let i = 0; i < 5_000_000; i++) {
    const { hashValue, hashHex } = hashHeader(minable, nonce);
    if (hashValue <= blockTarget) return { nonce, hex: hashHex };
    nonce++;
  }
  throw new Error("findBlockNonce: no valid nonce found in 5M iterations");
}

/**
 * Brute-forces a nonce in (blockTarget, shareTarget] — accepted as a share
 * but does NOT auto-promote to a full block.
 */
function findShareOnlyNonce(
  header: TemplateHeader,
  blockTarget: bigint,
  shareTarget: bigint,
): { nonce: bigint } {
  const minable = toMinable(header);
  let nonce = BigInt(Math.floor(Math.random() * 1_000_000));
  for (let i = 0; i < 5_000_000; i++) {
    const { hashValue } = hashHeader(minable, nonce);
    if (hashValue > blockTarget && hashValue <= shareTarget) return { nonce };
    nonce++;
  }
  throw new Error("findShareOnlyNonce: no valid nonce in 5M iterations");
}

type WalletInfo = { address: string; privateKey: string };
type TemplateResult = {
  header: TemplateHeader;
  target: string;
  shareTarget: string;
  pendingTxHashes: string[];
};

interface TestCtx {
  chain:       Blockchain;
  dataFile:    string;
  walletA:     WalletInfo;
  walletB:     WalletInfo;
  walletC:     WalletInfo;
  template:    TemplateResult;
  blockTarget: bigint;
  shareTarget: bigint;
}

/**
 * Creates a fresh Blockchain with TEST_DIFFICULTY injected so nonce searches
 * complete in microseconds, plus three wallets and an initial template.
 */
async function setup(dir: string): Promise<TestCtx> {
  const dataFile = join(dir, "chain.json");

  // Bootstrap: init() does not call persist() for a brand-new genesis chain, so
  // we must trigger one explicit write before touching the file — same pattern
  // used in the replay-protection test suite.
  const bootstrap = new Blockchain(dataFile);
  await ready(bootstrap);
  await bootstrap.createWallet(); // forces first persist() → writes chain.json

  // Inject low test difficulty so block-winning nonces are found near-instantly.
  const raw = JSON.parse(readFileSync(dataFile, "utf-8"));
  raw.difficulty = TEST_DIFF_STR;
  writeFileSync(dataFile, JSON.stringify(raw));

  // Reload with the injected difficulty.
  const chain = new Blockchain(dataFile);
  await ready(chain);

  const walletA = (await chain.createWallet()) as WalletInfo;
  const walletB = (await chain.createWallet()) as WalletInfo;
  const walletC = (await chain.createWallet()) as WalletInfo;

  const template = (await chain.getMiningTemplate(walletC.address)) as TemplateResult;
  const blockTarget = BigInt(template.target);
  const shareTarget = BigInt(template.shareTarget);

  return { chain, dataFile, walletA, walletB, walletC, template, blockTarget, shareTarget };
}

/** Writes currentRoundShares directly into the persisted JSON file. */
function injectShares(dataFile: string, shares: [string, number][]): void {
  const raw = JSON.parse(readFileSync(dataFile, "utf-8"));
  raw.currentRoundShares = shares;
  writeFileSync(dataFile, JSON.stringify(raw));
}

// ---------------------------------------------------------------------------
// Test 1 — valid share is accepted and counted
// ---------------------------------------------------------------------------

test("valid share-only nonce is accepted and sharesInRound increments to 1", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sp-t1-"));
  try {
    const { chain, walletA, template, blockTarget, shareTarget } = await setup(dir);

    const { nonce } = findShareOnlyNonce(template.header, blockTarget, shareTarget);
    const result = await chain.submitShare({
      minerAddress: walletA.address,
      header: template.header,
      nonce: nonce.toString(),
    });

    assert.equal(result.accepted, true);
    assert.equal(result.shares, 1);
    assert.equal(result.blockFound, false);

    const status = chain.getMiningStatus();
    assert.equal(status.sharesInRound[walletA.address.toLowerCase()], 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2 — successive shares from the same miner accumulate
// ---------------------------------------------------------------------------

test("successive share submissions from the same miner accumulate the count", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sp-t2-"));
  try {
    const { chain, walletA, template, blockTarget, shareTarget } = await setup(dir);

    const { nonce: n1 } = findShareOnlyNonce(template.header, blockTarget, shareTarget);
    // Find a second distinct share-only nonce.
    let { nonce: n2 } = findShareOnlyNonce(template.header, blockTarget, shareTarget);
    if (n2 === n1) n2 = findShareOnlyNonce({ ...template.header }, blockTarget, shareTarget).nonce;

    await chain.submitShare({ minerAddress: walletA.address, header: template.header, nonce: n1.toString() });
    const r2 = await chain.submitShare({ minerAddress: walletA.address, header: template.header, nonce: n2.toString() });

    assert.equal(r2.shares, 2, "second submission should report cumulative count of 2");
    assert.equal(chain.getMiningStatus().sharesInRound[walletA.address.toLowerCase()], 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3 — forged difficulty is rejected
// ---------------------------------------------------------------------------

test("submitShare rejects a header whose difficulty does not match the chain", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sp-t3-"));
  try {
    const { chain, walletA, template } = await setup(dir);

    // Forge an artificially easy difficulty so almost any nonce passes share target.
    const forgedHeader = { ...template.header, difficulty: "1" };

    await assert.rejects(
      () => chain.submitShare({ minerAddress: walletA.address, header: forgedHeader, nonce: "42" }),
      /difficulty mismatch/i,
      "must reject a forged low difficulty",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4 — stale parentHash is rejected
// ---------------------------------------------------------------------------

test("submitShare rejects a header with a wrong parentHash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sp-t4-"));
  try {
    const { chain, walletA, template, blockTarget, shareTarget } = await setup(dir);

    const staleHeader = { ...template.header, parentHash: "0x" + "ab".repeat(32) };
    const { nonce } = findShareOnlyNonce(staleHeader, blockTarget, shareTarget);

    await assert.rejects(
      () => chain.submitShare({ minerAddress: walletA.address, header: staleHeader, nonce: nonce.toString() }),
      /stale share/i,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5 — wrong block number is rejected
// ---------------------------------------------------------------------------

test("submitShare rejects a header with the wrong block number", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sp-t5-"));
  try {
    const { chain, walletA, template, blockTarget, shareTarget } = await setup(dir);

    const wrongHeader = { ...template.header, number: 999 };
    const { nonce } = findShareOnlyNonce(wrongHeader, blockTarget, shareTarget);

    await assert.rejects(
      () => chain.submitShare({ minerAddress: walletA.address, header: wrongHeader, nonce: nonce.toString() }),
      /expected block number/i,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6 — duplicate nonce is rejected
// ---------------------------------------------------------------------------

test("submitShare rejects a duplicate nonce in the same round", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sp-t6-"));
  try {
    const { chain, walletA, template, blockTarget, shareTarget } = await setup(dir);

    const { nonce } = findShareOnlyNonce(template.header, blockTarget, shareTarget);
    await chain.submitShare({ minerAddress: walletA.address, header: template.header, nonce: nonce.toString() });

    await assert.rejects(
      () => chain.submitShare({ minerAddress: walletA.address, header: template.header, nonce: nonce.toString() }),
      /duplicate share/i,
      "second submission of the same nonce must be rejected",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 7 — zero-share round: block finder receives the full reward
// ---------------------------------------------------------------------------

test("block finder receives the full reward when no shares were submitted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sp-t7-"));
  try {
    const { chain, walletC, template, blockTarget } = await setup(dir);

    assert.deepEqual(chain.getMiningStatus().sharesInRound, {}, "round must start empty");

    const { nonce, hex } = findBlockNonce(template.header, blockTarget);
    const block = await chain.submitMinedBlock({
      minerAddress: walletC.address,
      header: template.header,
      nonce: nonce.toString(),
      blockHash: hex,
      pendingTxHashes: [],
    });

    assert.ok(block.payouts, "payouts map must be present");
    const payoutC = BigInt(block.payouts![walletC.address.toLowerCase()] ?? "0");
    assert.equal(payoutC, BLOCK_REWARD, "block finder should receive all 5 EMBR");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 8 — proportional payout: 3 shares vs 1 share → 75% / 25%
// ---------------------------------------------------------------------------

test("block finder C gets shareDifficultyDivisor (256) shares; A=3 and B=1 pre-submitted shares split the rest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sp-t8-"));
  try {
    const { dataFile, walletA, walletB, walletC, template, blockTarget } = await setup(dir);

    // A has 3 shares, B has 1 share pre-submitted.
    // C finds the block via submitMinedBlock with no prior shares.
    // submitMinedBlock credits C shareDifficultyDivisor (256) shares, so total = 260 shares.
    injectShares(dataFile, [
      [walletA.address.toLowerCase(), 3],
      [walletB.address.toLowerCase(), 1],
    ]);

    const chain2 = new Blockchain(dataFile);
    await ready(chain2);

    // Sanity-check the injected state is live.
    const status = chain2.getMiningStatus();
    assert.equal(status.sharesInRound[walletA.address.toLowerCase()], 3);
    assert.equal(status.sharesInRound[walletB.address.toLowerCase()], 1);

    const { nonce, hex } = findBlockNonce(template.header, blockTarget);
    const block = await chain2.submitMinedBlock({
      minerAddress: walletC.address,
      header: template.header,
      nonce: nonce.toString(),
      blockHash: hex,
      pendingTxHashes: [],
    });

    assert.ok(block.payouts, "payouts must be present");
    const payoutA = BigInt(block.payouts![walletA.address.toLowerCase()] ?? "0");
    const payoutB = BigInt(block.payouts![walletB.address.toLowerCase()] ?? "0");
    const payoutC = BigInt(block.payouts![walletC.address.toLowerCase()] ?? "0");

    // Total shares: A=3, B=1, C=256 (credited by submitMinedBlock) → 260 shares
    // A: BLOCK_REWARD × 3/260; B: BLOCK_REWARD × 1/260; C (last): absorbs dust
    const DIVISOR = 256n; // shareDifficultyDivisor
    const total = 3n + 1n + DIVISOR; // 260
    assert.equal(payoutA, BLOCK_REWARD * 3n / total, "miner A earns 3/260 of block reward");
    assert.equal(payoutB, BLOCK_REWARD * 1n / total, "miner B earns 1/260 of block reward");
    assert.equal(payoutC, BLOCK_REWARD - payoutA - payoutB, "block finder C earns 256/260 (absorbs dust)");
    assert.equal(payoutA + payoutB + payoutC, BLOCK_REWARD, "payouts must sum to exactly 5 EMBR");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 9 — auto-promote: submitShare with a block nonce triggers full payout
// ---------------------------------------------------------------------------

test("submitShare auto-promotes a block nonce and distributes payout proportionally", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sp-t9-"));
  try {
    const { dataFile, walletA, walletB, walletC, template, blockTarget } = await setup(dir);

    // Pre-inject 2 shares each for A and B.
    // submitShare for walletC will add 1 more share for C before applyBlock runs,
    // giving totals A=2, B=2, C=1 → 5 shares total.
    injectShares(dataFile, [
      [walletA.address.toLowerCase(), 2],
      [walletB.address.toLowerCase(), 2],
    ]);

    const chain2 = new Blockchain(dataFile);
    await ready(chain2);

    const { nonce } = findBlockNonce(template.header, blockTarget);
    const result = await chain2.submitShare({
      minerAddress: walletC.address,
      header: template.header,
      nonce: nonce.toString(),
    });

    assert.equal(result.accepted, true);
    assert.equal(result.blockFound, true, "block-winning nonce should set blockFound=true");

    const block = await chain2.getBlock(1);
    assert.ok(block, "block #1 must exist after auto-promote");
    assert.ok(block!.payouts, "payouts must be present on the promoted block");

    const payoutA = BigInt(block!.payouts![walletA.address.toLowerCase()] ?? "0");
    const payoutB = BigInt(block!.payouts![walletB.address.toLowerCase()] ?? "0");
    const payoutC = BigInt(block!.payouts![walletC.address.toLowerCase()] ?? "0");
    const total   = payoutA + payoutB + payoutC;

    assert.equal(total, BLOCK_REWARD, "payouts must sum to exactly 5 EMBR");
    assert.ok(payoutC > 0n, "block finder (walletC) earns their 1 share (1/5 = 20%)");
    assert.equal(payoutA, payoutB, "walletA and walletB with equal shares earn equal amounts");
    // C has 1 share, A and B have 2 each → A earns more than C
    assert.ok(payoutA > payoutC, "walletA's 2 shares should exceed walletC's 1 share");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 10 — share state survives a server restart
// ---------------------------------------------------------------------------

test("accumulated shares survive a server restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sp-t10-"));
  try {
    const { chain, dataFile, walletA, walletB, template, blockTarget, shareTarget } = await setup(dir);

    const { nonce: n1 } = findShareOnlyNonce(template.header, blockTarget, shareTarget);
    let { nonce: n2 }   = findShareOnlyNonce(template.header, blockTarget, shareTarget);
    while (n2 === n1) {
      n2 = findShareOnlyNonce(template.header, blockTarget, shareTarget).nonce;
    }

    await chain.submitShare({ minerAddress: walletA.address, header: template.header, nonce: n1.toString() });
    await chain.submitShare({ minerAddress: walletB.address, header: template.header, nonce: n2.toString() });

    // Verify the shares made it to disk.
    const raw = JSON.parse(readFileSync(dataFile, "utf-8"));
    assert.ok(
      Array.isArray(raw.currentRoundShares) && raw.currentRoundShares.length >= 2,
      "currentRoundShares must be persisted to disk",
    );

    // Simulate server restart.
    const chain2 = new Blockchain(dataFile);
    await ready(chain2);

    const status = chain2.getMiningStatus();
    assert.equal(status.sharesInRound[walletA.address.toLowerCase()], 1, "walletA share survives restart");
    assert.equal(status.sharesInRound[walletB.address.toLowerCase()], 1, "walletB share survives restart");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 11 — nonce dedupe set survives a server restart
// ---------------------------------------------------------------------------

test("a submitted nonce is still rejected as duplicate after a server restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sp-t11-"));
  try {
    const { chain, dataFile, walletA, template, blockTarget, shareTarget } = await setup(dir);

    const { nonce } = findShareOnlyNonce(template.header, blockTarget, shareTarget);
    await chain.submitShare({ minerAddress: walletA.address, header: template.header, nonce: nonce.toString() });

    // Verify it's on disk.
    const raw = JSON.parse(readFileSync(dataFile, "utf-8"));
    assert.ok(
      Array.isArray(raw.submittedShareNonces) && raw.submittedShareNonces.length > 0,
      "submittedShareNonces must be persisted",
    );

    // Simulate server restart.
    const chain2 = new Blockchain(dataFile);
    await ready(chain2);

    await assert.rejects(
      () => chain2.submitShare({ minerAddress: walletA.address, header: template.header, nonce: nonce.toString() }),
      /duplicate share/i,
      "nonce dedup must survive a server restart",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 12 — payout conservation: no EMBR is created or destroyed
// ---------------------------------------------------------------------------

test("total payouts equal block reward exactly for asymmetric share distributions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sp-t12-"));
  try {
    const { dataFile, walletA, walletB, walletC, template, blockTarget } = await setup(dir);

    // 7 + 3 = 10 total shares — stress-tests integer rounding.
    injectShares(dataFile, [
      [walletA.address.toLowerCase(), 7],
      [walletB.address.toLowerCase(), 3],
    ]);

    const chain2 = new Blockchain(dataFile);
    await ready(chain2);

    const { nonce, hex } = findBlockNonce(template.header, blockTarget);
    const block = await chain2.submitMinedBlock({
      minerAddress: walletC.address,
      header: template.header,
      nonce: nonce.toString(),
      blockHash: hex,
      pendingTxHashes: [],
    });

    assert.ok(block.payouts, "payouts must be present");
    const total = Object.values(block.payouts!).reduce((s, v) => s + BigInt(v), 0n);
    assert.equal(total, BLOCK_REWARD, "sum of payouts must equal exactly 5 EMBR — no EMBR lost to rounding");

    const payoutA = BigInt(block.payouts![walletA.address.toLowerCase()] ?? "0");
    const payoutB = BigInt(block.payouts![walletB.address.toLowerCase()] ?? "0");

    // 7:3 ratio → A earns more than B; rough check: A ≈ 2.33× B
    assert.ok(payoutA > payoutB, "miner with more shares must earn more");
    const ratio = Number(payoutA) / Number(payoutB);
    assert.ok(ratio > 2.2 && ratio < 2.5, `expected 7:3 ≈ 2.33× ratio, got ${ratio.toFixed(3)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
