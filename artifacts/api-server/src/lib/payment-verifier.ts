/**
 * Off-chain payment verification for the P2P Exchange.
 *
 * Each currency uses a different public block explorer API:
 *   ETH  — Etherscan (requires ETHERSCAN_API_KEY env var)
 *   USDT — Routed by selectedNetwork:
 *            ERC-20   → Etherscan (same key, parses ERC-20 Transfer logs)
 *            TRC-20   → Tronscan public API (no key needed)
 *            BEP-20   → BSCScan (requires BSCSCAN_API_KEY env var)
 *            Polygon  → Polygonscan (requires POLYGONSCAN_API_KEY env var)
 *   BTC  — Blockstream.info REST API (no key needed)
 *   SOL  — Solana public JSON-RPC (no key needed)
 *
 * The verifier never touches funds or executes any transactions.
 * It only reads public blockchain data to confirm that a payment
 * from the buyer already occurred.
 */

import type { ExchangeCurrency } from "@workspace/chain-core";

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  confirmations?: number;
}

const ETH_CONFIRMATIONS_REQUIRED = 12;
const BSC_CONFIRMATIONS_REQUIRED = 15;
const POLYGON_CONFIRMATIONS_REQUIRED = 128;
const BTC_CONFIRMATIONS_REQUIRED = 2;

// USDT (Tether) contract addresses
const USDT_ERC20_CONTRACT  = "0xdac17f958d2ee523a2206206994597c13d831ec7"; // Ethereum mainnet
const USDT_BEP20_CONTRACT  = "0x55d398326f99059ff775485246999027b3197955"; // BSC mainnet
const USDT_POLYGON_CONTRACT = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f"; // Polygon mainnet
const USDT_TRC20_CONTRACT  = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";         // Tron mainnet

// keccak256("Transfer(address,address,uint256)")
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// ── helpers ──────────────────────────────────────────────────────────────────

function etherscanKey(): string {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) throw new Error("ETHERSCAN_API_KEY is not configured on this server. Ask the server operator to add it.");
  return key;
}

async function etherscanGet(params: Record<string, string>): Promise<unknown> {
  const key = etherscanKey();
  // V2 API — requires chainid; chainid=1 is Ethereum mainnet
  const qs = new URLSearchParams({ chainid: "1", ...params, apikey: key }).toString();
  const res = await fetch(`https://api.etherscan.io/v2/api?${qs}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Etherscan HTTP ${res.status}`);
  const json = (await res.json()) as { status: string; message: string; result: unknown };
  if (json.status === "0" && json.message !== "No transactions found") {
    throw new Error(`Etherscan error: ${json.message}`);
  }
  return json.result;
}

