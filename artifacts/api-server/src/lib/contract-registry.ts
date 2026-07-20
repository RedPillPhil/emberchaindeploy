/**
 * Contract Registry — stores ABI, token metadata, and creator info for
 * contracts deployed on the EMBR chain.
 */

import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
});

pool.on("error", (err) => {
  console.error("[contract-registry] Pool error:", err.message);
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export async function ensureContractTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contract_registry (
        address      TEXT PRIMARY KEY,
        abi          JSONB,
        name         TEXT,
        symbol       TEXT,
        decimals     INT,
        total_supply TEXT,
        is_token     BOOLEAN NOT NULL DEFAULT false,
        creator      TEXT,
        creator_tx   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (err) {
    console.error("[contract-registry] Schema error:", (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContractRecord {
  address: string;
  abi: object[] | null;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  isToken: boolean;
  creator: string | null;
  creatorTx: string | null;
  createdAt: string;
}

function rowToRecord(row: Record<string, unknown>): ContractRecord {
  return {
    address:     row["address"] as string,
    abi:         (row["abi"] as object[] | null) ?? null,
    name:        (row["name"] as string | null) ?? null,
    symbol:      (row["symbol"] as string | null) ?? null,
    decimals:    (row["decimals"] as number | null) ?? null,
    totalSupply: (row["total_supply"] as string | null) ?? null,
    isToken:     (row["is_token"] as boolean) ?? false,
    creator:     (row["creator"] as string | null) ?? null,
    creatorTx:   (row["creator_tx"] as string | null) ?? null,
    createdAt:   (row["created_at"] as Date).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getContractRecord(address: string): Promise<ContractRecord | null> {
  const res = await pool.query(
    "SELECT * FROM contract_registry WHERE address = $1",
    [address.toLowerCase()],
  );
  return res.rows[0] ? rowToRecord(res.rows[0]) : null;
}

export async function upsertContractRecord(data: {
  address: string;
  abi?: object[] | null;
  name?: string | null;
  symbol?: string | null;
  decimals?: number | null;
  totalSupply?: string | null;
  isToken?: boolean;
  creator?: string | null;
  creatorTx?: string | null;
}): Promise<ContractRecord> {
  const addr = data.address.toLowerCase();
  const res = await pool.query(
    `INSERT INTO contract_registry
      (address, abi, name, symbol, decimals, total_supply, is_token, creator, creator_tx)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (address) DO UPDATE SET
       abi          = COALESCE($2, contract_registry.abi),
       name         = COALESCE($3, contract_registry.name),
       symbol       = COALESCE($4, contract_registry.symbol),
       decimals     = COALESCE($5, contract_registry.decimals),
       total_supply = COALESCE($6, contract_registry.total_supply),
       is_token     = CASE WHEN $7 THEN $7 ELSE contract_registry.is_token END,
       creator      = COALESCE($8, contract_registry.creator),
       creator_tx   = COALESCE($9, contract_registry.creator_tx),
       updated_at   = NOW()
     RETURNING *`,
    [
      addr,
      data.abi !== undefined ? JSON.stringify(data.abi) : null,
      data.name ?? null,
      data.symbol ?? null,
      data.decimals ?? null,
      data.totalSupply ?? null,
      data.isToken ?? false,
      data.creator ?? null,
      data.creatorTx ?? null,
    ],
  );
  return rowToRecord(res.rows[0]);
}

export async function listTokens(): Promise<ContractRecord[]> {
  const res = await pool.query(
    "SELECT * FROM contract_registry WHERE is_token = true ORDER BY created_at ASC",
  );
  return res.rows.map(rowToRecord);
}

export async function listContracts(): Promise<ContractRecord[]> {
  const res = await pool.query(
    "SELECT * FROM contract_registry ORDER BY created_at DESC",
  );
  return res.rows.map(rowToRecord);
}
