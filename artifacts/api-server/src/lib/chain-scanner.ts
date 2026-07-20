/**
 * Chain Scanner
 *
 * Runs a background loop that scans every transaction in the chain history,
 * finds contract deployment transactions (to === null), auto-detects ERC-20
 * tokens, and populates the contract_registry table.
 *
 * This is what makes "GET /api/tokens" return all tokens that have been
 * deployed on the chain — analogous to how Etherscan discovers tokens.
 */

import { ethers } from "ethers";
import { chain } from "./chain";
import { upsertContractRecord, getContractRecord, ensureContractTable } from "./contract-registry";
import { logger } from "./logger";

const coder = ethers.AbiCoder.defaultAbiCoder();

// ---------------------------------------------------------------------------
// ERC-20 detection (shared — also imported by contracts route)
// ---------------------------------------------------------------------------

async function callView(
  to: string,
  selector: string,
  types: string[],
): Promise<unknown[] | null> {
  try {
    const result = await chain.callContract({ to, data: selector });
    if (!result.success || !result.returnData || result.returnData === "0x") return null;
    return coder.decode(types, result.returnData) as unknown[];
  } catch {
    return null;
  }
}

export async function detectERC20(address: string): Promise<{
  name: string; symbol: string; decimals: number; totalSupply: string;
} | null> {
  const [nameR, symbolR, decimalsR, supplyR] = await Promise.all([
    callView(address, "0x06fdde03", ["string"]),   // name()
    callView(address, "0x95d89b41", ["string"]),   // symbol()
    callView(address, "0x313ce567", ["uint8"]),    // decimals()
    callView(address, "0x18160ddd", ["uint256"]),  // totalSupply()
  ]);
  if (!nameR || !symbolR) return null;
  return {
    name:        String(nameR[0]),
    symbol:      String(symbolR[0]),
    decimals:    decimalsR ? Number(decimalsR[0]) : 18,
    totalSupply: supplyR  ? String(supplyR[0])    : "0",
  };
}

export async function callViewRaw(
  to: string,
  selector: string,
  types: string[],
): Promise<unknown[] | null> {
  return callView(to, selector, types);
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/** Set of contract addresses already indexed in this process run */
const indexed = new Set<string>();

async function scanOnce(): Promise<void> {
  // Grab every transaction the chain knows about (no address filter, very high limit)
  const txs = await chain.listTransactions(undefined, 1_000_000);

  // Filter for successful contract deployments
  const deployments = txs.filter(
    (tx) => tx.to === null && tx.status === "success" && tx.contractAddress,
  );

  if (deployments.length === 0) return;

  let added = 0;
  for (const tx of deployments) {
    const addr = tx.contractAddress!.toLowerCase();

    // Skip if we've already processed this address in this run
    if (indexed.has(addr)) continue;

    // Check DB — if it's there and already has token info, skip the EVM call
    const existing = await getContractRecord(addr);
    if (existing && (existing.isToken || existing.name)) {
      indexed.add(addr);
      continue;
    }

    // Probe the contract
    const erc20 = await detectERC20(addr);

    await upsertContractRecord({
      address:     addr,
      isToken:     !!erc20,
      name:        erc20?.name        ?? null,
      symbol:      erc20?.symbol      ?? null,
      decimals:    erc20?.decimals    ?? null,
      totalSupply: erc20?.totalSupply ?? null,
      creator:     tx.from?.toLowerCase() ?? null,
      creatorTx:   tx.hash,
    });

    indexed.add(addr);
    added++;

    if (erc20) {
      logger.info(
        { address: addr, name: erc20.name, symbol: erc20.symbol, creator: tx.from },
        "[scanner] ERC-20 token discovered",
      );
    }
  }

  if (added > 0) {
    logger.info({ discovered: added, total: deployments.length }, "[scanner] scan complete");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let _timer: ReturnType<typeof setInterval> | null = null;

export function startChainScanner(): void {
  if (_timer) return;

  // Ensure the registry table exists before we start writing
  ensureContractTable()
    .then(() => scanOnce())
    .catch((err: Error) => logger.warn({ err: err.message }, "[scanner] initial scan error"));

  // Re-scan every 30 s to pick up newly deployed contracts
  _timer = setInterval(() => {
    scanOnce().catch((err: Error) =>
      logger.warn({ err: err.message }, "[scanner] periodic scan error"),
    );
  }, 30_000);
}

export function stopChainScanner(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
