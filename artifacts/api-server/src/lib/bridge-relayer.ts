/**
 * EmberSwap Bridge Relayer
 *
 * Runs two background loops inside the API server process:
 *
 *  Loop A — EMBR → Base
 *    Polls the bridge_events DB table for pending "embr_to_base" events
 *    (created by POST /api/bridge/lock) and calls bridgeIn() on the
 *    EmberchainBridge contract on Base to mint wEMBR to the recipient.
 *
 *  Loop B — Base → EMBR
 *    Polls Base chain logs every ~12 s for BridgeOut events from the
 *    EmberchainBridge contract, records new ones in the DB, then calls
 *    releaseEMBR() on the EmberBridge contract on the EMBR chain to send
 *    native EMBR to the recipient.
 *
 * Configuration (environment variables):
 *   BRIDGE_RELAYER_PRIVATE_KEY    Hex private key of the relayer wallet
 *   BASE_RPC_URL                  Alchemy / Infura Base endpoint
 *   EMBR_RPC_URL                  EMBR chain RPC (default: http://localhost:<PORT>/api/rpc)
 *   EMBER_BRIDGE_ADDRESS          EmberBridge.sol address on the EMBR chain
 *   EMBERCHAIN_BRIDGE_ADDRESS     EmberchainBridge.sol address on Base
 *
 * If any of these are missing the relayer starts in a degraded mode and logs
 * which direction is inactive. It will not crash the API server.
 */

import { ethers } from "ethers";
import { logger } from "./logger";
import { chain } from "./chain";
import {
  getPendingBridgeEvents,
  createBridgeEvent,
  markBridgeRelayed,
  recordBridgeAttempt,
  type BridgeEvent,
} from "./bridge-db";

// ---------------------------------------------------------------------------
// Minimal ABIs — only the functions and events the relayer needs
// ---------------------------------------------------------------------------

const EMBER_BRIDGE_ABI = [
  "event BridgeOut(address indexed sender, address indexed baseRecipient, uint256 amount, uint256 indexed nonce)",
  "function releaseEMBR(address recipient, uint256 amount, uint256 nonce) external",
];

const EMBERCHAIN_BRIDGE_ABI = [
  "event BridgeOut(address indexed sender, string embrRecipient, uint256 amount, uint256 indexed nonce)",
  "function bridgeIn(address recipient, uint256 amount, uint256 nonce) external",
];

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getConfig() {
  return {
    relayerKey:           process.env["BRIDGE_RELAYER_PRIVATE_KEY"] ?? "",
    baseRpcUrl:           process.env["BASE_RPC_URL"] ?? "",
    embrRpcUrl:           process.env["EMBR_RPC_URL"] ?? `http://localhost:${process.env["PORT"] ?? 3000}/api/rpc`,
    emberBridgeAddress:   process.env["EMBER_BRIDGE_ADDRESS"] ?? "",
    emberchainBridgeAddress: process.env["EMBERCHAIN_BRIDGE_ADDRESS"] ?? "",
  };
}

