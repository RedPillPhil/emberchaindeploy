import { keccak256 } from "ethereum-cryptography/keccak.js";
import type { PrefixedHexString } from "@ethereumjs/util";

export const MAX_TARGET = 2n ** 256n - 1n;

export interface MinableHeader {
  number: number;
  parentHash: PrefixedHexString;
  timestamp: number;
  miner: PrefixedHexString;
  difficulty: bigint;
  transactionsRoot: PrefixedHexString;
}

function encodeHeader(header: MinableHeader, nonce: bigint): Uint8Array {
  const json = JSON.stringify({
    number: header.number,
    parentHash: header.parentHash,
    timestamp: header.timestamp,
    miner: header.miner,
    difficulty: header.difficulty.toString(),
    transactionsRoot: header.transactionsRoot,
    nonce: nonce.toString(),
  });
  return new TextEncoder().encode(json);
}

export function targetForDifficulty(difficulty: bigint): bigint {
  if (difficulty <= 0n) return MAX_TARGET;
  return MAX_TARGET / difficulty;
}

export function hashHeader(header: MinableHeader, nonce: bigint): { hashHex: PrefixedHexString; hashValue: bigint } {
  const bytes = keccak256(encodeHeader(header, nonce));
  const hex = `0x${Buffer.from(bytes).toString("hex")}` as PrefixedHexString;
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return { hashHex: hex, hashValue: value };
}

/**
 * Runs proof-of-work in small batches, yielding to the event loop between
 * batches so the API server stays responsive while mining.
 *
 * Returns the winning nonce and block hash, or null if `shouldStop` fired.
 */
/**
 * Maps a user-facing intensity level (1–5) to a hashing batch size.
 * Larger batches = higher throughput but the API server yields less often.
 *   1 – Eco      ~100  H/batch  (gentle; server stays very responsive)
 *   2 – Balanced ~400  H/batch  (previous default)
 *   3 – High     ~1500 H/batch
 *   4 – Aggressive~5000 H/batch
 *   5 – Max      ~15000 H/batch (server eats a full core; API may lag)
 */
export function batchSizeForIntensity(intensity: number): number {
  const map: Record<number, number> = { 1: 100, 2: 400, 3: 1500, 4: 5000, 5: 15000 };
  return map[Math.max(1, Math.min(5, Math.round(intensity)))] ?? 400;
}

export async function mine(
  header: MinableHeader,
  shouldStop: () => boolean,
  onProgress?: (hashesTried: number) => void,
  batchSize = 400,
): Promise<{ nonce: bigint; hash: PrefixedHexString } | null> {
  const target = targetForDifficulty(header.difficulty);
  let nonce = BigInt(Math.floor(Math.random() * 1_000_000));
  let totalHashes = 0;

  for (;;) {
    if (shouldStop()) return null;
    for (let i = 0; i < batchSize; i++) {
      const { hashHex, hashValue } = hashHeader(header, nonce);
      totalHashes++;
      if (hashValue <= target) {
        onProgress?.(totalHashes);
        return { nonce, hash: hashHex };
      }
      nonce++;
    }
    onProgress?.(totalHashes);
    // Yield so Express requests keep flowing between hashing batches.
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Simple per-block retargeting: nudges difficulty toward the target block
 * time based on how long the previous block actually took to mine.
 */
export function retargetDifficulty(
  currentDifficulty: bigint,
  actualBlockTimeSeconds: number,
  targetBlockTimeSeconds: number,
): bigint {
  const MIN_DIFFICULTY = 1000n;
  if (actualBlockTimeSeconds <= 0) return currentDifficulty;

  const ratio = targetBlockTimeSeconds / actualBlockTimeSeconds;
  // Clamp adjustment to +/-25% per block so difficulty doesn't whipsaw.
  const clamped = Math.max(0.75, Math.min(1.25, ratio));
  const next = (currentDifficulty * BigInt(Math.round(clamped * 1000))) / 1000n;
  return next < MIN_DIFFICULTY ? MIN_DIFFICULTY : next;
}
