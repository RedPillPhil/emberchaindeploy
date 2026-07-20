import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Stores payment proof hashes for replay-protection.
 *
 * Each row represents one external payment tx that was used to fulfil an
 * EMBR exchange listing.  The proof_key column (`${currency}:${txHash}`)
 * mirrors what Blockchain.usedPaymentProofs keeps in-memory, so even if
 * the chain_state JSON blob is lost or rolled back this table provides an
 * independent durability layer that prevents proof replay.
 */
export const usedPaymentProofsTable = pgTable("used_payment_proofs", {
  /** Composite key: `${currency}:${txHash.toLowerCase()}` e.g. `ETH:0xabc…` */
  proofKey: text("proof_key").primaryKey(),
  /** ISO currency code: ETH, USDT, … */
  currency: text("currency").notNull(),
  /** External blockchain tx hash (lowercase, 0x-prefixed). */
  txHash: text("tx_hash").notNull(),
  /** The EMBR exchange listing that consumed this proof. */
  listingId: text("listing_id").notNull(),
  /** When the fulfillment was committed. */
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UsedPaymentProof = typeof usedPaymentProofsTable.$inferSelect;
export type InsertUsedPaymentProof = typeof usedPaymentProofsTable.$inferInsert;
