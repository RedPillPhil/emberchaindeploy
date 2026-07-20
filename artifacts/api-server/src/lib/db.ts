/**
 * PostgreSQL persistence hooks for the Emberchain ledger.
 *
 * The chain state is stored as a single JSONB row in `chain_state`.
 * On startup the blockchain loads from DB first (always up-to-date across
 * deploys), falling back to the local file only when the row is absent.
 * Every persist() call saves to the local file synchronously AND fires a
 * background upsert to PG — if PG is briefly unavailable the file keeps
 * things running and the next successful persist catches PG back up.
 */

import pg from "pg";
import type { PersistedChain } from "@workspace/chain-core";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err.message);
});

const STATE_ID = "main";

// ---------------------------------------------------------------------------
// Debounced save — prevent DB saturation when blocks close in rapid succession
// (e.g. low difficulty, many miners).  The local file is always written
// synchronously first, so no state is lost; the DB just catches up on the
// next flush.
// ---------------------------------------------------------------------------
let _pendingSave: PersistedChain | null = null;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 4_000; // flush to DB at most every 4 seconds

function scheduleSave(data: PersistedChain): Promise<void> {
  _pendingSave = data;
  if (_saveTimer !== null) {
    // Already scheduled — just update the payload; the timer will pick it up
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    _saveTimer = setTimeout(async () => {
      _saveTimer = null;
      const payload = _pendingSave!;
      _pendingSave = null;
      try {
        await pool.query(
          `INSERT INTO chain_state (id, data, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (id) DO UPDATE
             SET data = EXCLUDED.data,
                 updated_at = NOW()`,
          [STATE_ID, JSON.stringify(payload)],
        );
      } catch (err) {
        console.error("[db] Could not save chain state to database:", (err as Error).message);
      }
      resolve();
    }, SAVE_DEBOUNCE_MS);
  });
}

export async function loadChainFromDB(): Promise<PersistedChain | null> {
  try {
    const { rows } = await pool.query<{ data: PersistedChain }>(
      "SELECT data FROM chain_state WHERE id = $1",
      [STATE_ID],
    );
    return rows[0]?.data ?? null;
  } catch (err) {
    console.error("[db] Could not load chain state from database:", (err as Error).message);
    return null;
  }
}

export async function saveChainToDB(data: PersistedChain): Promise<void> {
  // Debounced — coalesces rapid calls (e.g. back-to-back block closes at low
  // difficulty) into a single DB write every SAVE_DEBOUNCE_MS milliseconds.
  await scheduleSave(data);
}

// ---------------------------------------------------------------------------
// used_payment_proofs — independent replay-protection table
// ---------------------------------------------------------------------------

/**
 * Ensures the used_payment_proofs table exists.  Called once on startup so the
 * server is self-bootstrapping even in environments where drizzle-kit push
 * hasn't been run manually.
 */
export async function ensureProofsTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS used_payment_proofs (
        proof_key   TEXT        PRIMARY KEY,
        currency    TEXT        NOT NULL,
        tx_hash     TEXT        NOT NULL,
        listing_id  TEXT        NOT NULL,
        fulfilled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (err) {
    console.error("[db] Could not ensure used_payment_proofs table:", (err as Error).message);
  }
}

/** Returns all proof keys stored in the dedicated table. */
export async function loadProofsFromDB(): Promise<string[]> {
  try {
    const { rows } = await pool.query<{ proof_key: string }>(
      "SELECT proof_key FROM used_payment_proofs",
    );
    return rows.map((r) => r.proof_key);
  } catch (err) {
    console.error("[db] Could not load proof keys from database:", (err as Error).message);
    return [];
  }
}

/**
 * Looks up a proof record by the external transaction hash.
 * Used to surface the original listing ID in duplicate-proof error responses.
 */
export async function getProofByTxHash(txHash: string): Promise<{
  proofKey: string;
  currency: string;
  txHash: string;
  listingId: string;
} | null> {
  try {
    const { rows } = await pool.query<{
      proof_key: string;
      currency: string;
      tx_hash: string;
      listing_id: string;
    }>(
      "SELECT proof_key, currency, tx_hash, listing_id FROM used_payment_proofs WHERE tx_hash = $1 LIMIT 1",
      [txHash.toLowerCase()],
    );
    if (!rows[0]) return null;
    return {
      proofKey: rows[0].proof_key,
      currency: rows[0].currency,
      txHash: rows[0].tx_hash,
      listingId: rows[0].listing_id,
    };
  } catch (err) {
    console.error("[db] Could not query proof by tx_hash:", (err as Error).message);
    return null;
  }
}

/** Inserts a consumed proof key; silently ignores duplicate-key conflicts. */
export async function saveProofToDB(
  proofKey: string,
  currency: string,
  txHash: string,
  listingId: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO used_payment_proofs (proof_key, currency, tx_hash, listing_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (proof_key) DO NOTHING`,
      [proofKey, currency, txHash, listingId],
    );
  } catch (err) {
    console.error("[db] Could not save proof key to database:", (err as Error).message);
  }
}

/** Pass these to the Blockchain constructor so it uses PG for persistence. */
export function createChainPersistenceHooks() {
  return {
    asyncLoadHook: loadChainFromDB,
    asyncPersistHook: saveChainToDB,
    asyncLoadProofsHook: loadProofsFromDB,
    asyncSaveProofHook: saveProofToDB,
  };
}
