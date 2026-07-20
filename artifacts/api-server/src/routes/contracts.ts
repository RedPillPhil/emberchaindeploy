import { Router, type IRouter, type Request, type Response } from "express";
import { ethers } from "ethers";
import { chain } from "../lib/chain";
import {
  ensureContractTable,
  getContractRecord,
  upsertContractRecord,
  listTokens,
  listContracts,
} from "../lib/contract-registry";
import { detectERC20, callViewRaw as callView } from "../lib/chain-scanner";

ensureContractTable().catch(() => {});

const router: IRouter = Router();
const coder = ethers.AbiCoder.defaultAbiCoder();

/** Call balanceOf(address) on an ERC-20 */
async function balanceOf(tokenAddress: string, walletAddress: string): Promise<string> {
  try {
    const padded = walletAddress.toLowerCase().replace("0x", "").padStart(64, "0");
    const data   = "0x70a08231" + padded; // balanceOf(address)
    const result = await chain.callContract({ to: tokenAddress, data });
    if (!result.success || !result.returnData || result.returnData === "0x") return "0";
    const [bal] = coder.decode(["uint256"], result.returnData) as [bigint];
    return bal.toString();
  } catch {
    return "0";
  }
}

// ---------------------------------------------------------------------------
// ABI call helpers
// ---------------------------------------------------------------------------

function encodeCall(abi: object[], functionName: string, args: unknown[]): string {
  const iface = new ethers.Interface(abi as ethers.InterfaceAbi);
  return iface.encodeFunctionData(functionName, args);
}

function decodeReturn(abi: object[], functionName: string, data: string): unknown {
  const iface = new ethers.Interface(abi as ethers.InterfaceAbi);
  const result = iface.decodeFunctionResult(functionName, data);
  // Convert Result object to plain array/values
  return result.length === 1 ? formatValue(result[0]) : [...result].map(formatValue);
}

function formatValue(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(formatValue);
  if (v && typeof v === "object" && Symbol.iterator in v) return [...(v as Iterable<unknown>)].map(formatValue);
  return v;
}

// ---------------------------------------------------------------------------
// GET /contracts/list — all deployed contracts (tokens + non-tokens)
// Must be registered BEFORE /contracts/:address to avoid Express swallowing
// the literal "list" segment as an address parameter.
// ---------------------------------------------------------------------------

router.get("/contracts/list", async (_req: Request, res: Response): Promise<void> => {
  const contracts = await listContracts();
  res.json(contracts);
});

// ---------------------------------------------------------------------------
// GET /contracts/:address — contract info + auto ERC-20 detect
// ---------------------------------------------------------------------------

router.get("/contracts/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params as { address: string };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  const bytecode = await chain.getContractCode(address);
  const isContract = bytecode !== "0x" && bytecode.length > 2;

  if (!isContract) {
    res.json({ address, isContract: false, bytecode: "0x" });
    return;
  }

  // Check registry
  let record = await getContractRecord(address);

  // Auto-detect ERC-20 if not already known
  if (!record || (!record.isToken && !record.name)) {
    const erc20 = await detectERC20(address);
    if (erc20) {
      record = await upsertContractRecord({
        address,
        isToken:     true,
        name:        erc20.name,
        symbol:      erc20.symbol,
        decimals:    erc20.decimals,
        totalSupply: erc20.totalSupply,
        abi:         record?.abi ?? null,
      });
    }
  }

  res.json({
    address,
    isContract:  true,
    bytecodeSize: (bytecode.length - 2) / 2,
    abi:          record?.abi ?? null,
    name:         record?.name ?? null,
    symbol:       record?.symbol ?? null,
    decimals:     record?.decimals ?? null,
    totalSupply:  record?.totalSupply ?? null,
    isToken:      record?.isToken ?? false,
    creator:      record?.creator ?? null,
    creatorTx:    record?.creatorTx ?? null,
    createdAt:    record?.createdAt ?? null,
  });
});

// ---------------------------------------------------------------------------
// POST /contracts/:address/register — save ABI (and optional creator info)
// ---------------------------------------------------------------------------

router.post("/contracts/:address/register", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params as { address: string };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { res.status(400).json({ error: "Invalid address" }); return; }

  const { abi, creator, creatorTx } = req.body as { abi?: object[]; creator?: string; creatorTx?: string };
  if (!abi || !Array.isArray(abi)) { res.status(400).json({ error: "abi must be an array" }); return; }

  const record = await upsertContractRecord({ address, abi, creator, creatorTx });

  // Re-detect ERC-20 with the new ABI present
  const erc20 = await detectERC20(address);
  if (erc20 && !record.isToken) {
    await upsertContractRecord({ address, isToken: true, ...erc20 });
  }

  res.json({ success: true, address });
});

