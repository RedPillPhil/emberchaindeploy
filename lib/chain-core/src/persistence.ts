import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrefixedHexString } from "@ethereumjs/util";
import type { SerializedState } from "./state";
import type { StoredBlock, StoredTransaction, PrivateNote, ShieldedTxRecord, WalletRecord, ExchangeListing } from "./types";

export interface PersistedChain {
  version: 1 | 2 | 3;
  difficulty: string;
  blocks: StoredBlock[];
  transactions: StoredTransaction[];
  wallets: [PrefixedHexString, WalletRecord][];
  state: SerializedState;
  privateNotes?: PrivateNote[];
  shieldedTxs?: ShieldedTxRecord[];
  exchangeListings?: ExchangeListing[];
  /** Persisted set of `${currency}:${txHash}` strings used to prevent payment-proof replay. */
  usedPaymentProofs?: string[];
  /** address → last-template-fetch timestamp (ms). Persisted so active-miner count survives restarts. */
  recentMiners?: [string, number][];
  /** address → share count for the current (in-progress) round. Persisted so in-flight rounds survive restarts. */
  currentRoundShares?: [string, number][];
  /** "tipHash:nonce" keys of shares already accepted this round. Prevents replay after a server restart. */
  submittedShareNonces?: string[];
}

export function loadChainFile(filePath: string): PersistedChain | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as PersistedChain;
}

// ---------------------------------------------------------------------------
// Async file writer — never blocks the Node.js event loop
//
// JSON serialisation happens synchronously (microseconds) so the caller's
// in-memory snapshot is captured immediately.  The actual disk I/O is
// fire-and-forget on the async path.  A "pending" slot coalesces rapid
// calls: only the most-recent snapshot is written when the current write
// finishes, so we never queue up more than one extra write regardless of
// how many persist() calls arrive in a burst.
// ---------------------------------------------------------------------------
const _writers = new Map<string, { writing: boolean; pending: string | null }>();

function getWriter(filePath: string) {
  if (!_writers.has(filePath)) _writers.set(filePath, { writing: false, pending: null });
  return _writers.get(filePath)!;
}

async function drainWriter(filePath: string, tmpPath: string) {
  const w = getWriter(filePath);
  while (w.pending !== null) {
    const payload = w.pending;
    w.pending = null;
    try {
      await writeFile(tmpPath, payload, "utf-8");
      await writeFile(filePath, payload, "utf-8");
    } catch {
      // Best-effort — the DB is the durable store; file is a warm-start cache.
    }
  }
  w.writing = false;
}

export function saveChainFile(filePath: string, data: PersistedChain): void {
  mkdirSync(path.dirname(filePath), { recursive: true });

  // Serialise NOW (sync, fast) to snapshot the current state before it mutates.
  const json = JSON.stringify(data);
  const tmpPath = `${filePath}.tmp`;

  const w = getWriter(filePath);
  w.pending = json; // always keep only the latest snapshot

  if (!w.writing) {
    w.writing = true;
    // Kick off the async drain without awaiting — returns immediately.
    drainWriter(filePath, tmpPath).catch(() => { w.writing = false; });
  }
}
