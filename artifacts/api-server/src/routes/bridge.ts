/**
 * Bridge API routes
 *
 * POST /api/bridge/lock
 *   Initiates an EMBR → Base bridge transfer.
 *
 *   Security model:
 *     1. Parses and verifies the signed raw transaction (signature check)
 *     2. Validates the tx destination matches the configured EmberBridge contract
 *     3. Decodes lockEMBR calldata server-side and asserts decoded params match
 *        the user-supplied baseRecipient/nonce (no blind trust of user inputs)
 *     4. Asserts tx.value matches the claimed amount (prevents fake amount claims)
 *     5. Submits the tx to the EMBR chain (nonce/balance checks enforced by chain)
 *     6. Waits for confirmed execution (not just mempool acceptance) before
 *        recording the bridge event — ensures wEMBR is only minted for proven locks
 *
 * GET /api/bridge/status/:nonce
 *   Returns the current status of a bridge request.
 *
 * GET /api/bridge/history/:address
 *   Returns all bridge events involving the given address (sender or recipient).
 */

import { Router, type Request, type Response } from "express";
import { ethers } from "ethers";
import { createTxFromRLP } from "@ethereumjs/tx";
import { bytesToHex, hexToBytes } from "@ethereumjs/util";
import type { PrefixedHexString } from "@ethereumjs/util";
import { createEmberchainCommon } from "@workspace/chain-core";
import { chain } from "../lib/chain";
import {
  createBridgeEvent,
  getBridgeEventByNonce,
  getBridgeHistoryForAddress,
} from "../lib/bridge-db";
import { logger } from "../lib/logger";

const common = createEmberchainCommon();