// ---------------------------------------------------------------------------
// POST /contracts/:address/read — call a view function by ABI
// ---------------------------------------------------------------------------

router.post("/contracts/:address/read", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params as { address: string };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { res.status(400).json({ error: "Invalid address" }); return; }

  const { functionName, args = [], abi: reqAbi } = req.body as {
    functionName: string; args?: unknown[]; abi?: object[];
  };

  // Get ABI from request or registry
  const record = await getContractRecord(address);
  const abi = reqAbi ?? record?.abi;
  if (!abi) { res.status(400).json({ error: "No ABI. Register the contract ABI first or pass abi in the request." }); return; }

  try {
    const calldata = encodeCall(abi, functionName, args);
    const result   = await chain.callContract({ to: address, data: calldata });
    if (!result.success) {
      res.json({ success: false, error: result.error ?? "Reverted" });
      return;
    }
    const decoded = result.returnData && result.returnData !== "0x"
      ? decodeReturn(abi, functionName, result.returnData)
      : null;
    res.json({ success: true, raw: result.returnData, decoded });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /contracts/:address/write — send a tx calling a function
// ---------------------------------------------------------------------------

router.post("/contracts/:address/write", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params as { address: string };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { res.status(400).json({ error: "Invalid address" }); return; }

  const { functionName, args = [], value = "0", gasLimit = "500000", fromPrivateKey, abi: reqAbi } = req.body as {
    functionName: string; args?: unknown[]; value?: string;
    gasLimit?: string; fromPrivateKey: string; abi?: object[];
  };

  if (!fromPrivateKey) { res.status(400).json({ error: "fromPrivateKey required" }); return; }

  const record = await getContractRecord(address);
  const abi = reqAbi ?? record?.abi;
  if (!abi) { res.status(400).json({ error: "No ABI. Register the contract ABI first or pass abi in the request." }); return; }

  try {
    const calldata = encodeCall(abi, functionName, args);
    const tx = await chain.submitTransaction({
      fromPrivateKey,
      to: address,
      value,
      data: calldata,
      gasLimit,
    });
    res.json({ success: true, txHash: tx.hash, status: tx.status });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /tokens — list known ERC-20 tokens
// ---------------------------------------------------------------------------

router.get("/tokens", async (_req: Request, res: Response): Promise<void> => {
  const tokens = await listTokens();
  res.json(tokens);
});

// ---------------------------------------------------------------------------
// GET /tokens/:address — token details + live supply + holders list
// ---------------------------------------------------------------------------

router.get("/tokens/:address", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params as { address: string };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { res.status(400).json({ error: "Invalid address" }); return; }

  const record = await getContractRecord(address);
  if (!record?.isToken) {
    // Try auto-detect first
    const erc20 = await detectERC20(address);
    if (!erc20) { res.status(404).json({ error: "Not a known ERC-20 token" }); return; }
    await upsertContractRecord({ address, isToken: true, ...erc20 });
  }

  // Live totalSupply
  const supplyR = await callView(address, "0x18160ddd", ["uint256"]);
  const totalSupply = supplyR ? String(supplyR[0]) : (record?.totalSupply ?? "0");

  // Holders: scan all known wallets and call balanceOf for each
  const wallets = await chain.listWallets();
  const holderResults = await Promise.all(
    wallets.map(async (w) => ({
      address:  w.address,
      balance:  await balanceOf(address, w.address),
    })),
  );
  const holders = holderResults
    .filter((h) => BigInt(h.balance) > 0n)
    .sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1));

  res.json({
    address,
    name:        record?.name ?? null,
    symbol:      record?.symbol ?? null,
    decimals:    record?.decimals ?? 18,
    totalSupply,
    holderCount: holders.length,
    holders,
    abi:         record?.abi ?? null,
    creator:     record?.creator ?? null,
    creatorTx:   record?.creatorTx ?? null,
    createdAt:   record?.createdAt ?? null,
  });
});

// ---------------------------------------------------------------------------
// GET /wallets/:address/tokens — token balances held by a wallet
// ---------------------------------------------------------------------------

router.get("/wallets/:address/tokens", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.params as { address: string };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) { res.status(400).json({ error: "Invalid address" }); return; }

  const tokens = await listTokens();
  if (tokens.length === 0) { res.json([]); return; }

  const balances = await Promise.all(
    tokens.map(async (t) => ({
      contractAddress: t.address,
      name:            t.name,
      symbol:          t.symbol,
      decimals:        t.decimals ?? 18,
      balance:         await balanceOf(t.address, address),
    })),
  );

  res.json(balances.filter((b) => BigInt(b.balance) > 0n));
});

// ---------------------------------------------------------------------------
// Legacy — raw hex call (keep for backward compat)
// ---------------------------------------------------------------------------

router.post("/contracts/call", async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await chain.callContract(req.body);
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Call failed" });
  }
});

export default router;
