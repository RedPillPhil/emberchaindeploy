/**
 * Ethereum JSON-RPC 2.0 endpoint — makes Emberchain visible to MetaMask and
 * any other EVM-compatible wallet or tooling.
 *
 * Add the network in MetaMask:
 *   Network name : Emberchain
 *   RPC URL      : https://<your-domain>/api/rpc
 *   Chain ID     : 7773
 *   Currency     : EMBR
 *   Explorer     : https://<your-domain>/ledger
 */

import { Router } from "express";
import { createTxFromRLP } from "@ethereumjs/tx";
import { bytesToHex, hexToBytes } from "@ethereumjs/util";
import type { PrefixedHexString } from "@ethereumjs/util";
import { EMBERCHAIN_ID, createEmberchainCommon, GAS_PRICE } from "@workspace/chain-core";
import type { StoredBlock, StoredTransaction } from "@workspace/chain-core";
import { chain } from "../lib/chain";

const router = Router();
const CHAIN_ID_HEX = "0x" + EMBERCHAIN_ID.toString(16); // "0x1e5d"
const ZERO_BLOOM = "0x" + "0".repeat(512);
const EMPTY_UNCLE_HASH = "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347";
const common = createEmberchainCommon();

// ── helpers ──────────────────────────────────────────────────────────────────

function toHex(n: number | bigint): string {
  return "0x" + n.toString(16);
}

function toQuantity(s: string): string {
  // decimal string → hex, strip leading zeros
  const h = BigInt(s).toString(16);
  return "0x" + (h || "0");
}

function formatBlock(
  block: StoredBlock,
  txs: StoredTransaction[],
  fullTx: boolean,
) {
  const ts = Math.floor(new Date(block.timestamp).getTime() / 1000);
  return {
    number: toHex(block.number),
    hash: block.hash,
    parentHash: block.parentHash,
    nonce: "0x0000000000000000",
    sha3Uncles: EMPTY_UNCLE_HASH,
    logsBloom: ZERO_BLOOM,
    transactionsRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    stateRoot: block.stateRoot,
    receiptsRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    miner: block.miner,
    difficulty: toQuantity(block.difficulty),
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x400",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    timestamp: toHex(ts),
    transactions: fullTx
      ? txs.map((tx) => formatTx(tx, block.hash))
      : txs.map((tx) => tx.hash),
    uncles: [],
    baseFeePerGas: "0x0",
  };
}

function formatTx(tx: StoredTransaction, blockHash?: string) {
  const blk = blockHash ?? chain.getBlockForTx(tx.hash)?.hash ?? null;
  return {
    blockHash: blk,
    blockNumber: tx.blockNumber !== null ? toHex(tx.blockNumber) : null,
    from: tx.from,
    gas: toQuantity(tx.gasLimit),
    gasPrice: "0x" + GAS_PRICE.toString(16),
    maxFeePerGas: "0x" + GAS_PRICE.toString(16),
    maxPriorityFeePerGas: "0x" + GAS_PRICE.toString(16),
    hash: tx.hash,
    input: tx.data,
    nonce: toHex(tx.nonce),
    to: tx.to ?? null,
    transactionIndex: "0x0",
    value: toQuantity(tx.value),
    type: "0x2",
    chainId: CHAIN_ID_HEX,
    v: "0x0",
    r: "0x0",
    s: "0x0",
  };
}

function formatReceipt(tx: StoredTransaction) {
  if (tx.status === "pending") return null; // not yet mined
  const blk = chain.getBlockForTx(tx.hash);
  return {
    blockHash: blk?.hash ?? null,
    blockNumber: tx.blockNumber !== null ? toHex(tx.blockNumber) : null,
    contractAddress: tx.contractAddress ?? null,
    cumulativeGasUsed: toHex(BigInt(tx.gasUsed ?? "21000")),
    effectiveGasPrice: "0x0",
    from: tx.from,
    gasUsed: toHex(BigInt(tx.gasUsed ?? "21000")),
    logs: [],
    logsBloom: ZERO_BLOOM,
    status: tx.status === "success" ? "0x1" : "0x0",
    to: tx.to ?? null,
    transactionHash: tx.hash,
    transactionIndex: "0x0",
    type: "0x0",
  };
}

