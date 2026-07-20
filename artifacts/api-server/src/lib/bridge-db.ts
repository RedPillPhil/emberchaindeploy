/**
 * Database layer for the EmberSwap bridge relayer.
 *
 * bridge_events — one row per cross-chain bridge request.
 *   direction: "embr_to_base" | "base_to_embr"
 *   status:    "pending" | "relayed" | "failed"
 *
 * The nonce column is the user-supplied unique bridge nonce and serves as the
 * natural idempotency key across both directions.
 */

import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
});

pool.on("error", (err) => {
  console.error("[bridge-db] Pool error:", err.message);
});

// ---------------------------------------------------------------------------
// Schema bootstrap
// ---------------------------------------------------------------------------

export async function ensureBridgeTables(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bridge_events (
        id            BIGSERIAL     PRIMARY KEY,
        nonce         TEXT          NOT NULL UNIQUE,
        direction     TEXT          NOT NULL,
        sender        TEXT          NOT NULL,
        recipient     TEXT          NOT NULL,
        amount        TEXT          NOT NULL,
        status        TEXT          NOT NULL DEFAULT 'pending',
        tx_hash_src   TEXT,
        tx_hash_dst   TEXT,
        error_msg     TEXT,
        retry_count   INT           NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);

    // Index for fast lookups by address (history endpoint)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS bridge_events_sender_idx    ON bridge_events (sender);
      CREATE INDEX IF NOT EXISTS bridge_events_recipient_idx ON bridge_events (recipient);
      CREATE INDEX IF NOT EXISTS bridge_events_status_idx    ON bridge_events (status);
    `);
  } catch (err) {
    console.error("[bridge-db] Could not ensure bridge tables:", (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BridgeDirection = "embr_to_base" | "base_to_embr";
export type BridgeStatus = "pending" | "relayed" | "failed";

export interface BridgeEvent {
  id: number;
  nonce: string;
  direction: BridgeDirection;
  sender: string;
  recipient: string;
  amount: string;
  status: BridgeStatus;
  txHashSrc: string | null;
  txHashDst: string | null;
  errorMsg: string | null;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type BridgeRow = {
  id: number;
  nonce: string;
  direction: string;
  sender: string;
  recipient: string;
  amount: string;
  status: string;
  tx_hash_src: string | null;
  tx_hash_dst: string | null;
  error_msg: string | null;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
};

function rowToEvent(row: BridgeRow): BridgeEvent {
  return {
    id: row.id,
    nonce: row.nonce,
    direction: row.direction as BridgeDirection,
    sender: row.sender,
    recipient: row.recipient,
    amount: row.amount,
    status: row.status as BridgeStatus,
    txHashSrc: row.tx_hash_src,
    txHashDst: row.tx_hash_dst,
    errorMsg: row.error_msg,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateBridgeEventParams {
  nonce: string;
  direction: BridgeDirection;
  sender: string;
  recipient: string;
  amount: string;
  txHashSrc?: string;
}

export type CreateBridgeEventResult =
  | { kind: "inserted"; event: BridgeEvent }
  | { kind: "conflict" }; // nonce already exists

/**
 * Insert a new bridge event (pending).
 *
 * Returns `{ kind: "inserted", event }` on success, or `{ kind: "conflict" }`
 * when the nonce already exists.  Throws on any real database error so callers
 * can distinguish a transient failure from a legitimate duplicate.
 */
export async function createBridgeEvent(
  params: CreateBridgeEventParams,
): Promise<CreateBridgeEventResult> {
  const { rows } = await pool.query<BridgeRow>(
    `INSERT INTO bridge_events (nonce, direction, sender, recipient, amount, tx_hash_src)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (nonce) DO NOTHING
     RETURNING *`,
    [params.nonce, params.direction, params.sender, params.recipient, params.amount, params.txHashSrc ?? null],
  );
  if (rows[0]) {
    return { kind: "inserted", event: rowToEvent(rows[0]) };
  }
  return { kind: "conflict" };
}

/**
 * Fetch events ready to be relayed: status=pending and retry_count < maxRetries.
 */
export async function getPendingBridgeEvents(
  direction: BridgeDirection,
  maxRetries = 5,
): Promise<BridgeEvent[]> {
  try {
    const { rows } = await pool.query<BridgeRow>(
      `SELECT * FROM bridge_events
       WHERE direction = $1 AND status = 'pending' AND retry_count < $2
       ORDER BY created_at ASC
       LIMIT 50`,
      [direction, maxRetries],
    );
    return rows.map(rowToEvent);
  } catch (err) {
    console.error("[bridge-db] getPendingBridgeEvents error:", (err as Error).message);
    return [];
  }
}

export async function getBridgeEventByNonce(nonce: string): Promise<BridgeEvent | null> {
  try {
    const { rows } = await pool.query<BridgeRow>(
      "SELECT * FROM bridge_events WHERE nonce = $1 LIMIT 1",
      [nonce],
    );
    return rows[0] ? rowToEvent(rows[0]) : null;
  } catch (err) {
    console.error("[bridge-db] getBridgeEventByNonce error:", (err as Error).message);
    return null;
  }
}

export async function getBridgeHistoryForAddress(address: string): Promise<BridgeEvent[]> {
  const addr = address.toLowerCase();
  try {
    const { rows } = await pool.query<BridgeRow>(
      `SELECT * FROM bridge_events
       WHERE lower(sender) = $1 OR lower(recipient) = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [addr],
    );
    return rows.map(rowToEvent);
  } catch (err) {
    console.error("[bridge-db] getBridgeHistoryForAddress error:", (err as Error).message);
    return [];
  }
}

/**
 * Mark a relay as successful.
 */
export async function markBridgeRelayed(nonce: string, txHashDst: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE bridge_events
       SET status = 'relayed', tx_hash_dst = $2, error_msg = NULL, updated_at = NOW()
       WHERE nonce = $1`,
      [nonce, txHashDst],
    );
  } catch (err) {
    console.error("[bridge-db] markBridgeRelayed error:", (err as Error).message);
  }
}

/**
 * Increment retry_count and optionally record the error.
 * If retry_count reaches maxRetries, set status to 'failed'.
 */
export async function recordBridgeAttempt(
  nonce: string,
  errorMsg: string,
  maxRetries = 5,
): Promise<void> {
  try {
    await pool.query(
      `UPDATE bridge_events
       SET retry_count = retry_count + 1,
           error_msg   = $2,
           status      = CASE WHEN retry_count + 1 >= $3 THEN 'failed' ELSE status END,
           updated_at  = NOW()
       WHERE nonce = $1`,
      [nonce, errorMsg, maxRetries],
    );
  } catch (err) {
    console.error("[bridge-db] recordBridgeAttempt error:", (err as Error).message);
  }
}