// Used server-side to decode and validate lockEMBR calldata.
const LOCK_EMBR_IFACE = new ethers.Interface([
  "function lockEMBR(address baseRecipient, uint256 nonce) payable",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Poll chain.getTransaction until the tx is mined (status != "pending") or
 * the timeout elapses. Throws on timeout.
 */
async function waitForTxConfirmed(
  hash: string,
  timeoutMs = 90_000,
  pollMs = 2_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tx = await chain.getTransaction(hash);
    if (tx && tx.status !== "pending") return tx;
    await new Promise<void>((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `Transaction ${hash} was not included in a block within ${timeoutMs / 1000}s`,
  );
}

const router = Router();

// ---------------------------------------------------------------------------
// POST /bridge/lock — initiate EMBR → Base
// ---------------------------------------------------------------------------

router.post("/bridge/lock", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    /** Signed raw transaction hex calling lockEMBR() on the EMBR chain */
    rawTx?: string;
    /** Base chain recipient address (must match calldata) */
    baseRecipient?: string;
    /** Amount of EMBR in wei — must match tx.value */
    amount?: string;
    /** Unique bridge nonce — must match calldata */
    nonce?: string | number;
  };

  const { rawTx, baseRecipient, amount, nonce } = body ?? {};

  if (!rawTx || !baseRecipient || !amount || nonce === undefined) {
    res.status(400).json({
      error: "rawTx, baseRecipient, amount, and nonce are required",
    });
    return;
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(baseRecipient)) {
    res.status(400).json({ error: "baseRecipient must be a valid 0x Ethereum address" });
    return;
  }

  let amountBig: bigint;
  try {
    amountBig = BigInt(amount);
    if (amountBig <= 0n) throw new Error("non-positive");
  } catch {
    res.status(400).json({ error: "amount must be a positive integer (wei)" });
    return;
  }

  const nonceStr = String(nonce);

  // ── 1. Parse and verify the signed raw transaction ─────────────────────────

  let parsed: ReturnType<typeof createTxFromRLP>;
  try {
    parsed = createTxFromRLP(hexToBytes(rawTx as PrefixedHexString), { common });
  } catch (err) {
    res.status(400).json({
      error: `Could not parse raw transaction: ${(err as Error).message}`,
    });
    return;
  }

  if (!parsed.verifySignature()) {
    res.status(400).json({ error: "Invalid transaction signature" });
    return;
  }

  const from     = parsed.getSenderAddress().toString() as PrefixedHexString;
  const txHash   = bytesToHex(parsed.hash());
  const txTo     = parsed.to?.toString().toLowerCase() ?? null;
  const txValue  = parsed.value;   // bigint, EMBR wei locked in the contract
  const txData   = bytesToHex(parsed.data) as PrefixedHexString;
  const gasLimit = parsed.gasLimit.toString();
  const txNonce  = parsed.nonce;

  // ── 2. Verify destination is the EmberBridge contract ─────────────────────

  const emberBridgeAddress = (process.env["EMBER_BRIDGE_ADDRESS"] ?? "").toLowerCase();
  if (emberBridgeAddress) {
    if (!txTo || txTo !== emberBridgeAddress) {
      res.status(400).json({
        error: `Transaction must target the EmberBridge contract (${emberBridgeAddress}), got: ${txTo ?? "null"}`,
      });
      return;
    }
  } else if (!txTo) {
    res.status(400).json({ error: "Transaction has no destination address" });
    return;
  }

  // ── 3. Decode calldata and verify params match user-supplied values ─────────

  let decodedRecipient: string;
  let decodedNonce: bigint;
  try {
    const decoded = LOCK_EMBR_IFACE.parseTransaction({ data: txData, value: txValue });
    if (!decoded || decoded.name !== "lockEMBR") {
      throw new Error("function selector does not match lockEMBR(address,uint256)");
    }
    decodedRecipient = (decoded.args[0] as string).toLowerCase();
    decodedNonce = decoded.args[1] as bigint;
  } catch (err) {
    res.status(400).json({
      error: `Calldata could not be decoded as lockEMBR: ${(err as Error).message}`,
    });
    return;
  }

  if (decodedRecipient !== baseRecipient.toLowerCase()) {
    res.status(400).json({
      error: "baseRecipient in calldata does not match provided baseRecipient",
    });
    return;
  }

  if (decodedNonce.toString() !== nonceStr) {
    res.status(400).json({
      error: "nonce in calldata does not match provided nonce",
    });
    return;
  }

  // ── 4. Verify tx.value equals the claimed amount ───────────────────────────

  if (txValue !== amountBig) {
    res.status(400).json({
      error: `Transaction value (${txValue}) does not match provided amount (${amountBig})`,
    });
    return;
  }

  // ── 5. Submit to the EMBR chain (enforces nonce/balance, validates sig) ────

  try {
    await chain.submitRawEVMTransaction({
      hash: txHash,
      from,
      to: (txTo as PrefixedHexString) ?? null,
      value: txValue.toString(),
      data: txData,
      gasLimit,
      nonce: txNonce,
    });
  } catch (err) {
    const msg = (err as Error).message;
    logger.warn({ err: msg }, "[bridge] lockEMBR raw tx rejected by mempool");
    res.status(400).json({ error: `EMBR chain rejected the transaction: ${msg}` });
    return;
  }

  // ── 6. Wait for on-chain execution confirmation ─────────────────────────────
  // We only record a bridge event (and eventually mint wEMBR on Base) AFTER
  // the source-chain tx has executed successfully.  Mempool acceptance alone is
  // not sufficient proof of lock.

  let confirmedTx: Awaited<ReturnType<typeof waitForTxConfirmed>>;
  try {
    confirmedTx = await waitForTxConfirmed(txHash);
  } catch {
    // Timeout — tx is queued but not yet mined. Tell the client to retry.
    res.status(202).json({
      message:
        "Transaction submitted but confirmation timed out. " +
        "Check /api/bridge/status/:nonce after a few seconds.",
      txHash,
    });
    return;
  }

  if (confirmedTx.status !== "success") {
    res.status(400).json({
      error: `lockEMBR transaction reverted on-chain: ${confirmedTx.error ?? "execution failed"}`,
      txHash,
    });
    return;
  }

  // ── 7. Record the attested bridge event ────────────────────────────────────
  // Throws on DB error so that a transient outage is never silently treated as
  // a duplicate — the caller retries rather than losing the relay record.

  let createResult: Awaited<ReturnType<typeof createBridgeEvent>>;
  try {
    createResult = await createBridgeEvent({
      nonce: nonceStr,
      direction: "embr_to_base",
      sender: from.toLowerCase(),
      recipient: baseRecipient.toLowerCase(),
      amount: amountBig.toString(),
      txHashSrc: txHash,
    });
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ nonce: nonceStr, txHash, err: msg }, "[bridge] DB write failed after confirmed lock");
    res.status(503).json({
      error: "Bridge transfer confirmed on-chain but could not be persisted — please retry this request",
      txHash,
    });
    return;
  }

  if (createResult.kind === "conflict") {
    // Nonce already recorded — idempotent (genuine duplicate, not a DB error)
    const existing = await getBridgeEventByNonce(nonceStr);
    res.status(200).json({
      message: "Bridge request already recorded",
      nonce: nonceStr,
      status: existing?.status ?? "unknown",
    });
    return;
  }

  logger.info(
    { nonce: nonceStr, txHash, baseRecipient },
    "[bridge] EMBR→Base lock confirmed on-chain and recorded",
  );

  res.status(201).json({
    message: "Bridge request accepted — wEMBR will appear in your Base wallet shortly",
    nonce: nonceStr,
    txHashSrc: txHash,
    status: "pending",
  });
});