async function resolveBlock(tag: string) {
  if (!tag || tag === "latest" || tag === "pending" || tag === "safe" || tag === "finalized") {
    const s = await chain.getStatus();
    return chain.getBlock(s.height);
  }
  if (tag === "earliest") return chain.getBlock(0);
  return chain.getBlock(parseInt(tag, 16));
}

// ── JSON-RPC dispatcher ───────────────────────────────────────────────────────

type RpcResult = unknown;

async function dispatch(method: string, params: unknown[]): Promise<RpcResult> {
  await chain.whenReady();

  switch (method) {
    // ── Identity ──
    case "web3_clientVersion": return "Emberchain/v1.0.0";
    case "web3_sha3": return "0x"; // keccak not needed for wallet connectivity
    case "net_version": return String(EMBERCHAIN_ID);
    case "net_listening": return true;
    case "net_peerCount": return "0x0";
    case "eth_protocolVersion": return "0x41";
    case "eth_syncing": return false;
    case "eth_coinbase": return "0x0000000000000000000000000000000000000000";
    case "eth_chainId": return CHAIN_ID_HEX;
    case "eth_accounts": return [];

    // ── Gas / fees ──
    case "eth_gasPrice": return "0x" + GAS_PRICE.toString(16); // 1 gwei
    case "eth_maxPriorityFeePerGas": return "0x" + GAS_PRICE.toString(16);
    case "eth_feeHistory": {
      const s = await chain.getStatus();
      const baseFee = "0x" + GAS_PRICE.toString(16);
      return {
        oldestBlock: toHex(Math.max(1, s.height - 4)),
        baseFeePerGas: Array(6).fill(baseFee),
        gasUsedRatio: Array(5).fill(0.1),
        reward: Array(5).fill(["0x" + GAS_PRICE.toString(16)]),
      };
    }

    // ── Block number ──
    case "eth_blockNumber": {
      const s = await chain.getStatus();
      return toHex(s.height);
    }

    // ── Balances / account state ──
    case "eth_getBalance": {
      const w = await chain.getWallet(params[0] as PrefixedHexString);
      return toQuantity(w.balance);
    }
    case "eth_getTransactionCount": {
      const w = await chain.getWallet(params[0] as PrefixedHexString);
      return toHex(w.nonce);
    }
    case "eth_getCode": return chain.getContractCode(params[0] as string);
    case "eth_getStorageAt": return "0x0000000000000000000000000000000000000000000000000000000000000000";

    // ── Blocks ──
    case "eth_getBlockByNumber": {
      const block = await resolveBlock(params[0] as string);
      if (!block) return null;
      return formatBlock(block, block.transactions, params[1] === true);
    }
    case "eth_getBlockByHash": {
      const block = await chain.getBlockByHash(params[0] as string);
      if (!block) return null;
      return formatBlock(block, block.transactions, params[1] === true);
    }
    case "eth_getBlockTransactionCountByNumber": {
      const block = await resolveBlock(params[0] as string);
      return toHex(block?.transactions.length ?? 0);
    }
    case "eth_getBlockTransactionCountByHash": {
      const block = await chain.getBlockByHash(params[0] as string);
      return toHex(block?.transactions.length ?? 0);
    }
    case "eth_getUncleCountByBlockHash":
    case "eth_getUncleCountByBlockNumber": return "0x0";

    // ── Transactions ──
    case "eth_getTransactionByHash": {
      const tx = await chain.getTransaction(params[0] as string);
      return tx ? formatTx(tx) : null;
    }
    case "eth_getTransactionByBlockNumberAndIndex": {
      const block = await resolveBlock(params[0] as string);
      const idx = parseInt(params[1] as string, 16);
      const tx = block?.transactions[idx];
      return tx ? formatTx(tx, block!.hash) : null;
    }
    case "eth_getTransactionByBlockHashAndIndex": {
      const block = await chain.getBlockByHash(params[0] as string);
      const idx = parseInt(params[1] as string, 16);
      const tx = block?.transactions[idx];
      return tx ? formatTx(tx, block!.hash) : null;
    }
    case "eth_getTransactionReceipt": {
      const tx = await chain.getTransaction(params[0] as string);
      return tx ? formatReceipt(tx) : null;
    }

    // ── Send raw transaction ──
    case "eth_sendRawTransaction": {
      const raw = params[0] as string;
      let rawBytes: Uint8Array;
      try {
        rawBytes = hexToBytes(raw as PrefixedHexString);
      } catch {
        throw rpcError(-32602, "Invalid raw transaction hex");
      }

      let parsed;
      try {
        parsed = createTxFromRLP(rawBytes, { common });
      } catch (e) {
        throw rpcError(-32602, `Could not parse transaction: ${(e as Error).message}`);
      }
      if (!parsed.verifySignature()) {
        throw rpcError(-32602, "Invalid transaction signature");
      }

      const from = parsed.getSenderAddress().toString() as PrefixedHexString;
      const hash = bytesToHex(parsed.hash()) as PrefixedHexString;
      const to = parsed.to?.toString() as PrefixedHexString | undefined;
      const value = parsed.value.toString();
      const data = bytesToHex(parsed.data) as PrefixedHexString;
      const gasLimit = parsed.gasLimit.toString();
      const nonce = parsed.nonce;

      await chain.submitRawEVMTransaction({
        hash,
        from,
        to: to ?? null,
        value,
        data,
        gasLimit,
        nonce,
      });
      return hash;
    }

    // ── eth_call (read-only contract call) ──
    case "eth_call": {
      const callObj = params[0] as { to?: string; from?: string; data?: string };
      if (!callObj.to) return "0x";
      const result = await chain.callContract({
        to: callObj.to,
        data: callObj.data ?? "0x",
        from: callObj.from ?? null,
      });
      return result.returnData;
    }

    // ── Gas estimation ──
    case "eth_estimateGas": {
      const callObj = params[0] as { to?: string; from?: string; data?: string; value?: string } | undefined;
      const gas = await chain.estimateGas({
        to: callObj?.to ?? null,
        data: callObj?.data,
        from: callObj?.from ?? null,
        value: callObj?.value ? BigInt(callObj.value) : 0n,
      });
      return "0x" + gas.toString(16);
    }

    // ── Logs / filters (stub — no log indexing yet) ──
    case "eth_getLogs": return [];
    case "eth_newFilter":
    case "eth_newBlockFilter":
    case "eth_newPendingTransactionFilter": return "0x1";
    case "eth_getFilterChanges":
    case "eth_getFilterLogs": return [];
    case "eth_uninstallFilter": return true;

    // ── Subscriptions (not supported over HTTP) ──
    case "eth_subscribe":
    case "eth_unsubscribe":
      throw rpcError(-32601, "Subscriptions require a WebSocket connection");

    default:
      throw rpcError(-32601, `Method not supported: ${method}`);
  }
}

