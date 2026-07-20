/**
 * Browser mining WebWorker — runs keccak256 proof-of-work on the user's CPU.
 *
 * Ported from the working Python desktop miner:
 *   - 48-bit random starting nonce (matches Python's random.randint(0, 2**48))
 *   - Auto-refreshes template after MAX_HASHES_PER_TEMPLATE iterations (matches
 *     Python's `if hashes >= 2000000: break` outer-loop behaviour)
 *
 * NOTE: Unlike the Python miner, we do NOT break after every share.  The Python
 * script can afford to do so because subprocess startup + HTTP latency naturally
 * throttles the loop.  In the browser at low difficulty the share target is very
 * easy, so breaking after every share creates an infinite template-fetch storm.
 * We report shares and keep hashing; template refreshes only happen on the
 * MAX_HASHES_PER_TEMPLATE boundary (or after a block find).
 *
 * Message contract
 * ─────────────────
 * Receive { type:'start', header, target, shareTarget, batchSize }  → begin grinding nonces
 * Receive { type:'stop' }                                           → halt and ack
 *
 * Send { type:'progress', hashRate, nonce, hash }  → periodic update
 * Send { type:'share', nonce }                     → nonce meets shareTarget; hashing continues
 * Send { type:'found', nonce, blockHash }          → nonce meets block target; worker stops
 * Send { type:'needTemplate' }                     → MAX_HASHES_PER_TEMPLATE reached; worker pauses
 * Send { type:'stopped' }                          → acknowledged stop
 */

import { keccak256 } from "ethereum-cryptography/keccak.js";

export interface WorkerHeader {
  number: number;
  parentHash: string;
  timestamp: number;
  miner: string;
  /** bigint serialised as decimal string */
  difficulty: string;
  transactionsRoot: string;
}

export type ToWorkerMsg =
  | { type: "start"; header: WorkerHeader; target: string; shareTarget: string; batchSize: number }
  | { type: "stop" };

export type FromWorkerMsg =
  | { type: "progress"; hashRate: number; nonce: string; hash: string }
  | { type: "share"; nonce: string }
  | { type: "found"; nonce: string; blockHash: string }
  | { type: "needTemplate" }
  | { type: "stopped" };

// After this many hashes on a single template, pause and request a fresh one.
// Matches the Python miner's `if hashes >= 2000000: break` behaviour.
const MAX_HASHES_PER_TEMPLATE = 2_000_000;

// ── helpers ──────────────────────────────────────────────────────────────────

const enc = new TextEncoder();

function encodeHeader(h: WorkerHeader, nonce: bigint): Uint8Array {
  // Must match encodeHeader() in lib/chain-core/src/mining.ts exactly.
  return enc.encode(
    JSON.stringify({
      number: h.number,
      parentHash: h.parentHash,
      timestamp: h.timestamp,
      miner: h.miner,
      difficulty: h.difficulty,      // already a decimal string
      transactionsRoot: h.transactionsRoot,
      nonce: nonce.toString(),
    }),
  );
}

function hashHeader(h: WorkerHeader, nonce: bigint): { hex: string; value: bigint } {
  const bytes = keccak256(encodeHeader(h, nonce));
  const hex =
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return { hex, value };
}

/** 48-bit random starting nonce — matches Python's random.randint(0, 2**48) */
function randomNonce(): bigint {
  // Two 24-bit random values combined to stay within safe integer range
  const hi = Math.floor(Math.random() * 0x1000000); // 24 bits
  const lo = Math.floor(Math.random() * 0x1000000); // 24 bits
  return (BigInt(hi) << 24n) | BigInt(lo);
}

// ── message handler ───────────────────────────────────────────────────────────

export type WorkerErrorMsg = { type: "error"; message: string };

let running = false;

// Catch unhandled promise rejections inside the worker and forward them to the
// main thread so they show up as readable log lines instead of "undefined".
self.addEventListener("unhandledrejection", (ev) => {
  const msg = (ev as PromiseRejectionEvent).reason?.message
    ?? String((ev as PromiseRejectionEvent).reason)
    ?? "unhandled rejection";
  (self as unknown as Worker).postMessage({ type: "error", message: msg } as WorkerErrorMsg);
});

self.onmessage = async (e: MessageEvent<ToWorkerMsg>) => {
  try {
    await handleMessage(e);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ type: "error", message: msg } as WorkerErrorMsg);
  }
};

async function handleMessage(e: MessageEvent<ToWorkerMsg>) {
  const msg = e.data;

  if (msg.type === "stop") {
    running = false;
    (self as unknown as Worker).postMessage({ type: "stopped" } satisfies FromWorkerMsg);
    return;
  }

  if (msg.type === "start") {
    running = true;
    const { header, batchSize } = msg;
    const blockTarget = BigInt(msg.target);
    const shareTarget = BigInt(msg.shareTarget);

    // 48-bit random start — prevents multiple browser tabs colliding on the same nonces
    let nonce = randomNonce();
    let hashCount = 0;
    let startTime = Date.now();

    while (running) {
      let progressNonce = nonce.toString();
      let progressHash = "0x";

      for (let i = 0; i < batchSize; i++) {
        if (!running) break;
        const { hex, value } = hashHeader(header, nonce);
        hashCount++;
        progressNonce = nonce.toString();
        progressHash = hex;

        if (value <= blockTarget) {
          // Full block found — stop hashing entirely
          running = false;
          (self as unknown as Worker).postMessage({
            type: "found",
            nonce: nonce.toString(),
            blockHash: hex,
          } satisfies FromWorkerMsg);
          return;
        }

        if (value <= shareTarget) {
          // Valid share — report it and keep hashing on the same template.
          // We do NOT break here (unlike the Python miner) because at low
          // difficulty the share target is trivially easy and breaking would
          // cause an infinite template-fetch storm.
          (self as unknown as Worker).postMessage({
            type: "share",
            nonce: nonce.toString(),
          } satisfies FromWorkerMsg);
        }

        nonce++;

        // Template exhaustion check — refresh after MAX_HASHES_PER_TEMPLATE.
        // This mirrors Python's outer while-True loop that re-fetches the
        // template every 2M hashes.
        if (hashCount >= MAX_HASHES_PER_TEMPLATE) {
          // Signal the main thread and stop — it will send a new 'start'.
          running = false;
          (self as unknown as Worker).postMessage({ type: "needTemplate" } satisfies FromWorkerMsg);
          return;
        }
      }

      // Report progress after each batch
      const elapsed = (Date.now() - startTime) / 1000;
      const hashRate = elapsed > 0 ? Math.round(hashCount / elapsed) : 0;
      (self as unknown as Worker).postMessage({
        type: "progress",
        hashRate,
        nonce: progressNonce,
        hash: progressHash,
      } satisfies FromWorkerMsg);

      // Yield for a tick so the stop message can arrive before the next batch.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
}