// ---------------------------------------------------------------------------
// POST /bridge/register — register bridge intent from a wallet-submitted tx
//
// Alternative to /bridge/lock for wallets that sign via the server's
// createTransaction API (which uses the EMBR chain's internal signing).
// The tx must already be confirmed on-chain; the server re-verifies calldata
// before recording the bridge event.
// ---------------------------------------------------------------------------

router.post("/bridge/register", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    txHash?: string;
    baseRecipient?: string;
    amount?: string;
    nonce?: string | number;
  };
  const { txHash, baseRecipient, amount, nonce } = body ?? {};

  if (!txHash || !baseRecipient || !amount || nonce === undefined) {
    res.status(400).json({ error: "txHash, baseRecipient, amount, and nonce are required" });
    return;
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    res.status(400).json({ error: "txHash must be a valid 32-byte hex string (0x…64)" });
    return;
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(baseRecipient)) {
    res.status(400).json({ error: "baseRecipient must be a valid 0x Ethereum address" });
    return;
  }

  let amountBig: bigint;
  try {
    amountBig = BigInt(amount);
    if (amountBig <= 0n) throw new Error("non-positive");
  } catch {
    res.status(400).json({ error: "amount must be a positive integer (wei)" });
    return;
  }

  const nonceStr = String(nonce);

  // ── 1. Retrieve the tx from the EMBR chain ─────────────────────────────────
  const tx = await chain.getTransaction(txHash);
  if (!tx) {
    res.status(404).json({ error: "Transaction not found on EMBR chain" });
    return;
  }

  if (tx.status === "pending") {
    res.status(202).json({
      message: "Transaction still pending — retry in a few seconds",
      txHash,
    });
    return;
  }

  if (tx.status === "failed") {
    res.status(400).json({
      error: `Transaction failed on-chain: ${tx.error ?? "execution reverted"}`,
      txHash,
    });
    return;
  }

  // ── 2. Verify destination is the EmberBridge contract ─────────────────────
  const emberBridgeAddress = (process.env["EMBER_BRIDGE_ADDRESS"] ?? "").toLowerCase();
  if (emberBridgeAddress) {
    if (!tx.to || tx.to.toLowerCase() !== emberBridgeAddress) {
      res.status(400).json({
        error: `Transaction target is not the EmberBridge contract (${emberBridgeAddress})`,
      });
      return;
    }
  }

  // ── 3. Decode calldata and verify params ───────────────────────────────────
  let decodedRecipient: string;
  let decodedNonce: bigint;
  try {
    const decoded = LOCK_EMBR_IFACE.parseTransaction({
      data: tx.data,
      value: BigInt(tx.value),
    });
    if (!decoded || decoded.name !== "lockEMBR") {
      throw new Error("Not a lockEMBR call");
    }
    decodedRecipient = (decoded.args[0] as string).toLowerCase();
    decodedNonce = decoded.args[1] as bigint;
  } catch (err) {
    res.status(400).json({
      error: `Calldata could not be decoded as lockEMBR: ${(err as Error).message}`,
    });
    return;
  }

  if (decodedRecipient !== baseRecipient.toLowerCase()) {
    res.status(400).json({ error: "baseRecipient in calldata does not match" });
    return;
  }
  if (decodedNonce.toString() !== nonceStr) {
    res.status(400).json({ error: "nonce in calldata does not match" });
    return;
  }
  if (BigInt(tx.value) !== amountBig) {
    res.status(400).json({ error: "Transaction value does not match claimed amount" });
    return;
  }

  // ── 4. Record the attested bridge event ────────────────────────────────────
  let createResult: Awaited<ReturnType<typeof createBridgeEvent>>;
  try {
    createResult = await createBridgeEvent({
      nonce: nonceStr,
      direction: "embr_to_base",
      sender: (tx.from ?? "").toLowerCase(),
      recipient: baseRecipient.toLowerCase(),
      amount: amountBig.toString(),
      txHashSrc: txHash,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[bridge] DB write failed in /register");
    res.status(503).json({ error: "Could not persist bridge event — please retry" });
    return;
  }

  if (createResult.kind === "conflict") {
    const existing = await getBridgeEventByNonce(nonceStr);
    res.status(200).json({
      message: "Bridge request already registered",
      nonce: nonceStr,
      status: existing?.status ?? "unknown",
    });
    return;
  }

  logger.info({ nonce: nonceStr, txHash }, "[bridge] EMBR→Base registered via wallet tx");

  res.status(201).json({
    message: "Bridge request registered — wEMBR will appear on Base shortly",
    nonce: nonceStr,
    txHashSrc: txHash,
    status: "pending",
  });
});

