/**
 * Integration test: ETH/USDT payment-proof replay protection survives server restarts.
 *
 * Scenario: a buyer submits a real Ethereum tx hash to buy listing A.  The server
 * fulfils the trade and persists the proof key.  When the server restarts (new
 * Blockchain instance, same data file) the same tx hash must be rejected with a
 * 409-equivalent error even against a different listing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Blockchain } from "@workspace/chain-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolves once the Blockchain has fully loaded its persisted state. */
async function waitReady(chain: Blockchain): Promise<void> {
  // Any public async method awaits whenReady() internally.
  await chain.listExchangeListings();
}

/** Builds a minimal open listing record for direct JSON injection. */
function openListing(id: string, currency: "ETH" | "USDT" = "ETH") {
  return {
    id,
    sellerAddress: "0x1111111111111111111111111111111111111111",
    amountEmbr: "1000000000000000000", // 1 EMBR
    currency,
    priceAmount: "0.01",
    receiveAddress: "0x1111111111111111111111111111111111111111",
    status: "open",
    buyerAddress: null,
    paymentTxHash: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Test 1: persisted `usedPaymentProofs` blocks replay on fresh Blockchain load
// ---------------------------------------------------------------------------

test("persisted proof key blocks lockListingForFulfillment after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "replay-test-a-"));
  const dataFile = join(dir, "chain.json");

  try {
    // Bootstrap a valid genesis chain file by initialising a Blockchain and
    // calling any public async method (which persists state).
    const bootstrap = new Blockchain(dataFile);
    await waitReady(bootstrap);
    // Force a persist by creating a wallet (calls this.persist() internally).
    await bootstrap.createWallet();

    // Inject test scenario directly into the JSON:
    //   – one open listing
    //   – one already-used proof key (as if the listing was previously fulfilled)
    const txHash = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const listingId = "listing-002";

    const raw = JSON.parse(readFileSync(dataFile, "utf-8"));
    raw.exchangeListings = [openListing(listingId, "ETH")];
    raw.usedPaymentProofs = [`ETH:${txHash.toLowerCase()}`];
    writeFileSync(dataFile, JSON.stringify(raw));

    // "Restart" — fresh Blockchain instance, same data file.
    const chain2 = new Blockchain(dataFile);
    await waitReady(chain2);

    // Attempting to buy listing-002 with the already-used tx hash must throw.
    assert.throws(
      () => chain2.lockListingForFulfillment(listingId, txHash),
      (err: unknown) => {
        assert.ok(err instanceof Error, "expected an Error");
        assert.ok(
          err.message.toLowerCase().includes("already used") ||
            err.message.toLowerCase().includes("already been used"),
          `expected 'already used' in error message, got: "${err.message}"`,
        );
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: commitFulfillment persists the proof; a second Blockchain rejects it
// ---------------------------------------------------------------------------

test("commitFulfillment persists proof so a restarted Blockchain rejects replay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "replay-test-b-"));
  const dataFile = join(dir, "chain.json");

  const txHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const listingId1 = "listing-001";
  const listingId2 = "listing-002";
  const buyerAddress = "0x2222222222222222222222222222222222222222";

  try {
    // Bootstrap genesis chain file.
    const bootstrap = new Blockchain(dataFile);
    await bootstrap.createWallet();

    // Inject two open listings into the persisted file.
    const raw = JSON.parse(readFileSync(dataFile, "utf-8"));
    raw.exchangeListings = [openListing(listingId1, "ETH"), openListing(listingId2, "ETH")];
    raw.usedPaymentProofs = [];
    writeFileSync(dataFile, JSON.stringify(raw));

    // "Server session 1": load the chain, fulfil listing-001.
    const chain1 = new Blockchain(dataFile);
    await waitReady(chain1);

    chain1.lockListingForFulfillment(listingId1, txHash); // reserves proof synchronously
    await chain1.commitFulfillment(listingId1, buyerAddress, txHash); // persists proof

    // Verify the proof key is now in the data file.
    const afterCommit = JSON.parse(readFileSync(dataFile, "utf-8"));
    assert.ok(
      Array.isArray(afterCommit.usedPaymentProofs) &&
        afterCommit.usedPaymentProofs.includes(`ETH:${txHash.toLowerCase()}`),
      "usedPaymentProofs should contain the committed proof key",
    );

    // "Server restart": brand-new Blockchain instance, same file.
    const chain2 = new Blockchain(dataFile);
    await waitReady(chain2);

    // Attempting to buy listing-002 with the same tx hash must be rejected.
    assert.throws(
      () => chain2.lockListingForFulfillment(listingId2, txHash),
      (err: unknown) => {
        assert.ok(err instanceof Error, "expected an Error");
        assert.ok(
          err.message.toLowerCase().includes("already used") ||
            err.message.toLowerCase().includes("already been used"),
          `expected 'already used' error after restart, got: "${err.message}"`,
        );
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: different tx hash on same listing is NOT blocked (sanity check)
// ---------------------------------------------------------------------------

test("a fresh tx hash is not blocked by an unrelated used proof", async () => {
  const dir = mkdtempSync(join(tmpdir(), "replay-test-c-"));
  const dataFile = join(dir, "chain.json");

  try {
    const bootstrap = new Blockchain(dataFile);
    await bootstrap.createWallet();

    const usedHash = "0xaaaa111122223333444455556666777788889999aaaabbbbccccddddeeeeffff";
    const freshHash = "0xbbbb111122223333444455556666777788889999aaaabbbbccccddddeeeeffff";
    const listingId = "listing-001";

    const raw = JSON.parse(readFileSync(dataFile, "utf-8"));
    raw.exchangeListings = [openListing(listingId, "ETH")];
    raw.usedPaymentProofs = [`ETH:${usedHash.toLowerCase()}`];
    writeFileSync(dataFile, JSON.stringify(raw));

    const chain2 = new Blockchain(dataFile);
    await waitReady(chain2);

    // Using a *different* tx hash on the open listing must succeed (not throw).
    assert.doesNotThrow(() => chain2.lockListingForFulfillment(listingId, freshHash));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: USDT proof key is scoped by currency (ETH proof ≠ USDT proof)
// ---------------------------------------------------------------------------

test("ETH proof does not block a USDT listing with the same tx hash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "replay-test-d-"));
  const dataFile = join(dir, "chain.json");

  try {
    const bootstrap = new Blockchain(dataFile);
    await bootstrap.createWallet();

    const txHash = "0xcccc111122223333444455556666777788889999aaaabbbbccccddddeeeeffff";
    const ethListingId = "listing-eth";
    const usdtListingId = "listing-usdt";

    const raw = JSON.parse(readFileSync(dataFile, "utf-8"));
    raw.exchangeListings = [
      openListing(ethListingId, "ETH"),
      openListing(usdtListingId, "USDT"),
    ];
    // Only the ETH version of this hash is marked as used.
    raw.usedPaymentProofs = [`ETH:${txHash.toLowerCase()}`];
    writeFileSync(dataFile, JSON.stringify(raw));

    const chain2 = new Blockchain(dataFile);
    await waitReady(chain2);

    // ETH listing → same hash → blocked.
    assert.throws(
      () => chain2.lockListingForFulfillment(ethListingId, txHash),
      /already used/i,
    );

    // USDT listing → same hash string, different currency → NOT blocked.
    assert.doesNotThrow(() => chain2.lockListingForFulfillment(usdtListingId, txHash));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