function rpcError(code: number, message: string) {
  const e = new Error(message) as Error & { rpcCode: number };
  e.rpcCode = code;
  return e;
}

// ── Route handler ─────────────────────────────────────────────────────────────

router.post("/rpc", async (req, res) => {
  const body = req.body as
    | { jsonrpc: string; id: unknown; method: string; params?: unknown[] }
    | Array<{ jsonrpc: string; id: unknown; method: string; params?: unknown[] }>;

  // Batch support
  if (Array.isArray(body)) {
    const results = await Promise.all(
      body.map(async (item) => {
        try {
          const result = await dispatch(item.method, item.params ?? []);
          return { jsonrpc: "2.0", id: item.id, result };
        } catch (err) {
          const e = err as Error & { rpcCode?: number };
          return {
            jsonrpc: "2.0",
            id: item.id,
            error: { code: e.rpcCode ?? -32603, message: e.message },
          };
        }
      }),
    );
    res.json(results);
    return;
  }

  try {
    const result = await dispatch(body.method, body.params ?? []);
    res.json({ jsonrpc: "2.0", id: body.id, result });
  } catch (err) {
    const e = err as Error & { rpcCode?: number };
    res.json({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: e.rpcCode ?? -32603, message: e.message },
    });
  }
});

export default router;