async function bscscanGet(params: Record<string, string>): Promise<unknown> {
  const key = process.env.BSCSCAN_API_KEY;
  if (!key) throw new Error("BSCSCAN_API_KEY is not configured on this server. Ask the server operator to add it.");
  const qs = new URLSearchParams({ ...params, apikey: key }).toString();
  const res = await fetch(`https://api.bscscan.com/api?${qs}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`BSCScan HTTP ${res.status}`);
  const json = (await res.json()) as { status: string; message: string; result: unknown };
  if (json.status === "0" && json.message !== "No transactions found") {
    throw new Error(`BSCScan error: ${json.message}`);
  }
  return json.result;
}

async function polygonscanGet(params: Record<string, string>): Promise<unknown> {
  const key = process.env.POLYGONSCAN_API_KEY;
  if (!key) throw new Error("POLYGONSCAN_API_KEY is not configured on this server. Ask the server operator to add it.");
  const qs = new URLSearchParams({ ...params, apikey: key }).toString();
  const res = await fetch(`https://api.polygonscan.com/api?${qs}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Polygonscan HTTP ${res.status}`);
  const json = (await res.json()) as { status: string; message: string; result: unknown };
  if (json.status === "0" && json.message !== "No transactions found") {
    throw new Error(`Polygonscan error: ${json.message}`);
  }
  return json.result;
}

/** Parse a human-readable decimal string into the smallest unit bigint. */
function parseDecimal(value: string, decimals: number): bigint {
  const [whole, frac = ""] = value.split(".");
  const fracPadded = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

/** Shared logic for verifying an ERC-20 USDT-style Transfer log on any EVM chain. */
async function verifyErc20Transfer(
  params: {
    txHash: string;
    receiveAddress: string;
    priceAmount: string;
    contractAddress: string;
    confirmationsRequired: number;
    getScanReceipt: (txHash: string) => Promise<unknown>;
    getScanBlockNumber: () => Promise<string>;
    chainLabel: string;
  }
): Promise<VerifyResult> {
  type Receipt = {
    blockNumber: string | null;
    logs: Array<{ address: string; topics: string[]; data: string }>;
  } | null;

  const receipt = (await params.getScanReceipt(params.txHash)) as Receipt;
  if (!receipt) return { valid: false, reason: `Transaction not found on ${params.chainLabel}` };
  if (!receipt.blockNumber) return { valid: false, reason: "Transaction not yet mined" };

  const transferLog = receipt.logs.find((log) => {
    if (log.address.toLowerCase() !== params.contractAddress.toLowerCase()) return false;
    if (log.topics[0] !== ERC20_TRANSFER_TOPIC) return false;
    const toAddr = "0x" + (log.topics[2] ?? "").slice(26);
    return toAddr.toLowerCase() === params.receiveAddress.toLowerCase();
  });

  if (!transferLog) {
    return {
      valid: false,
      reason: `No USDT Transfer to ${params.receiveAddress} found in transaction logs (${params.chainLabel})`,
    };
  }

  // USDT has 6 decimals on all EVM chains
  const amountSent = BigInt(transferLog.data);
  const amountRequired = parseDecimal(params.priceAmount, 6);
  if (amountSent < amountRequired) {
    return {
      valid: false,
      reason: `Insufficient USDT — sent ${amountSent} (6-dec units), required ${amountRequired} (${params.priceAmount} USDT)`,
    };
  }

  const currentBlockHex = await params.getScanBlockNumber();
  const confirmations = parseInt(currentBlockHex, 16) - parseInt(receipt.blockNumber, 16);
  if (confirmations < params.confirmationsRequired) {
    return {
      valid: false,
      reason: `Only ${confirmations} confirmation(s) — need ${params.confirmationsRequired} for safety`,
      confirmations,
    };
  }

  return { valid: true, confirmations };
}

// ── public entry point ────────────────────────────────────────────────────────

export async function verifyPayment(
  currency: ExchangeCurrency,
  txHash: string,
  receiveAddress: string,
  priceAmount: string,
  selectedNetwork?: string,
): Promise<VerifyResult> {
  try {
    switch (currency) {
      case "ETH":  return await verifyEth(txHash, receiveAddress, priceAmount);
      case "USDT": return await verifyUsdt(txHash, receiveAddress, priceAmount, selectedNetwork);
      case "BTC":  return await verifyBtc(txHash, receiveAddress, priceAmount);
      case "SOL":  return await verifySol(txHash, receiveAddress, priceAmount);
    }
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : "Verification failed" };
  }
}

// ── ETH ──────────────────────────────────────────────────────────────────────

async function verifyEth(txHash: string, receiveAddress: string, priceAmount: string): Promise<VerifyResult> {
  type EthTx = { to: string | null; value: string; blockNumber: string | null } | null;
  const tx = (await etherscanGet({ module: "proxy", action: "eth_getTransactionByHash", txhash: txHash })) as EthTx;

  if (!tx) return { valid: false, reason: "Transaction not found on Ethereum mainnet" };
  if (tx.to?.toLowerCase() !== receiveAddress.toLowerCase()) {
    return { valid: false, reason: `Wrong recipient — tx sends to ${tx.to}, listing expects ${receiveAddress}` };
  }

  const weiSent = BigInt(tx.value);
  const weiRequired = parseDecimal(priceAmount, 18);
  if (weiSent < weiRequired) {
    return {
      valid: false,
      reason: `Insufficient ETH — sent ${weiSent} wei, required ${weiRequired} wei (${priceAmount} ETH)`,
    };
  }

  if (!tx.blockNumber) return { valid: false, reason: "Transaction not yet mined" };

  const currentBlockHex = (await etherscanGet({ module: "proxy", action: "eth_blockNumber" })) as string;
  const confirmations = parseInt(currentBlockHex, 16) - parseInt(tx.blockNumber, 16);
  if (confirmations < ETH_CONFIRMATIONS_REQUIRED) {
    return {
      valid: false,
      reason: `Only ${confirmations} confirmation(s) — need ${ETH_CONFIRMATIONS_REQUIRED} for safety`,
      confirmations,
    };
  }

  return { valid: true, confirmations };
}

// ── USDT (multi-chain router) ─────────────────────────────────────────────────

async function verifyUsdt(
  txHash: string,
  receiveAddress: string,
  priceAmount: string,
  selectedNetwork?: string,
): Promise<VerifyResult> {
  const network = selectedNetwork ?? "ERC-20";
  switch (network) {
    case "ERC-20":  return await verifyUsdtErc20(txHash, receiveAddress, priceAmount);
    case "TRC-20":  return await verifyUsdtTrc20(txHash, receiveAddress, priceAmount);
    case "BEP-20":  return await verifyUsdtBep20(txHash, receiveAddress, priceAmount);
    case "Polygon": return await verifyUsdtPolygon(txHash, receiveAddress, priceAmount);
    default:
      return { valid: false, reason: `Unknown USDT network: ${network}. Supported: ERC-20, TRC-20, BEP-20, Polygon.` };
  }
}

// ── USDT ERC-20 (Ethereum) ────────────────────────────────────────────────────

async function verifyUsdtErc20(txHash: string, receiveAddress: string, priceAmount: string): Promise<VerifyResult> {
  return verifyErc20Transfer({
    txHash, receiveAddress, priceAmount,
    contractAddress: USDT_ERC20_CONTRACT,
    confirmationsRequired: ETH_CONFIRMATIONS_REQUIRED,
    chainLabel: "Ethereum mainnet",
    getScanReceipt: (h) => etherscanGet({ module: "proxy", action: "eth_getTransactionReceipt", txhash: h }),
    getScanBlockNumber: () => etherscanGet({ module: "proxy", action: "eth_blockNumber" }) as Promise<string>,
  });
}

// ── USDT TRC-20 (Tron) ───────────────────────────────────────────────────────

async function verifyUsdtTrc20(txHash: string, receiveAddress: string, priceAmount: string): Promise<VerifyResult> {
  // Tronscan public API — no key required
  const res = await fetch(`https://apilist.tronscanapi.com/api/transaction-info?hash=${encodeURIComponent(txHash)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Tronscan HTTP ${res.status}`);

  type TronTx = {
    confirmed?: boolean;
    confirmations?: number;
    contractRet?: string;
    trc20TransferInfo?: Array<{
      contract_address: string;
      to_address: string;
      amount_str: string;
    }>;
  };
  const tx = (await res.json()) as TronTx;

  if (!tx || !tx.confirmed) {
    return { valid: false, reason: "Tron transaction not found or not yet confirmed" };
  }
  if (tx.contractRet && tx.contractRet !== "SUCCESS") {
    return { valid: false, reason: `Tron transaction failed on-chain: ${tx.contractRet}` };
  }

  // Find a USDT TRC-20 transfer to the receive address
  const transfer = (tx.trc20TransferInfo ?? []).find(
    (t) =>
      t.contract_address === USDT_TRC20_CONTRACT &&
      t.to_address === receiveAddress,
  );
  if (!transfer) {
    return {
      valid: false,
      reason: `No USDT TRC-20 Transfer to ${receiveAddress} found in this Tron transaction`,
    };
  }

  // USDT on Tron has 6 decimals
  const amountSent = BigInt(transfer.amount_str ?? "0");
  const amountRequired = parseDecimal(priceAmount, 6);
  if (amountSent < amountRequired) {
    return {
      valid: false,
      reason: `Insufficient USDT — sent ${amountSent} (6-dec units), required ${amountRequired} (${priceAmount} USDT)`,
    };
  }

  // Tron finalizes quickly; if confirmed = true that's sufficient
  return { valid: true, confirmations: tx.confirmations ?? 1 };
}

// ── USDT BEP-20 (BSC) ────────────────────────────────────────────────────────

async function verifyUsdtBep20(txHash: string, receiveAddress: string, priceAmount: string): Promise<VerifyResult> {
  return verifyErc20Transfer({
    txHash, receiveAddress, priceAmount,
    contractAddress: USDT_BEP20_CONTRACT,
    confirmationsRequired: BSC_CONFIRMATIONS_REQUIRED,
    chainLabel: "BSC mainnet",
    getScanReceipt: (h) => bscscanGet({ module: "proxy", action: "eth_getTransactionReceipt", txhash: h }),
    getScanBlockNumber: () => bscscanGet({ module: "proxy", action: "eth_blockNumber" }) as Promise<string>,
  });
}

// ── USDT Polygon ──────────────────────────────────────────────────────────────

async function verifyUsdtPolygon(txHash: string, receiveAddress: string, priceAmount: string): Promise<VerifyResult> {
  return verifyErc20Transfer({
    txHash, receiveAddress, priceAmount,
    contractAddress: USDT_POLYGON_CONTRACT,
    confirmationsRequired: POLYGON_CONFIRMATIONS_REQUIRED,
    chainLabel: "Polygon mainnet",
    getScanReceipt: (h) => polygonscanGet({ module: "proxy", action: "eth_getTransactionReceipt", txhash: h }),
    getScanBlockNumber: () => polygonscanGet({ module: "proxy", action: "eth_blockNumber" }) as Promise<string>,
  });
}

// ── BTC ──────────────────────────────────────────────────────────────────────

async function verifyBtc(txHash: string, receiveAddress: string, priceAmount: string): Promise<VerifyResult> {
  // Blockstream.info — public REST API, no key required
  const res = await fetch(`https://blockstream.info/api/tx/${txHash}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return { valid: false, reason: "Bitcoin transaction not found" };
  if (!res.ok) throw new Error(`Blockstream HTTP ${res.status}`);

  const tx = (await res.json()) as {
    status: { confirmed: boolean; block_height?: number };
    vout: Array<{ scriptpubkey_address?: string; value: number }>; // value in satoshis
  };

  const output = tx.vout.find((o) => o.scriptpubkey_address === receiveAddress);
  if (!output) {
    return { valid: false, reason: `No output to ${receiveAddress} in this Bitcoin transaction` };
  }

  // priceAmount is in BTC; 1 BTC = 100,000,000 satoshis (8 decimals)
  const satoshisRequired = parseDecimal(priceAmount, 8);
  if (BigInt(output.value) < satoshisRequired) {
    return {
      valid: false,
      reason: `Insufficient BTC — output ${output.value} sat, required ${satoshisRequired} sat (${priceAmount} BTC)`,
    };
  }

  if (!tx.status.confirmed) return { valid: false, reason: "Bitcoin transaction not yet confirmed" };

  const tipRes = await fetch("https://blockstream.info/api/blocks/tip/height", {
    signal: AbortSignal.timeout(10_000),
  });
  const tip = (await tipRes.json()) as number;
  const confirmations = tx.status.block_height ? tip - tx.status.block_height + 1 : 0;
  if (confirmations < BTC_CONFIRMATIONS_REQUIRED) {
    return {
      valid: false,
      reason: `Only ${confirmations} confirmation(s) — need ${BTC_CONFIRMATIONS_REQUIRED} for safety`,
      confirmations,
    };
  }

  return { valid: true, confirmations };
}

// ── SOL ──────────────────────────────────────────────────────────────────────

async function verifySol(txHash: string, receiveAddress: string, priceAmount: string): Promise<VerifyResult> {
  // Solana public mainnet RPC — no key needed for basic lookups
  const rpcRes = await fetch("https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [txHash, { encoding: "json", commitment: "finalized", maxSupportedTransactionVersion: 0 }],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  type SolTx = {
    meta: { preBalances: number[]; postBalances: number[]; err: unknown };
    transaction: { message: { accountKeys: string[] } };
  };
  const data = (await rpcRes.json()) as { result: SolTx | null };

  if (!data.result) return { valid: false, reason: "Solana transaction not found or not finalized yet" };
  if (data.result.meta.err) return { valid: false, reason: "Solana transaction failed on-chain" };

  const keys = data.result.transaction.message.accountKeys;
  const idx = keys.findIndex((k) => k === receiveAddress);
  if (idx === -1) {
    return { valid: false, reason: `Receive address ${receiveAddress} is not an account in this transaction` };
  }

  // Balance change in lamports; 1 SOL = 1,000,000,000 lamports (9 decimals)
  const lamportsReceived =
    (data.result.meta.postBalances[idx] ?? 0) - (data.result.meta.preBalances[idx] ?? 0);
  const lamportsRequired = parseDecimal(priceAmount, 9);

  if (BigInt(lamportsReceived) < lamportsRequired) {
    return {
      valid: false,
      reason: `Insufficient SOL — received ${lamportsReceived} lamports, required ${lamportsRequired} (${priceAmount} SOL)`,
    };
  }

  return { valid: true, confirmations: 1 }; // "finalized" = confirmed
}
