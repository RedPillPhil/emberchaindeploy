import type { PrefixedHexString } from "@ethereumjs/util";

export type TxStatus = "pending" | "success" | "failed";

export interface StoredTransaction {
  hash: PrefixedHexString;
  from: PrefixedHexString;
  to: PrefixedHexString | null;
  value: string; // decimal string, wei-like smallest unit
  nonce: number;
  gasLimit: string;
  data: PrefixedHexString;
  status: TxStatus;
  blockNumber: number | null;
  contractAddress: PrefixedHexString | null;
  gasUsed: string | null;
  error: string | null;
  returnData: PrefixedHexString | null;
  createdAt: string; // ISO date
}

export interface StoredBlock {
  number: number;
  hash: PrefixedHexString;
  parentHash: PrefixedHexString;
  timestamp: string; // ISO date
  miner: PrefixedHexString;
  difficulty: string;
  nonce: string;
  stateRoot: PrefixedHexString;
  reward: string;
  transactionHashes: PrefixedHexString[];
  /** Per-miner payout breakdown for proportional share-based rewards. address → wei amount string. */
  payouts?: Record<string, string>;
}

export interface ChainConfig {
  chainName: string;
  symbol: string;
  targetBlockTimeSeconds: number;
  blockReward: string;
  genesisDifficulty: string;
  difficultyAdjustmentWindow: number;
  /** Shares are this many times easier to find than full blocks (default 64). */
  shareDifficultyDivisor: number;
}

// ---------- Shielded pool (private transactions) ----------

export type NoteStatus = "unspent" | "spent";
export type NoteSource = "shield" | "private-send";

/**
 * A shielded note: an opaque, on-chain commitment to a hidden amount owned
 * by a one-time stealth address. Nothing here identifies the owner or the
 * amount to an outside observer — only someone holding the owning wallet's
 * private key can recognize, decrypt, and later spend it.
 */
export interface PrivateNote {
  id: string;
  ephemeralPublicKey: PrefixedHexString;
  stealthPublicKey: PrefixedHexString;
  commitment: PrefixedHexString;
  encryptedPayload: PrefixedHexString;
  status: NoteStatus;
  keyImage: PrefixedHexString | null;
  source: NoteSource;
  createdAtBlockHeight: number;
  createdAt: string;
}

export type ShieldedTxType = "shield" | "private-send" | "unshield";

/**
 * Public, listable record of a shielded-pool operation. For "shield" and
 * "unshield" the public address/amount fields are intentionally populated
 * — that boundary crossing is visible by design. For "private-send" they
 * are always null: no observer of this record can learn the sender,
 * recipient, or amount.
 */
export interface ShieldedTxRecord {
  id: string;
  type: ShieldedTxType;
  createdAt: string;
  publicAddress: PrefixedHexString | null;
  publicAmount: string | null;
  fee: string;
  noteIdsCreated: string[];
  noteIdsSpent: string[];
}

export interface StealthMeta {
  spendPublicKey: PrefixedHexString;
  viewPublicKey: PrefixedHexString;
}

export interface WalletRecord {
  createdAt: string;
  spendPublicKey?: PrefixedHexString;
  viewPublicKey?: PrefixedHexString;
}

// ---------- P2P Exchange ----------

export type ExchangeCurrency = "ETH" | "USDT" | "BTC" | "SOL";
export type ListingStatus = "open" | "fulfilled" | "cancelled";

/** USDT network names supported by the exchange. */
export type UsdtNetwork = "ERC-20" | "TRC-20" | "BEP-20" | "Polygon";

export interface ExchangeListing {
  id: string;
  /** EMBR address of the seller */
  sellerAddress: string;
  /** Amount of EMBR locked for sale, as a decimal wei string */
  amountEmbr: string;
  /** Currency the seller wants to receive */
  currency: ExchangeCurrency;
  /** Asking price in that currency's natural unit (e.g. "0.05" ETH) */
  priceAmount: string;
  /**
   * Primary receive address (used for all non-USDT currencies, and for
   * ERC-20 USDT for backward compat).  For multi-chain USDT, per-network
   * addresses live in networkAddresses.
   */
  receiveAddress: string;
  status: ListingStatus;
  /** EMBR address of the buyer, set on fulfillment */
  buyerAddress: string | null;
  /** External chain tx hash submitted by the buyer */
  paymentTxHash: string | null;
  createdAt: string;
  updatedAt: string;

  // ── Multi-chain USDT ──────────────────────────────────────────────────────
  /** For USDT listings: which networks the seller will accept payment on. */
  acceptedNetworks: string[] | null;
  /**
   * Maps network name → seller receive address on that network.
   * ERC-20/BEP-20/Polygon share the same 0x address; TRC-20 uses a T… address.
   * Null for non-USDT currencies.
   */
  networkAddresses: Record<string, string> | null;

  // ── Buy reservation ───────────────────────────────────────────────────────
  /** EMBR address of the buyer who reserved this listing. */
  reservedBy: string | null;
  /** Unix timestamp (ms) when the reservation was made. */
  reservedAt: number | null;
  /** Unix timestamp (ms) when the reservation expires. */
  reservedUntil: number | null;

  // ── Fulfillment metadata ─────────────────────────────────────────────────
  /** For USDT: which network the buyer used (recorded at fulfillment). */
  selectedNetwork: string | null;
}