// ---------------------------------------------------------------------------
// GET /bridge/status/:nonce
// ---------------------------------------------------------------------------

router.get("/bridge/status/:nonce", async (req: Request, res: Response): Promise<void> => {
  const { nonce } = req.params as { nonce: string };

  const event = await getBridgeEventByNonce(nonce);
  if (!event) {
    res.status(404).json({ error: `No bridge event found for nonce ${nonce}` });
    return;
  }

  res.json({
    nonce:      event.nonce,
    direction:  event.direction,
    status:     event.status,
    sender:     event.sender,
    recipient:  event.recipient,
    amount:     event.amount,
    txHashSrc:  event.txHashSrc,
    txHashDst:  event.txHashDst,
    retryCount: event.retryCount,
    errorMsg:   event.errorMsg,
    createdAt:  event.createdAt,
    updatedAt:  event.updatedAt,
  });
});

// ---------------------------------------------------------------------------
// GET /bridge/history/:address
// ---------------------------------------------------------------------------

router.get("/bridge/history/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params as { address: string };

  if (!/^0x[0-9a-fA-F]{40}$/i.test(address)) {
    res.status(400).json({ error: "address must be a valid 0x Ethereum address" });
    return;
  }

  const events = await getBridgeHistoryForAddress(address);

  res.json(
    events.map((e) => ({
      nonce:      e.nonce,
      direction:  e.direction,
      status:     e.status,
      sender:     e.sender,
      recipient:  e.recipient,
      amount:     e.amount,
      txHashSrc:  e.txHashSrc,
      txHashDst:  e.txHashDst,
      retryCount: e.retryCount,
      errorMsg:   e.errorMsg,
      createdAt:  e.createdAt,
      updatedAt:  e.updatedAt,
    })),
  );
});

export default router;