// ---------------------------------------------------------------------------
// Retry with exponential back-off
// ---------------------------------------------------------------------------

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000); // 1 s, 2 s, 4 s … 30 s
      logger.warn({ label, attempt, delay }, `[relayer] ${label}: attempt ${attempt} failed — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Loop A: EMBR → Base
// ---------------------------------------------------------------------------

async function runEmbrToBaseLoop(
  baseWallet: ethers.Wallet,
  emberchainBridgeAddress: string,
  stopSignal: { stopped: boolean },
): Promise<void> {
  const contract = new ethers.Contract(emberchainBridgeAddress, EMBERCHAIN_BRIDGE_ABI, baseWallet);

  logger.info("[relayer] EMBR→Base watcher started");

  while (!stopSignal.stopped) {
    const events = await getPendingBridgeEvents("embr_to_base");

    for (const event of events) {
      if (stopSignal.stopped) break;

      const { nonce, recipient, amount } = event;
      logger.info({ nonce, recipient, amount }, "[relayer] EMBR→Base: relaying");

      try {
        const txHash = await withRetry(`bridgeIn(nonce=${nonce})`, async () => {
          const tx = await (contract["bridgeIn"] as (
            recipient: string,
            amount: bigint,
            nonce: bigint,
          ) => Promise<ethers.TransactionResponse>)(
            recipient,
            BigInt(amount),
            BigInt(nonce),
          );
          const receipt = await tx.wait(1);
          if (!receipt || receipt.status === 0) throw new Error("Transaction reverted");
          return receipt.hash;
        }, 5);

        await markBridgeRelayed(nonce, txHash);
        logger.info({ nonce, txHash }, "[relayer] EMBR→Base: relayed ✓");
      } catch (err) {
        const msg = (err as Error).message;
        logger.error({ nonce, err: msg }, "[relayer] EMBR→Base: failed after max retries");
        await recordBridgeAttempt(nonce, msg, 5);
      }
    }

    await sleep(4_000);
  }

  logger.info("[relayer] EMBR→Base watcher stopped");
}

// ---------------------------------------------------------------------------
// Loop B: Base → EMBR
// ---------------------------------------------------------------------------

/**
 * Submit a releaseEMBR call directly to the internal EMBR chain mempool and
 * wait for it to be mined.  Uses chain.submitTransaction() so we never go
 * through the external HTTP RPC endpoint, which hangs under mining load.
 */
async function relayBaseToEmbr(
  event: BridgeEvent,
  emberBridgeAddress: string,
  emberBridgeIface: ethers.Interface,
  relayerKey: string,
): Promise<void> {
  const { nonce, recipient, amount } = event;
  logger.info({ nonce, recipient, amount }, "[relayer] Base→EMBR: releasing EMBR");

  try {
    const txHash = await withRetry(`releaseEMBR(nonce=${nonce})`, async () => {
      const calldata = emberBridgeIface.encodeFunctionData("releaseEMBR", [
        recipient,
        BigInt(amount),
        BigInt(nonce),
      ]);
      const stored = await chain.submitTransaction({
        fromPrivateKey: relayerKey,
        to: emberBridgeAddress,
        value: "0",
        data: calldata,
        gasLimit: "300000",
      });

      // Poll chain.getTransaction until mined (status != "pending")
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        const tx = await chain.getTransaction(stored.hash);
        if (tx && tx.status !== "pending") {
          if (tx.status === "failed") {
            throw new Error(`releaseEMBR reverted on EMBR chain: ${tx.error ?? "unknown"}`);
          }
          return tx.hash;
        }
        await sleep(2_000);
      }
      throw new Error(`releaseEMBR tx ${stored.hash} not mined within 90 s`);
    }, 5);

    await markBridgeRelayed(nonce, txHash);
    logger.info({ nonce, txHash }, "[relayer] Base→EMBR: released ✓");
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ nonce, err: msg }, "[relayer] Base→EMBR: releaseEMBR failed");
    await recordBridgeAttempt(nonce, msg, 5);
  }
}

async function runBaseToEmbrLoop(
  baseProvider: ethers.JsonRpcProvider,
  embrWallet: ethers.Wallet,
  emberchainBridgeAddress: string,
  emberBridgeAddress: string,
  stopSignal: { stopped: boolean },
): Promise<void> {
  const emberBridgeIface = new ethers.Interface(EMBER_BRIDGE_ABI);
  const relayerKey = embrWallet.privateKey;

  // Start from ~1 day ago on first boot, then track latest block
  let fromBlock = (await baseProvider.getBlockNumber()) - 7200; // ~1 day at 12 s/block
  if (fromBlock < 0) fromBlock = 0;

  // Public RPC endpoints (e.g. mainnet.base.org) reject eth_getLogs requests
  // spanning large block ranges or returning large responses.  500 blocks is a
  // conservative chunk size that stays well under both limits.
  const LOG_CHUNK_SIZE = 500;

  logger.info({ fromBlock }, "[relayer] Base→EMBR watcher started");

  while (!stopSignal.stopped) {
    try {
      const toBlock = await baseProvider.getBlockNumber();

      // ── Phase 1: scan Base logs, insert any new BridgeOut events into DB ──
      if (toBlock > fromBlock) {
        const iface = new ethers.Interface(EMBERCHAIN_BRIDGE_ABI);
        const bridgeOutTopic = iface.getEvent("BridgeOut")?.topicHash ?? null;

        const rawLogs: ethers.Log[] = [];
        if (bridgeOutTopic) {
          for (let chunk = fromBlock; chunk <= toBlock; chunk += LOG_CHUNK_SIZE) {
            const chunkEnd = Math.min(chunk + LOG_CHUNK_SIZE - 1, toBlock);
            const chunkLogs = await baseProvider.getLogs({
              address: emberchainBridgeAddress,
              topics: [bridgeOutTopic],
              fromBlock: chunk,
              toBlock: chunkEnd,
            });
            rawLogs.push(...chunkLogs);
          }
        }

        for (const log of rawLogs) {
          const parsed = iface.parseLog(log);
          if (!parsed) continue;

          const nonce     = (parsed.args["nonce"] as bigint).toString();
          const sender    = parsed.args["sender"] as string;
          const recipient = parsed.args["embrRecipient"] as string;
          const amount    = (parsed.args["amount"] as bigint).toString();

          try {
            await createBridgeEvent({
              nonce,
              direction: "base_to_embr",
              sender: sender.toLowerCase(),
              recipient,
              amount,
              txHashSrc: log.transactionHash,
            });
          } catch (dbErr) {
            logger.error(
              { nonce, err: (dbErr as Error).message },
              "[relayer] Base→EMBR: DB write failed — will retry on next poll",
            );
            throw dbErr; // bubble up to outer catch → short sleep → retry
          }
        }

        fromBlock = toBlock + 1;
      }

      // ── Phase 2: relay every pending base_to_embr event from DB ──────────
      // This handles both freshly-inserted events AND events that were recorded
      // by a previous server run but never successfully relayed.
      const pending = await getPendingBridgeEvents("base_to_embr");
      for (const event of pending) {
        await relayBaseToEmbr(event, emberBridgeAddress, emberBridgeIface, relayerKey);
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "[relayer] Base→EMBR: poll error — will retry");
    }

    await sleep(12_000);
  }

  logger.info("[relayer] Base→EMBR watcher stopped");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface RelayerHandle {
  stop: () => void;
}

let _handle: RelayerHandle | null = null;

export function startBridgeRelayer(): RelayerHandle {
  if (_handle) return _handle; // Already running

  const cfg = getConfig();
  const stopSignal = { stopped: false };
  const loops: Promise<void>[] = [];

  // ── EMBR → Base (Loop A) ──────────────────────────────────────────────────

  const canRunEmbrToBase =
    cfg.relayerKey && cfg.baseRpcUrl && cfg.emberchainBridgeAddress;

  if (canRunEmbrToBase) {
    const baseProvider = new ethers.JsonRpcProvider(cfg.baseRpcUrl);
    const baseWallet   = new ethers.Wallet(cfg.relayerKey, baseProvider);
    loops.push(
      runEmbrToBaseLoop(baseWallet, cfg.emberchainBridgeAddress, stopSignal).catch((err) =>
        logger.error({ err: (err as Error).message }, "[relayer] EMBR→Base loop crashed"),
      ),
    );
  } else {
    logger.warn(
      "[relayer] EMBR→Base loop DISABLED — missing BASE_RPC_URL, BRIDGE_RELAYER_PRIVATE_KEY, or EMBERCHAIN_BRIDGE_ADDRESS",
    );
  }

  // ── Base → EMBR (Loop B) ──────────────────────────────────────────────────

  const canRunBaseToEmbr =
    cfg.relayerKey && cfg.baseRpcUrl && cfg.embrRpcUrl &&
    cfg.emberchainBridgeAddress && cfg.emberBridgeAddress;

  if (canRunBaseToEmbr) {
    const baseProvider = new ethers.JsonRpcProvider(cfg.baseRpcUrl);
    const embrProvider = new ethers.JsonRpcProvider(cfg.embrRpcUrl);
    const embrWallet   = new ethers.Wallet(cfg.relayerKey, embrProvider);
    loops.push(
      runBaseToEmbrLoop(
        baseProvider,
        embrWallet,
        cfg.emberchainBridgeAddress,
        cfg.emberBridgeAddress,
        stopSignal,
      ).catch((err) =>
        logger.error({ err: (err as Error).message }, "[relayer] Base→EMBR loop crashed"),
      ),
    );
  } else {
    logger.warn(
      "[relayer] Base→EMBR loop DISABLED — missing BASE_RPC_URL, BRIDGE_RELAYER_PRIVATE_KEY, EMBR_RPC_URL, EMBERCHAIN_BRIDGE_ADDRESS, or EMBER_BRIDGE_ADDRESS",
    );
  }

  _handle = {
    stop() {
      stopSignal.stopped = true;
      _handle = null;
    },
  };

  return _handle;
}

export function stopBridgeRelayer(): void {
  _handle?.stop();
}
