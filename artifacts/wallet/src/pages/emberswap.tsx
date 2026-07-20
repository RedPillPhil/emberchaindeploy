/**
 * EmberSwap — Bridge & DEX interface
 *
 * Bridge tab:  EMBR ↔ wEMBR across EMBR chain ↔ Base
 * Swap tab:    ETH ↔ wEMBR via EmberSwap router on Base
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Shell } from "@/components/layout/shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useBaseWallet } from "@/hooks/use-base-wallet";
import { useCreateTransaction } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Zap,
  ArrowDownUp,
  ArrowRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  AlertTriangle,
  RefreshCcw,
  Flame,
  Info,
  TrendingUp,
  ChevronDown,
  Wallet,
  ChevronRight,
  Droplets,
  Plus,
  Minus,
  Search,
  X,
} from "lucide-react";
import { keccak256 } from "ethereum-cryptography/keccak.js";

// ── Base RPC helper (read-only, no wallet required) ──────────────────────────

const BASE_RPC_URL = "https://mainnet.base.org";

async function baseEthCall(to: string, data: string): Promise<string> {
  const res = await fetch(BASE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message ?? JSON.stringify(d.error));
  return d.result as string;
}

// ── Contract addresses (set via VITE_ env vars after deployment) ─────────────

const EMBER_BRIDGE_ADDRESS = import.meta.env.VITE_EMBER_BRIDGE_ADDRESS ?? ""; // on EMBR chain
const EMBERCHAIN_BRIDGE_ADDRESS = import.meta.env.VITE_EMBERCHAIN_BRIDGE_ADDRESS ?? ""; // on Base
const EMBERSWAP_ADDRESS = import.meta.env.VITE_EMBERSWAP_ADDRESS ?? ""; // on Base
const WEMBR_ADDRESS =
  import.meta.env.VITE_WEMBR_ADDRESS ??
  "0x9362587019Ea0e4ef90fbd981c615d4441D9D2c4"; // on Base

const UNISWAP_V2_ROUTER = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
// Known wEMBR/WETH Uniswap V2 pair on Base mainnet — skip factory lookup
const WEMBR_WETH_PAIR = "0xD7e6A5Dfdee7D141A036a5Af8C92Fe7ac20392a6";

const CONTRACTS_DEPLOYED = !!(
  EMBER_BRIDGE_ADDRESS &&
  EMBERCHAIN_BRIDGE_ADDRESS &&
  EMBERSWAP_ADDRESS &&
  WEMBR_ADDRESS
);

// ── ABI encoding helpers ─────────────────────────────────────────────────────

function fnSelector(sig: string): string {
  const hash = keccak256(new TextEncoder().encode(sig));
  return Array.from(hash.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SEL = {
  lockEMBR: fnSelector("lockEMBR(address,uint256)"),
  bridgeOut: fnSelector("bridgeOut(uint256,string,uint256)"),
  getAmountsOut: fnSelector("getAmountsOut(uint256,address[])"),
  getSwapStats: fnSelector("getSwapStats(address)"),
  swapExactETHForTokens: fnSelector(
    "swapExactETHForTokens(uint256,address[],address,uint256)",
  ),
  swapExactTokensForETH: fnSelector(
    "swapExactTokensForETH(uint256,uint256,address[],address,uint256)",
  ),
  swapExactTokensForTokens: fnSelector(
    "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  ),
  approve: fnSelector("approve(address,uint256)"),
  allowance: fnSelector("allowance(address,address)"),
  addLiquidityETH: fnSelector(
    "addLiquidityETH(address,uint256,uint256,uint256,address,uint256)",
  ),
  removeLiquidityETH: fnSelector(
    "removeLiquidityETH(address,uint256,uint256,uint256,address,uint256)",
  ),
  factory: fnSelector("factory()"),
  getPair: fnSelector("getPair(address,address)"),
  getReserves: fnSelector("getReserves()"),
  token0: fnSelector("token0()"),
  totalSupply: fnSelector("totalSupply()"),
  balanceOf: fnSelector("balanceOf(address)"),
  tokenSymbol: fnSelector("symbol()"),
  tokenDecimals: fnSelector("decimals()"),
  tokenName: fnSelector("name()"),
};

function padAddr(addr: string): string {
  return "000000000000000000000000" + addr.replace("0x", "").toLowerCase();
}
function padUint(n: bigint | number | string): string {
  return BigInt(n).toString(16).padStart(64, "0");
}

/** Encode lockEMBR(address baseRecipient, uint256 nonce) */
function encLockEMBR(recipient: string, nonce: bigint): string {
  return "0x" + SEL.lockEMBR + padAddr(recipient) + padUint(nonce);
}

/** Encode getSwapStats(address user) */
function encGetSwapStats(user: string): string {
  return "0x" + SEL.getSwapStats + padAddr(user);
}

/** Encode approve(address spender, uint256 amount) */
function encApprove(spender: string, amount: bigint): string {
  return "0x" + SEL.approve + padAddr(spender) + padUint(amount);
}

/** Encode allowance(address owner, address spender) */
function encAllowance(owner: string, spender: string): string {
  return "0x" + SEL.allowance + padAddr(owner) + padAddr(spender);
}

/** Encode addLiquidityETH(address,uint256,uint256,uint256,address,uint256) */
function encAddLiquidityETH(
  token: string,
  amountTokenDesired: bigint,
  amountTokenMin: bigint,
  amountETHMin: bigint,
  to: string,
  deadline: bigint,
): string {
  return (
    "0x" +
    SEL.addLiquidityETH +
    padAddr(token) +
    padUint(amountTokenDesired) +
    padUint(amountTokenMin) +
    padUint(amountETHMin) +
    padAddr(to) +
    padUint(deadline)
  );
}

/** Encode removeLiquidityETH(address,uint256,uint256,uint256,address,uint256) */
function encRemoveLiquidityETH(
  token: string,
  liquidity: bigint,
  amountTokenMin: bigint,
  amountETHMin: bigint,
  to: string,
  deadline: bigint,
): string {
  return (
    "0x" +
    SEL.removeLiquidityETH +
    padAddr(token) +
    padUint(liquidity) +
    padUint(amountTokenMin) +
    padUint(amountETHMin) +
    padAddr(to) +
    padUint(deadline)
  );
}

/** Decode a single address from eth_call result */
function decodeAddress(hex: string): string {
  return "0x" + hex.replace("0x", "").slice(24, 64);
}

/** Decode a 3-word tuple: (uint112, uint112, uint32) = reserves */
function decodeReserves(hex: string): [bigint, bigint] {
  const clean = hex.replace("0x", "");
  const r0 = BigInt("0x" + (clean.slice(0, 64) || "0"));
  const r1 = BigInt("0x" + (clean.slice(64, 128) || "0"));
  return [r0, r1];
}

/**
 * Encode getAmountsOut(uint256 amountIn, address[] path)
 * path = [tokenIn, tokenOut]
 */
function encGetAmountsOut(amountIn: bigint, path: [string, string]): string {
  // Layout: amountIn (32), offset_path (32), path.length (32), path[0] (32), path[1] (32)
  const offset = padUint(64); // 2 * 32
  return (
    "0x" +
    SEL.getAmountsOut +
    padUint(amountIn) +
    offset +
    padUint(2) +
    padAddr(path[0]) +
    padAddr(path[1])
  );
}

/**
 * Encode swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)
 * payable — sends ETH via value
 */
function encSwapETHForTokens(
  amountOutMin: bigint,
  path: [string, string],
  to: string,
  deadline: bigint,
): string {
  // Layout: amountOutMin, offset_path (32*3=96 from start of data), to, deadline, path.length, path[0], path[1]
  const pathOffset = padUint(128); // 4 * 32 (amountOutMin + offset + to + deadline)
  return (
    "0x" +
    SEL.swapExactETHForTokens +
    padUint(amountOutMin) +
    pathOffset +
    padAddr(to) +
    padUint(deadline) +
    padUint(2) +
    padAddr(path[0]) +
    padAddr(path[1])
  );
}

/**
 * Encode swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)
 * Returns native ETH to `to`. Path should end with WETH address.
 */
function encSwapTokensForETH(
  amountIn: bigint,
  amountOutMin: bigint,
  path: [string, string],
  to: string,
  deadline: bigint,
): string {
  // Layout: amountIn, amountOutMin, offset_path (5*32=160), to, deadline, path.length, path[0], path[1]
  const pathOffset = padUint(160);
  return (
    "0x" +
    SEL.swapExactTokensForETH +
    padUint(amountIn) +
    padUint(amountOutMin) +
    pathOffset +
    padAddr(to) +
    padUint(deadline) +
    padUint(2) +
    padAddr(path[0]) +
    padAddr(path[1])
  );
}

// ── Token catalog ────────────────────────────────────────────────────────────

interface TokenInfo {
  symbol: string;
  name: string;
  address: string; // "ETH" for native Ether
  decimals: number;
  color: string;   // tailwind bg color for the icon circle
}

const ETH_TOKEN: TokenInfo = {
  symbol: "ETH",
  name: "Ether",
  address: "ETH",
  decimals: 18,
  color: "bg-blue-500",
};

const BASE_TOKENS: TokenInfo[] = [
  ETH_TOKEN,
  {
    symbol: "wEMBR",
    name: "Wrapped EMBR",
    address: WEMBR_ADDRESS || "0x9362587019Ea0e4ef90fbd981c615d4441D9D2c4",
    decimals: 18,
    color: "bg-orange-500",
  },
  // ── Stablecoins ──────────────────────────────────────────────────────────────
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    color: "bg-blue-400",
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    decimals: 6,
    color: "bg-teal-500",
  },
  {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    decimals: 18,
    color: "bg-yellow-500",
  },
  // ── Top Base meme coins (by volume/market cap) ───────────────────────────────
  {
    symbol: "BRETT",
    name: "Brett",
    address: "0x532f27101965dd16442E59d40670FaF5eBB142E4",
    decimals: 18,
    color: "bg-blue-500",
  },
  {
    symbol: "DEGEN",
    name: "Degen",
    address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    decimals: 18,
    color: "bg-violet-500",
  },
  {
    symbol: "TOSHI",
    name: "Toshi",
    address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
    decimals: 18,
    color: "bg-amber-500",
  },
  {
    symbol: "VIRTUAL",
    name: "Virtuals Protocol",
    address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
    decimals: 18,
    color: "bg-cyan-500",
  },
  {
    symbol: "HIGHER",
    name: "Higher",
    address: "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe",
    decimals: 18,
    color: "bg-green-500",
  },
  {
    symbol: "KEYCAT",
    name: "Keyboard Cat on Base",
    address: "0x9a26F5433671751C3276a065f57e5a02D2817973",
    decimals: 18,
    color: "bg-pink-500",
  },
  {
    symbol: "MOCHI",
    name: "Mochi",
    address: "0xF6e932Ca12afa26665dC4dDE7e27be02A7c02e50",
    decimals: 18,
    color: "bg-rose-400",
  },
  {
    symbol: "NORMIE",
    name: "Normie",
    address: "0x7F12d13B34F5F4f0a9449c16Bcd42f0da47AF200",
    decimals: 9,
    color: "bg-slate-400",
  },
  {
    symbol: "BALD",
    name: "Bald",
    address: "0x27D2DECb4bFC9C76F0309b8E88dec3a601Fe25a8",
    decimals: 18,
    color: "bg-stone-400",
  },
  {
    symbol: "BUILD",
    name: "Build on Base",
    address: "0x3C281A39944a2319aA653D81Cfd93Ca10983D234",
    decimals: 18,
    color: "bg-orange-600",
  },
  // ── DeFi & infrastructure ────────────────────────────────────────────────────
  {
    symbol: "AERO",
    name: "Aerodrome Finance",
    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    decimals: 18,
    color: "bg-blue-600",
  },
  {
    symbol: "WELL",
    name: "Moonwell",
    address: "0xFF8adeC2221f9f4D8dfbAFa6B9a297d17603493D",
    decimals: 18,
    color: "bg-emerald-500",
  },
  {
    symbol: "PRIME",
    name: "Echelon Prime",
    address: "0xfA980cEd6895AC314E7dE34Ef1bFAE90a5AdD21b",
    decimals: 18,
    color: "bg-fuchsia-500",
  },
  // ── Wrapped assets ───────────────────────────────────────────────────────────
  {
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    decimals: 8,
    color: "bg-orange-400",
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: WETH_ADDRESS,
    decimals: 18,
    color: "bg-indigo-500",
  },
  {
    symbol: "cbETH",
    name: "Coinbase Wrapped Staked ETH",
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    decimals: 18,
    color: "bg-sky-500",
  },
];

// ── Types ────────────────────────────────────────────────────────────────────

type BridgeStatus = "pending" | "relayed" | "confirmed" | "failed";

interface BridgeEvent {
  nonce: string;
  direction: "embr_to_base" | "base_to_embr";
  status: BridgeStatus;
  sender: string;
  recipient: string;
  amount: string;
  txHashSrc?: string;
  txHashDst?: string;
  createdAt: string;
}

type SwapDirection = "eth_to_wembr" | "wembr_to_eth";

// ── Decimal-aware helpers ────────────────────────────────────────────────────

function parseUnits(val: string, decimals: number): bigint {
  if (!val || isNaN(Number(val)) || Number(val) <= 0) return 0n;
  const [intPart = "0", fracPart = ""] = val.split(".");
  const frac = fracPart.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(intPart) * BigInt(10 ** decimals) + BigInt(frac || "0");
}

function formatUnits(wei: bigint, decimals: number, disp = 6): string {
  if (wei === 0n) return "0";
  const divisor = BigInt(10 ** decimals);
  const whole = wei / divisor;
  const frac = wei % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, disp);
  return `${whole}.${fracStr}`.replace(/\.?0+$/, "") || "0";
}

/** Decode ABI string or bytes32 from eth_call result */
function decodeString(hex: string): string {
  const clean = hex.replace("0x", "");
  if (!clean) return "";
  // Try bytes32 first (no offset header)
  if (clean.length === 64) {
    const bytes: number[] = [];
    for (let i = 0; i < 64; i += 2) {
      const b = parseInt(clean.slice(i, i + 2), 16);
      if (b === 0) break;
      bytes.push(b);
    }
    return String.fromCharCode(...bytes);
  }
  // String ABI: offset (32 bytes), length (32 bytes), data
  if (clean.length < 128) return "";
  const len = parseInt(clean.slice(64, 128), 16);
  let result = "";
  for (let i = 0; i < len; i++) {
    result += String.fromCharCode(parseInt(clean.slice(128 + i * 2, 130 + i * 2), 16));
  }
  return result;
}

function decodeUint8(hex: string): number {
  const clean = hex.replace("0x", "");
  if (!clean) return 18;
  return parseInt(clean.slice(-2), 16);
}

// ── Variable-length path encoders ─────────────────────────────────────────────

function encGetAmountsOutPath(amountIn: bigint, path: string[]): string {
  return (
    "0x" +
    SEL.getAmountsOut +
    padUint(amountIn) +
    padUint(64) +
    padUint(path.length) +
    path.map(padAddr).join("")
  );
}

function encSwapExactTokensForTokens(
  amountIn: bigint,
  amountOutMin: bigint,
  path: string[],
  to: string,
  deadline: bigint,
): string {
  return (
    "0x" +
    SEL.swapExactTokensForTokens +
    padUint(amountIn) +
    padUint(amountOutMin) +
    padUint(160) +
    padAddr(to) +
    padUint(deadline) +
    padUint(path.length) +
    path.map(padAddr).join("")
  );
}

function encSwapETHForTokensPath(
  amountOutMin: bigint,
  path: string[],
  to: string,
  deadline: bigint,
): string {
  return (
    "0x" +
    SEL.swapExactETHForTokens +
    padUint(amountOutMin) +
    padUint(128) +
    padAddr(to) +
    padUint(deadline) +
    padUint(path.length) +
    path.map(padAddr).join("")
  );
}

function encSwapTokensForETHPath(
  amountIn: bigint,
  amountOutMin: bigint,
  path: string[],
  to: string,
  deadline: bigint,
): string {
  return (
    "0x" +
    SEL.swapExactTokensForETH +
    padUint(amountIn) +
    padUint(amountOutMin) +
    padUint(160) +
    padAddr(to) +
    padUint(deadline) +
    padUint(path.length) +
    path.map(padAddr).join("")
  );
}

// ── Route finder ──────────────────────────────────────────────────────────────

interface RouteResult {
  path: string[];
  amountOut: bigint;
  routeLabel: string;
  isToETH: boolean;
}

async function findBestRoute(
  from: TokenInfo,
  to: TokenInfo,
  amountIn: bigint,
  ethCall: (contract: string, data: string) => Promise<string>,
): Promise<RouteResult | null> {
  if (amountIn === 0n) return null;

  const fromAddr = from.address === "ETH" ? WETH_ADDRESS : from.address;
  const toAddr = to.address === "ETH" ? WETH_ADDRESS : to.address;
  const wEmbrAddr = (WEMBR_ADDRESS || "0x9362587019Ea0e4ef90fbd981c615d4441D9D2c4").toLowerCase();
  const wethAddr = WETH_ADDRESS.toLowerCase();

  if (fromAddr.toLowerCase() === toAddr.toLowerCase()) return null;

  const routes: { path: string[]; label: string }[] = [
    { path: [fromAddr, toAddr], label: "Direct" },
  ];
  if (fromAddr.toLowerCase() !== wethAddr && toAddr.toLowerCase() !== wethAddr) {
    routes.push({ path: [fromAddr, WETH_ADDRESS, toAddr], label: "via WETH" });
  }
  if (
    WEMBR_ADDRESS &&
    fromAddr.toLowerCase() !== wEmbrAddr &&
    toAddr.toLowerCase() !== wEmbrAddr
  ) {
    routes.push({ path: [fromAddr, WEMBR_ADDRESS, toAddr], label: "via wEMBR" });
  }

  const settled = await Promise.allSettled(
    routes.map(async (r) => {
      const data = encGetAmountsOutPath(amountIn, r.path);
      const hex = await ethCall(UNISWAP_V2_ROUTER, data);
      const amounts = decodeUint256Array(hex);
      const amountOut = amounts[amounts.length - 1] ?? 0n;
      return { path: r.path, amountOut, routeLabel: r.label };
    }),
  );

  let best: RouteResult | null = null;
  for (const s of settled) {
    if (s.status !== "fulfilled" || s.value.amountOut === 0n) continue;
    const candidate = { ...s.value, isToETH: to.address === "ETH" };
    if (!best) { best = candidate; continue; }
    // Prefer wEMBR route when within 5% of best (captures LP fees)
    if (candidate.amountOut > best.amountOut) {
      best = candidate;
    } else if (candidate.routeLabel.includes("wEMBR")) {
      if (candidate.amountOut >= (best.amountOut * 95n) / 100n) {
        best = candidate;
      }
    }
  }
  return best;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const r = await fetch(API + path, opts);
  const json = await r.json();
  if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
  return json;
}

function formatWei(wei: string | bigint, decimals = 4): string {
  try {
    const n = BigInt(typeof wei === "string" ? wei : wei.toString());
    const eth = Number(n) / 1e18;
    return eth.toLocaleString("en-US", { maximumFractionDigits: decimals });
  } catch {
    return "0";
  }
}

function shortAddr(addr: string): string {
  return addr.slice(0, 8) + "…" + addr.slice(-5);
}

function parseEther(val: string): bigint {
  const f = parseFloat(val);
  if (isNaN(f) || f <= 0) return 0n;
  return BigInt(Math.round(f * 1e18));
}

// Decode uint256[2] from eth_call result
function decodeUint256Pair(hex: string): [bigint, bigint] {
  const clean = hex.replace("0x", "");
  const a = BigInt("0x" + (clean.slice(0, 64) || "0"));
  const b = BigInt("0x" + (clean.slice(64, 128) || "0"));
  return [a, b];
}

// Decode uint256[] from eth_call result (amountsOut)
function decodeUint256Array(hex: string): bigint[] {
  const clean = hex.replace("0x", "");
  // offset (32), length (32), then values
  if (clean.length < 128) return [];
  const len = parseInt(clean.slice(64, 128), 16);
  const result: bigint[] = [];
  for (let i = 0; i < len; i++) {
    const chunk = clean.slice(128 + i * 64, 128 + (i + 1) * 64);
    result.push(BigInt("0x" + (chunk || "0")));
  }
  return result;
}

function decodeUint256(hex: string): bigint {
  const clean = hex.replace("0x", "");
  if (!clean) return 0n;
  return BigInt("0x" + clean);
}

// ── Token icon ────────────────────────────────────────────────────────────────

function TokenIcon({ token, size = "md" }: { token: TokenInfo; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "w-5 h-5 text-[9px]" : size === "lg" ? "w-9 h-9 text-sm" : "w-7 h-7 text-xs";
  return (
    <div className={cn("rounded-full flex items-center justify-center font-bold text-white shrink-0", sz, token.color)}>
      {token.symbol.slice(0, 3)}
    </div>
  );
}

// ── Token picker modal ────────────────────────────────────────────────────────

function TokenPickerModal({
  open,
  onClose,
  onSelect,
  exclude,
  ethCall,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (t: TokenInfo) => void;
  exclude: string; // address to hide
  ethCall: (to: string, data: string) => Promise<string>;
}) {
  const [query, setQuery] = useState("");
  const [customAddr, setCustomAddr] = useState("");
  const [customToken, setCustomToken] = useState<TokenInfo | null>(null);
  const [fetchingCustom, setFetchingCustom] = useState(false);
  const [customError, setCustomError] = useState("");

  const filtered = BASE_TOKENS.filter(
    (t) =>
      t.address.toLowerCase() !== exclude.toLowerCase() &&
      (t.symbol.toLowerCase().includes(query.toLowerCase()) ||
        t.name.toLowerCase().includes(query.toLowerCase()) ||
        t.address.toLowerCase().includes(query.toLowerCase())),
  );

  const fetchCustomToken = async (addr: string) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return;
    setFetchingCustom(true);
    setCustomError("");
    setCustomToken(null);
    try {
      const [symHex, decHex, nameHex] = await Promise.all([
        ethCall(addr, "0x" + SEL.tokenSymbol),
        ethCall(addr, "0x" + SEL.tokenDecimals),
        ethCall(addr, "0x" + SEL.tokenName),
      ]);
      const symbol = decodeString(symHex) || "???";
      const decimals = decodeUint8(decHex) || 18;
      const name = decodeString(nameHex) || symbol;
      setCustomToken({ symbol, name, address: addr, decimals, color: "bg-purple-500" });
    } catch {
      setCustomError("Could not fetch token — check the address");
    } finally {
      setFetchingCustom(false);
    }
  };

  useEffect(() => {
    if (/^0x[0-9a-fA-F]{40}$/.test(customAddr)) {
      fetchCustomToken(customAddr);
    } else {
      setCustomToken(null);
      setCustomError("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customAddr]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-card border border-border rounded-sm shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Select Token</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              autoFocus
              className="w-full bg-secondary/60 border border-border rounded-sm pl-8 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              placeholder="Search name or paste address…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Popular chips */}
        <div className="px-4 py-2 flex flex-wrap gap-1.5 border-b border-border">
          {BASE_TOKENS.filter((t) => t.address.toLowerCase() !== exclude.toLowerCase()).slice(0, 6).map((t) => (
            <button
              key={t.address}
              onClick={() => { onSelect(t); onClose(); }}
              className="flex items-center gap-1.5 bg-secondary/60 hover:bg-secondary border border-border rounded-sm px-2 py-1 text-xs font-bold text-foreground transition-colors"
            >
              <TokenIcon token={t} size="sm" />
              {t.symbol}
            </button>
          ))}
        </div>

        {/* Token list */}
        <div className="max-h-64 overflow-y-auto">
          {filtered.map((t) => (
            <button
              key={t.address}
              onClick={() => { onSelect(t); onClose(); }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/60 transition-colors text-left"
            >
              <TokenIcon token={t} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-foreground">{t.symbol}</div>
                <div className="text-xs text-muted-foreground truncate">{t.name}</div>
              </div>
              {t.address !== "ETH" && (
                <div className="text-[10px] font-mono text-muted-foreground">
                  {t.address.slice(0, 6)}…{t.address.slice(-4)}
                </div>
              )}
            </button>
          ))}
          {filtered.length === 0 && !query.startsWith("0x") && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground italic">No results</div>
          )}
        </div>

        {/* Custom address entry */}
        <div className="px-4 py-3 border-t border-border">
          <div className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground mb-2">
            Custom Token Address
          </div>
          <input
            className="w-full bg-secondary/60 border border-border rounded-sm px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            placeholder="0x…"
            value={customAddr}
            onChange={(e) => setCustomAddr(e.target.value)}
          />
          {fetchingCustom && (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Fetching token info…
            </div>
          )}
          {customError && <div className="mt-1 text-xs text-red-400">{customError}</div>}
          {customToken && (
            <button
              onClick={() => { onSelect(customToken); onClose(); }}
              className="mt-2 w-full flex items-center gap-3 bg-secondary/60 hover:bg-secondary border border-border rounded-sm px-3 py-2 transition-colors"
            >
              <TokenIcon token={customToken} />
              <div className="text-left">
                <div className="text-sm font-bold text-foreground">{customToken.symbol}</div>
                <div className="text-xs text-muted-foreground">{customToken.name}</div>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: BridgeStatus }) {
  if (status === "confirmed")
    return (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/40 uppercase text-xs gap-1">
        <CheckCircle2 className="w-3 h-3" /> Confirmed
      </Badge>
    );
  if (status === "relayed")
    return (
      <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/40 uppercase text-xs gap-1">
        <ArrowRight className="w-3 h-3" /> Relayed
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge className="bg-red-500/20 text-red-400 border-red-500/40 uppercase text-xs gap-1">
        <XCircle className="w-3 h-3" /> Failed
      </Badge>
    );
  return (
    <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/40 uppercase text-xs gap-1">
      <Clock className="w-3 h-3" /> Pending
    </Badge>
  );
}

// ── Not-deployed notice ───────────────────────────────────────────────────────

function DeployNotice() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <div className="w-16 h-16 rounded-sm bg-primary/10 border border-primary/30 flex items-center justify-center">
        <Flame className="w-8 h-8 text-primary animate-pulse" />
      </div>
      <div>
        <div className="font-display text-xl uppercase tracking-tight text-foreground mb-1">
          Contracts Not Yet Deployed
        </div>
        <div className="text-sm text-muted-foreground max-w-sm">
          EmberSwap contracts are being audited. Set{" "}
          <code className="text-primary">VITE_EMBER_BRIDGE_ADDRESS</code>,{" "}
          <code className="text-primary">VITE_EMBERSWAP_ADDRESS</code>, and{" "}
          <code className="text-primary">VITE_WEMBR_ADDRESS</code> to activate.
        </div>
      </div>
    </div>
  );
}

// ── Network guard ─────────────────────────────────────────────────────────────

function NetworkGuard({
  isOnBase,
  switchToBase,
  wallet,
  connect,
  isConnecting,
  hasMetaMask,
}: {
  isOnBase: boolean;
  switchToBase: () => void;
  wallet: { address: string } | null;
  connect: () => void;
  isConnecting: boolean;
  hasMetaMask: boolean;
}) {
  if (!hasMetaMask)
    return (
      <div className="flex items-center gap-3 bg-secondary/60 border border-border p-4 rounded-sm">
        <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0" />
        <div className="text-sm">
          <span className="font-bold text-foreground">MetaMask required</span>{" "}
          <span className="text-muted-foreground">
            Install MetaMask (or another EVM browser wallet) to use EmberSwap on Base.
          </span>
        </div>
      </div>
    );

  if (!wallet)
    return (
      <div className="flex items-center justify-between gap-3 bg-secondary/60 border border-border p-4 rounded-sm">
        <div className="flex items-center gap-3">
          <Wallet className="w-5 h-5 text-primary shrink-0" />
          <span className="text-sm text-muted-foreground">
            Connect your Base wallet to use the swap and Base→EMBR bridge.
          </span>
        </div>
        <Button
          size="sm"
          onClick={connect}
          disabled={isConnecting}
          className="shrink-0"
        >
          {isConnecting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            "Connect"
          )}
        </Button>
      </div>
    );

  if (!isOnBase)
    return (
      <div className="flex items-center justify-between gap-3 bg-yellow-500/10 border border-yellow-500/30 p-4 rounded-sm">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0" />
          <span className="text-sm text-yellow-300">
            Switch to Base to use this feature.
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={switchToBase}
          className="border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/10 shrink-0"
        >
          Switch Network
        </Button>
      </div>
    );

  return null;
}

// ── Bridge history table ──────────────────────────────────────────────────────

function BridgeHistory({ address }: { address: string }) {
  const [events, setEvents] = useState<BridgeEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const data = await apiFetch(`/api/bridge/history/${address}`);
      setEvents(data as BridgeEvent[]);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  if (events.length === 0 && !loading) return null;

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Bridge History
        </div>
        <button
          onClick={load}
          className="text-muted-foreground hover:text-foreground"
          title="Refresh"
        >
          <RefreshCcw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </button>
      </div>
      <div className="space-y-2">
        {events.slice(0, 8).map((e) => (
          <div
            key={e.nonce}
            className="flex items-center justify-between bg-secondary/40 border border-border rounded-sm px-4 py-2.5 text-sm gap-4"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-muted-foreground text-xs font-mono">
                #{e.nonce}
              </span>
              <span className="text-foreground font-bold text-xs uppercase">
                {e.direction === "embr_to_base" ? "EMBR → Base" : "Base → EMBR"}
              </span>
              <span className="text-primary font-mono text-xs">
                {formatWei(e.amount)} EMBR
              </span>
            </div>
            <StatusBadge status={e.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Airdrop eligibility panel ─────────────────────────────────────────────────

function AirdropPanel({
  address,
  ethCall,
}: {
  address: string;
  ethCall: (to: string, data: string) => Promise<string>;
}) {
  const [stats, setStats] = useState<{ volume: bigint; count: bigint } | null>(
    null,
  );

  useEffect(() => {
    if (!EMBERSWAP_ADDRESS || !address) return;
    ethCall(EMBERSWAP_ADDRESS, encGetSwapStats(address))
      .then((hex) => {
        const [volume, count] = decodeUint256Pair(hex);
        setStats({ volume, count });
      })
      .catch(() => {});
  }, [address, ethCall]);

  return (
    <div className="mt-6 bg-primary/5 border border-primary/20 rounded-sm p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-sm bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0">
          <Zap className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold uppercase text-sm tracking-wider text-primary">
              EMBR Airdrop Eligibility
            </span>
            <Badge className="bg-primary/20 text-primary border-primary/30 text-[9px] font-bold">
              FUTURE
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            Your activity on EmberSwap is tracked on-chain. High swap volume and
            count may qualify you for a future EMBR airdrop.
          </p>
          {stats && (
            <div className="flex gap-6">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-widest font-bold mb-0.5">
                  Volume
                </div>
                <div className="font-mono text-foreground text-sm">
                  {formatWei(stats.volume)} wEMBR
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-widest font-bold mb-0.5">
                  Swaps
                </div>
                <div className="font-mono text-foreground text-sm">
                  {stats.count.toString()}
                </div>
              </div>
            </div>
          )}
          {!stats && EMBERSWAP_ADDRESS && (
            <div className="text-xs text-muted-foreground italic">
              Connect wallet and make swaps to appear here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Bridge Tab ────────────────────────────────────────────────────────────────

function BridgeTab() {
  const { activeWallet } = useActiveWallet();
  const baseWallet = useBaseWallet();
  const createTx = useCreateTransaction();
  const { toast } = useToast();

  type Direction = "embr_to_base" | "base_to_embr";
  const [direction, setDirection] = useState<Direction>("embr_to_base");
  const [amount, setAmount] = useState("");
  const [baseRecipient, setBaseRecipient] = useState("");
  const [embrRecipient, setEmbrRecipient] = useState("");
  const [bridgeStatus, setBridgeStatus] = useState<{
    nonce: string;
    status: BridgeStatus;
    txHash?: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-fill MetaMask address as baseRecipient
  useEffect(() => {
    if (baseWallet.wallet?.address && !baseRecipient) {
      setBaseRecipient(baseWallet.wallet.address);
    }
  }, [baseWallet.wallet?.address, baseRecipient]);

  // Auto-fill EMBR address as embrRecipient for Base→EMBR direction
  useEffect(() => {
    if (activeWallet?.address && direction === "base_to_embr" && !embrRecipient) {
      setEmbrRecipient(activeWallet.address);
    }
  }, [activeWallet?.address, direction, embrRecipient]);

  // Poll bridge status after submission
  const pollStatus = useCallback((nonce: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const data = await apiFetch(`/api/bridge/status/${nonce}`);
        const status = data.status as BridgeStatus;
        setBridgeStatus((prev) => prev ? { ...prev, status } : null);
        if (status === "confirmed" || status === "failed") {
          clearInterval(pollRef.current!);
        }
      } catch {
        // ignore transient errors
      }
    }, 5000);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // EMBR → Base: create tx on EMBR chain, then register with bridge
  const submitEmbrToBase = async () => {
    if (!activeWallet) return;
    const amountWei = parseEther(amount);
    if (amountWei === 0n) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(baseRecipient)) {
      toast({ title: "Enter a valid Base recipient address", variant: "destructive" });
      return;
    }
    if (!EMBER_BRIDGE_ADDRESS) {
      toast({ title: "Bridge contract not yet deployed", variant: "destructive" });
      return;
    }

    const nonce = BigInt(Date.now()); // unique bridge nonce
    const calldata = encLockEMBR(baseRecipient, nonce);

    setIsSubmitting(true);
    try {
      await new Promise<void>((resolve, reject) => {
        createTx.mutate(
          {
            data: {
              fromPrivateKey: activeWallet.privateKey,
              to: EMBER_BRIDGE_ADDRESS,
              value: amountWei.toString(),
              data: calldata,
              gasLimit: "300000",
            },
          },
          {
            onSuccess: async (tx) => {
              try {
                // Retry registration until the tx is confirmed on-chain (server returns
                // 202 while tx is still pending) or we give up after 30 s.
                const body = JSON.stringify({
                  txHash: tx.hash,
                  baseRecipient,
                  amount: amountWei.toString(),
                  nonce: nonce.toString(),
                });
                let registered = false;
                const deadline = Date.now() + 30_000;
                while (!registered && Date.now() < deadline) {
                  const r = await fetch(API + "/api/bridge/register", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body,
                  });
                  if (r.status === 202) {
                    // tx still pending on-chain — wait 3 s then retry
                    await new Promise((w) => setTimeout(w, 3000));
                    continue;
                  }
                  if (r.status === 201 || r.status === 200) {
                    registered = true;
                    break;
                  }
                  // Any other non-2xx status is a hard error
                  const json = await r.json().catch(() => ({}));
                  throw new Error((json as { error?: string }).error ?? `HTTP ${r.status}`);
                }
                if (!registered) {
                  throw new Error("Timed out waiting for EMBR chain confirmation — registration will retry automatically.");
                }
                setBridgeStatus({ nonce: nonce.toString(), status: "pending", txHash: tx.hash });
                pollStatus(nonce.toString());
                setAmount("");
                toast({ title: "Bridge request submitted", description: "wEMBR will arrive on Base in ~2 min" });
                resolve();
              } catch (err) {
                // Tx sent but registration failed — surface the error clearly
                setBridgeStatus({ nonce: nonce.toString(), status: "pending", txHash: tx.hash });
                toast({
                  title: "Registration failed",
                  description: (err as Error).message,
                  variant: "destructive",
                });
                resolve();
              }
            },
            onError: (err: unknown) => {
              reject(err);
            },
          },
        );
      });
    } catch (err) {
      toast({
        title: "Bridge failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Base → EMBR: MetaMask calls bridgeOut on EmberchainBridge
  const submitBaseToEmbr = async () => {
    if (!baseWallet.wallet) {
      await baseWallet.connect();
      return;
    }
    if (!baseWallet.isOnBase) {
      await baseWallet.switchToBase();
      return;
    }
    const amountWei = parseEther(amount);
    if (amountWei === 0n) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (!embrRecipient || embrRecipient.length < 10) {
      toast({ title: "Enter a valid EMBR recipient address", variant: "destructive" });
      return;
    }
    if (!EMBERCHAIN_BRIDGE_ADDRESS || !WEMBR_ADDRESS) {
      toast({ title: "Bridge contract not yet deployed", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    const nonce = BigInt(Date.now());

    try {
      // 1. Check & approve wEMBR spending
      const allowanceHex = await baseWallet.ethCall(
        WEMBR_ADDRESS,
        encAllowance(baseWallet.wallet.address, EMBERCHAIN_BRIDGE_ADDRESS),
      );
      const currentAllowance = decodeUint256(allowanceHex);
      if (currentAllowance < amountWei) {
        toast({ title: "Approving wEMBR…", description: "Confirm in MetaMask" });
        const approveTxHash = await baseWallet.sendTx({
          to: WEMBR_ADDRESS,
          data: encApprove(EMBERCHAIN_BRIDGE_ADDRESS, amountWei * 2n),
        });
        toast({ title: "Approval tx submitted", description: approveTxHash.slice(0, 20) + "…" });
        await new Promise((r) => setTimeout(r, 8000));
      }

      // 2. Call bridgeOut — ABI encode bridgeOut(uint256, string, uint256)
      // Layout: amount (32) | offset=96 (32) | nonce (32) | str_len (32) | str_data (padded)
      const strBytes = new TextEncoder().encode(embrRecipient);
      const strLen = strBytes.length;
      const strPadded = Math.ceil(strLen / 32) * 32 || 32;
      let strHex = "";
      for (const b of strBytes) strHex += b.toString(16).padStart(2, "0");
      strHex = strHex.padEnd(strPadded * 2, "0");

      const data =
        "0x" +
        SEL.bridgeOut +
        padUint(amountWei) +   // amount — static head
        padUint(96) +          // offset to string tail (3 × 32 bytes from head start)
        padUint(nonce) +       // nonce — static head
        padUint(strLen) +      // string length (tail)
        strHex;                // string bytes padded to 32-byte boundary (tail)

      const txHash = await baseWallet.sendTx({
        to: EMBERCHAIN_BRIDGE_ADDRESS,
        data,
      });

      setBridgeStatus({ nonce: nonce.toString(), status: "pending", txHash });
      setAmount("");
      toast({
        title: "Bridge submitted",
        description: "EMBR will be released on-chain in ~2 min",
      });
    } catch (err) {
      toast({
        title: "Bridge failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const historyAddress =
    direction === "embr_to_base"
      ? activeWallet?.address ?? ""
      : baseWallet.wallet?.address ?? "";

  return (
    <div className="max-w-lg mx-auto w-full space-y-6">
      {/* Direction selector */}
      <div className="grid grid-cols-2 gap-2">
        {(["embr_to_base", "base_to_embr"] as Direction[]).map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className={cn(
              "p-3 border rounded-sm text-sm font-bold uppercase tracking-wider transition-all text-left",
              direction === d
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
            )}
          >
            <div className="flex items-center gap-2">
              <Flame className={cn("w-4 h-4", direction === d && "text-primary fill-primary/50")} />
              {d === "embr_to_base" ? "EMBR → Base" : "Base → EMBR"}
            </div>
            <div className="text-[10px] font-normal text-muted-foreground mt-1 normal-case">
              {d === "embr_to_base"
                ? "Lock EMBR, receive wEMBR on Base"
                : "Burn wEMBR, release EMBR on-chain"}
            </div>
          </button>
        ))}
      </div>

      {/* Base wallet connection guard for Base→EMBR */}
      {direction === "base_to_embr" && (
        <NetworkGuard
          isOnBase={baseWallet.isOnBase}
          switchToBase={baseWallet.switchToBase}
          wallet={baseWallet.wallet}
          connect={baseWallet.connect}
          isConnecting={baseWallet.isConnecting}
          hasMetaMask={baseWallet.hasMetaMask}
        />
      )}

      {/* Bridge form */}
      <Card className="border-border bg-card/80 rounded-sm">
        <CardContent className="p-6 space-y-4">
          <div className="space-y-2">
            <Label className="uppercase text-xs font-bold tracking-widest text-muted-foreground">
              Amount (EMBR)
            </Label>
            <Input
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-mono text-lg bg-secondary/50 border-border"
            />
          </div>

          {direction === "embr_to_base" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="uppercase text-xs font-bold tracking-widest text-muted-foreground">
                  Base recipient address
                </Label>
                <button
                  className="text-xs text-primary hover:underline font-bold uppercase tracking-widest"
                  onClick={() => activeWallet && setBaseRecipient(activeWallet.address)}
                >
                  Myself
                </button>
              </div>
              <Input
                placeholder="0x…"
                value={baseRecipient}
                onChange={(e) => setBaseRecipient(e.target.value)}
                className="font-mono bg-secondary/50 border-border"
              />
              {baseWallet.wallet && (
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => setBaseRecipient(baseWallet.wallet!.address)}
                >
                  Use connected MetaMask address ({shortAddr(baseWallet.wallet.address)})
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="uppercase text-xs font-bold tracking-widest text-muted-foreground">
                EMBR chain recipient address
              </Label>
              <Input
                placeholder="0x…"
                value={embrRecipient}
                onChange={(e) => setEmbrRecipient(e.target.value)}
                className="font-mono bg-secondary/50 border-border"
              />
              {activeWallet && (
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => setEmbrRecipient(activeWallet.address)}
                >
                  Use EMBR wallet ({shortAddr(activeWallet.address)})
                </button>
              )}
            </div>
          )}

          {/* Info row */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/40 border border-border rounded-sm px-3 py-2">
            <Info className="w-3.5 h-3.5 shrink-0" />
            <span>
              2-step confirmation — relayer picks up in{" "}
              <strong className="text-foreground">~2 minutes</strong>. Track
              status below.
            </span>
          </div>

          <Button
            className="w-full"
            disabled={
              isSubmitting ||
              !amount ||
              (direction === "embr_to_base" && !activeWallet) ||
              (direction === "base_to_embr" && (!baseWallet.wallet || !baseWallet.isOnBase))
            }
            onClick={direction === "embr_to_base" ? submitEmbrToBase : submitBaseToEmbr}
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Zap className="w-4 h-4 mr-2" />
            )}
            {isSubmitting ? "Processing…" : direction === "embr_to_base" ? "Bridge to Base" : "Bridge to EMBR"}
          </Button>
        </CardContent>
      </Card>

      {/* In-flight status */}
      {bridgeStatus && (
        <div
          className={cn(
            "border rounded-sm p-4 flex items-center justify-between gap-4",
            bridgeStatus.status === "confirmed"
              ? "border-green-500/40 bg-green-500/5"
              : bridgeStatus.status === "failed"
              ? "border-red-500/40 bg-red-500/5"
              : "border-primary/30 bg-primary/5",
          )}
        >
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-1">
              Bridge Request #{bridgeStatus.nonce}
            </div>
            {bridgeStatus.txHash && (
              <div className="text-xs font-mono text-muted-foreground truncate">
                {bridgeStatus.txHash.slice(0, 20)}…
              </div>
            )}
          </div>
          <StatusBadge status={bridgeStatus.status} />
        </div>
      )}

      {/* Bridge history */}
      {historyAddress && <BridgeHistory address={historyAddress} />}
    </div>
  );
}

// ── Swap Tab ──────────────────────────────────────────────────────────────────

function TokenSelectorButton({
  token,
  onClick,
}: {
  token: TokenInfo;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 bg-secondary/80 hover:bg-secondary border border-border rounded-sm px-3 py-2 transition-colors shrink-0"
    >
      <TokenIcon token={token} size="sm" />
      <span className="text-sm font-bold text-foreground">{token.symbol}</span>
      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
    </button>
  );
}

function SwapTab() {
  const baseWallet = useBaseWallet();
  const { toast } = useToast();

  const wEmbrToken = BASE_TOKENS.find((t) => t.symbol === "wEMBR") ?? BASE_TOKENS[1];

  const [tokenIn, setTokenIn] = useState<TokenInfo>(ETH_TOKEN);
  const [tokenOut, setTokenOut] = useState<TokenInfo>(wEmbrToken);
  const [amountIn, setAmountIn] = useState("");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [pickerFor, setPickerFor] = useState<"in" | "out" | null>(null);
  const [balIn, setBalIn] = useState<bigint | null>(null);
  const [balOut, setBalOut] = useState<bigint | null>(null);
  const quoteRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch balances whenever tokens or wallet change
  useEffect(() => {
    if (!baseWallet.wallet) { setBalIn(null); setBalOut(null); return; }
    const addr = baseWallet.wallet.address;

    const fetchBal = async (token: TokenInfo): Promise<bigint> => {
      if (token.address === "ETH") {
        const res = await fetch(BASE_RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [addr, "latest"] }),
        });
        const d = await res.json();
        return BigInt(d.result ?? "0x0");
      }
      const hex = await baseEthCall(token.address, "0x" + SEL.balanceOf + padAddr(addr));
      return decodeUint256(hex);
    };

    fetchBal(tokenIn).then(setBalIn).catch(() => setBalIn(null));
    fetchBal(tokenOut).then(setBalOut).catch(() => setBalOut(null));
  }, [baseWallet.wallet, tokenIn, tokenOut]);

  // Debounced quote
  const fetchRoute = useCallback(async (raw: string, from: TokenInfo, to: TokenInfo) => {
    if (!raw || !baseWallet.wallet) { setRoute(null); return; }
    const amtIn = parseUnits(raw, from.decimals);
    if (amtIn === 0n) { setRoute(null); return; }
    setIsQuoting(true);
    try {
      const r = await findBestRoute(from, to, amtIn, baseWallet.ethCall);
      setRoute(r);
    } catch {
      setRoute(null);
    } finally {
      setIsQuoting(false);
    }
  }, [baseWallet]);

  useEffect(() => {
    if (quoteRef.current) clearTimeout(quoteRef.current);
    quoteRef.current = setTimeout(() => fetchRoute(amountIn, tokenIn, tokenOut), 600);
    return () => { if (quoteRef.current) clearTimeout(quoteRef.current); };
  }, [amountIn, tokenIn, tokenOut, fetchRoute]);

  const flip = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn("");
    setRoute(null);
  };

  const handleSwap = async () => {
    if (!baseWallet.wallet || !baseWallet.isOnBase || !route) return;
    const amtIn = parseUnits(amountIn, tokenIn.decimals);
    if (amtIn === 0n) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }

    setIsSwapping(true);
    const slippage = 50n; // 0.5%
    const amountOutMin = (route.amountOut * (10000n - slippage)) / 10000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    const to = baseWallet.wallet.address;

    try {
      // Ensure ERC-20 approval if tokenIn is not native ETH
      if (tokenIn.address !== "ETH") {
        const spender = UNISWAP_V2_ROUTER;
        const allowHex = await baseWallet.ethCall(
          tokenIn.address,
          encAllowance(to, spender),
        );
        if (decodeUint256(allowHex) < amtIn) {
          toast({ title: `Approving ${tokenIn.symbol}…`, description: "Confirm in MetaMask" });
          await baseWallet.sendTx({ to: tokenIn.address, data: encApprove(spender, amtIn * 2n) });
          await new Promise((r) => setTimeout(r, 8000));
        }
      }

      let txHash: string;
      const isFromETH = tokenIn.address === "ETH";
      const isToETH = route.isToETH;

      if (isFromETH) {
        // ETH → tokens: swapExactETHForTokens
        const data = encSwapETHForTokensPath(amountOutMin, route.path, to, deadline);
        txHash = await baseWallet.sendTx({
          to: UNISWAP_V2_ROUTER,
          data,
          value: "0x" + amtIn.toString(16),
        });
      } else if (isToETH) {
        // tokens → ETH: swapExactTokensForETH
        const data = encSwapTokensForETHPath(amtIn, amountOutMin, route.path, to, deadline);
        txHash = await baseWallet.sendTx({ to: UNISWAP_V2_ROUTER, data });
      } else {
        // tokens → tokens: swapExactTokensForTokens
        const data = encSwapExactTokensForTokens(amtIn, amountOutMin, route.path, to, deadline);
        txHash = await baseWallet.sendTx({ to: UNISWAP_V2_ROUTER, data });
      }

      toast({ title: "Swap submitted ✓", description: txHash.slice(0, 20) + "…" });
      setAmountIn("");
      setRoute(null);
    } catch (err) {
      toast({ title: "Swap failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setIsSwapping(false);
    }
  };

  const feeDisplay = route
    ? formatUnits((route.amountOut * 25n) / 10000n, tokenOut.decimals, 6)
    : null;

  const canSwap =
    !isSwapping &&
    !!baseWallet.wallet &&
    baseWallet.isOnBase &&
    !!amountIn &&
    route !== null;

  return (
    <div className="max-w-lg mx-auto w-full space-y-6">
      {/* Pickers */}
      {pickerFor && (
        <TokenPickerModal
          open
          onClose={() => setPickerFor(null)}
          onSelect={(t) => {
            if (pickerFor === "in") {
              if (t.address === tokenOut.address) setTokenOut(tokenIn);
              setTokenIn(t);
            } else {
              if (t.address === tokenIn.address) setTokenIn(tokenOut);
              setTokenOut(t);
            }
            setAmountIn("");
            setRoute(null);
          }}
          exclude={pickerFor === "in" ? tokenOut.address : tokenIn.address}
          ethCall={baseWallet.ethCall}
        />
      )}

      {/* Network guard */}
      <NetworkGuard
        isOnBase={baseWallet.isOnBase}
        switchToBase={baseWallet.switchToBase}
        wallet={baseWallet.wallet}
        connect={baseWallet.connect}
        isConnecting={baseWallet.isConnecting}
        hasMetaMask={baseWallet.hasMetaMask}
      />

      <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent" />
        <CardContent className="p-5 space-y-2">

          {/* You pay */}
          <div className="bg-secondary/40 border border-border rounded-sm p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">You pay</span>
              {balIn !== null && (
                <button
                  className="text-[10px] font-bold uppercase tracking-widest text-primary hover:underline"
                  onClick={() => setAmountIn(formatUnits(balIn, tokenIn.decimals, tokenIn.decimals))}
                >
                  Max {formatUnits(balIn, tokenIn.decimals, 4)} {tokenIn.symbol}
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                className="flex-1 bg-transparent text-2xl font-mono font-bold text-foreground focus:outline-none placeholder:text-muted-foreground/40 min-w-0"
                placeholder="0.0"
                value={amountIn}
                onChange={(e) => setAmountIn(e.target.value)}
                inputMode="decimal"
              />
              <TokenSelectorButton token={tokenIn} onClick={() => setPickerFor("in")} />
            </div>
          </div>

          {/* Flip button */}
          <div className="flex items-center justify-center -my-1 relative z-10">
            <button
              onClick={flip}
              className="w-8 h-8 rounded-sm bg-card border border-border hover:border-primary/50 flex items-center justify-center text-muted-foreground hover:text-primary transition-all"
            >
              <ArrowDownUp className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* You receive */}
          <div className="bg-secondary/40 border border-border rounded-sm p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">You receive</span>
              {balOut !== null && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Bal: {formatUnits(balOut, tokenOut.decimals, 4)} {tokenOut.symbol}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 font-mono text-2xl font-bold text-foreground min-w-0 truncate">
                {isQuoting ? (
                  <span className="text-muted-foreground text-base flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Quoting…
                  </span>
                ) : route ? (
                  <span>≈ {formatUnits(route.amountOut, tokenOut.decimals, 6)}</span>
                ) : (
                  <span className="text-muted-foreground/40">0.0</span>
                )}
              </div>
              <TokenSelectorButton token={tokenOut} onClick={() => setPickerFor("out")} />
            </div>
          </div>

          {/* Quote details */}
          {route && (
            <div className="bg-secondary/30 border border-border rounded-sm px-4 py-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Route</span>
                <span className="font-mono text-foreground">
                  {route.routeLabel !== "Direct"
                    ? `${tokenIn.symbol} → ${route.path.slice(1, -1).map((a) => BASE_TOKENS.find((t) => t.address.toLowerCase() === a.toLowerCase())?.symbol ?? a.slice(0, 6)).join(" → ")} → ${tokenOut.symbol}`
                    : `${tokenIn.symbol} → ${tokenOut.symbol} (Direct)`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">0.25% fee → EMBR liquidity</span>
                <span className="font-mono text-muted-foreground">
                  {feeDisplay} {tokenOut.symbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Slippage tolerance</span>
                <span className="font-mono text-muted-foreground">0.5%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Min received</span>
                <span className="font-mono text-muted-foreground">
                  {formatUnits((route.amountOut * 9950n) / 10000n, tokenOut.decimals, 6)} {tokenOut.symbol}
                </span>
              </div>
            </div>
          )}

          <Button
            className="w-full mt-2"
            disabled={!canSwap}
            onClick={handleSwap}
          >
            {isSwapping ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Zap className="w-4 h-4 mr-2" />
            )}
            {isSwapping
              ? "Swapping…"
              : !baseWallet.wallet
              ? "Connect Wallet"
              : !baseWallet.isOnBase
              ? "Switch to Base"
              : !amountIn
              ? "Enter Amount"
              : isQuoting
              ? "Fetching Quote…"
              : route === null
              ? "No Route Found"
              : `Swap ${tokenIn.symbol} for ${tokenOut.symbol}`}
          </Button>
        </CardContent>
      </Card>

      {/* Airdrop panel */}
      {baseWallet.wallet && (
        <AirdropPanel
          address={baseWallet.wallet.address}
          ethCall={baseWallet.ethCall}
        />
      )}
    </div>
  );
}

// ── Pool state hook ───────────────────────────────────────────────────────────

interface PoolState {
  pairAddress: string | null;
  wEmbrReserve: bigint;
  ethReserve: bigint;
  lpTotalSupply: bigint;
  userLpBalance: bigint;
  loading: boolean;
  error: string | null;
}

function usePoolState(userAddress: string | null) {
  const [state, setState] = useState<PoolState>({
    pairAddress: null,
    wEmbrReserve: 0n,
    ethReserve: 0n,
    lpTotalSupply: 0n,
    userLpBalance: 0n,
    loading: false,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // Use the known pair address directly — avoids two extra RPC hops
      // (router.factory() → factory.getPair()) that can time-out under load.
      const pairAddr = WEMBR_WETH_PAIR;

      // Get reserves + token0 + totalSupply in parallel
      const [reservesHex, token0Hex, supplyHex] = await Promise.all([
        baseEthCall(pairAddr, "0x" + SEL.getReserves),
        baseEthCall(pairAddr, "0x" + SEL.token0),
        baseEthCall(pairAddr, "0x" + SEL.totalSupply),
      ]);

      const [r0, r1] = decodeReserves(reservesHex);
      const token0 = decodeAddress(token0Hex);
      const isWEmbrToken0 =
        token0.toLowerCase() === WEMBR_ADDRESS.toLowerCase();
      const wEmbrReserve = isWEmbrToken0 ? r0 : r1;
      const ethReserve = isWEmbrToken0 ? r1 : r0;
      const lpTotalSupply = decodeUint256(supplyHex);

      // User LP balance
      let userLpBalance = 0n;
      if (userAddress) {
        const balHex = await baseEthCall(
          pairAddr,
          "0x" + SEL.balanceOf + padAddr(userAddress),
        );
        userLpBalance = decodeUint256(balHex);
      }

      setState({
        pairAddress: pairAddr,
        wEmbrReserve,
        ethReserve,
        lpTotalSupply,
        userLpBalance,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: (err as Error).message,
      }));
    }
  }, [userAddress]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  return { ...state, refresh: load };
}

// ── Liquidity Tab ─────────────────────────────────────────────────────────────

function LiquidityTab() {
  const baseWallet = useBaseWallet();
  const { toast } = useToast();
  const pool = usePoolState(baseWallet.wallet?.address ?? null);

  const [mode, setMode] = useState<"add" | "remove">("add");

  // Add liquidity state
  const [ethIn, setEthIn] = useState("");
  const [wEmbrIn, setWEmbrIn] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  // Remove liquidity state
  const [lpIn, setLpIn] = useState("");
  const [isRemoving, setIsRemoving] = useState(false);

  // Auto-compute wEMBR from ETH input based on pool ratio
  const handleEthChange = (val: string) => {
    setEthIn(val);
    if (!pool.pairAddress || pool.ethReserve === 0n || !val) {
      setWEmbrIn("");
      return;
    }
    try {
      const ethWei = parseEther(val);
      if (ethWei === 0n) { setWEmbrIn(""); return; }
      const wEmbrNeeded = (ethWei * pool.wEmbrReserve) / pool.ethReserve;
      setWEmbrIn((Number(wEmbrNeeded) / 1e18).toFixed(6));
    } catch {
      setWEmbrIn("");
    }
  };

  // Auto-compute ETH from wEMBR input
  const handleWEmbrChange = (val: string) => {
    setWEmbrIn(val);
    if (!pool.pairAddress || pool.wEmbrReserve === 0n || !val) {
      setEthIn("");
      return;
    }
    try {
      const wEmbrWei = parseEther(val);
      if (wEmbrWei === 0n) { setEthIn(""); return; }
      const ethNeeded = (wEmbrWei * pool.ethReserve) / pool.wEmbrReserve;
      setEthIn((Number(ethNeeded) / 1e18).toFixed(8));
    } catch {
      setEthIn("");
    }
  };

  // Expected output for remove liquidity
  const lpWei = parseEther(lpIn);
  const expectedEth =
    pool.lpTotalSupply > 0n
      ? (lpWei * pool.ethReserve) / pool.lpTotalSupply
      : 0n;
  const expectedWEmbr =
    pool.lpTotalSupply > 0n
      ? (lpWei * pool.wEmbrReserve) / pool.lpTotalSupply
      : 0n;

  const handleAddLiquidity = async () => {
    if (!baseWallet.wallet || !baseWallet.isOnBase) return;
    const ethWei = parseEther(ethIn);
    const wEmbrWei = parseEther(wEmbrIn);
    if (ethWei === 0n || wEmbrWei === 0n) {
      toast({ title: "Enter amounts", variant: "destructive" });
      return;
    }
    setIsAdding(true);
    try {
      // Check & approve wEMBR
      const allowanceHex = await baseWallet.ethCall(
        WEMBR_ADDRESS,
        encAllowance(baseWallet.wallet.address, UNISWAP_V2_ROUTER),
      );
      if (decodeUint256(allowanceHex) < wEmbrWei) {
        toast({ title: "Approving wEMBR…", description: "Confirm in MetaMask" });
        await baseWallet.sendTx({
          to: WEMBR_ADDRESS,
          data: encApprove(UNISWAP_V2_ROUTER, wEmbrWei * 2n),
        });
        await new Promise((r) => setTimeout(r, 8000));
      }

      const slippage = 50n; // 0.5%
      const wEmbrMin = (wEmbrWei * (10000n - slippage)) / 10000n;
      const ethMin = (ethWei * (10000n - slippage)) / 10000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      toast({ title: "Adding liquidity…", description: "Confirm in MetaMask" });
      const txHash = await baseWallet.sendTx({
        to: UNISWAP_V2_ROUTER,
        data: encAddLiquidityETH(
          WEMBR_ADDRESS,
          wEmbrWei,
          wEmbrMin,
          ethMin,
          baseWallet.wallet.address,
          deadline,
        ),
        value: "0x" + ethWei.toString(16),
      });
      toast({ title: "Liquidity added ✓", description: txHash.slice(0, 20) + "…" });
      setEthIn("");
      setWEmbrIn("");
      setTimeout(() => pool.refresh(), 5000);
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveLiquidity = async () => {
    if (!baseWallet.wallet || !baseWallet.isOnBase || !pool.pairAddress) return;
    if (lpWei === 0n) {
      toast({ title: "Enter LP amount", variant: "destructive" });
      return;
    }
    setIsRemoving(true);
    try {
      // Approve LP token for router
      const allowanceHex = await baseWallet.ethCall(
        pool.pairAddress,
        encAllowance(baseWallet.wallet.address, UNISWAP_V2_ROUTER),
      );
      if (decodeUint256(allowanceHex) < lpWei) {
        toast({ title: "Approving LP token…", description: "Confirm in MetaMask" });
        await baseWallet.sendTx({
          to: pool.pairAddress,
          data: encApprove(UNISWAP_V2_ROUTER, lpWei * 2n),
        });
        await new Promise((r) => setTimeout(r, 8000));
      }

      const slippage = 50n;
      const ethMin = (expectedEth * (10000n - slippage)) / 10000n;
      const wEmbrMin = (expectedWEmbr * (10000n - slippage)) / 10000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      toast({ title: "Removing liquidity…", description: "Confirm in MetaMask" });
      const txHash = await baseWallet.sendTx({
        to: UNISWAP_V2_ROUTER,
        data: encRemoveLiquidityETH(
          WEMBR_ADDRESS,
          lpWei,
          wEmbrMin,
          ethMin,
          baseWallet.wallet.address,
          deadline,
        ),
      });
      toast({ title: "Liquidity removed ✓", description: txHash.slice(0, 20) + "…" });
      setLpIn("");
      setTimeout(() => pool.refresh(), 5000);
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto w-full space-y-6">
      {/* Network guard */}
      <NetworkGuard
        isOnBase={baseWallet.isOnBase}
        switchToBase={baseWallet.switchToBase}
        wallet={baseWallet.wallet}
        connect={baseWallet.connect}
        isConnecting={baseWallet.isConnecting}
        hasMetaMask={baseWallet.hasMetaMask}
      />

      {/* Pool stats */}
      <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent" />
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Droplets className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                wEMBR / ETH Pool
              </span>
            </div>
            <button
              onClick={pool.refresh}
              className="text-muted-foreground hover:text-foreground"
              title="Refresh"
            >
              <RefreshCcw className={cn("w-3.5 h-3.5", pool.loading && "animate-spin")} />
            </button>
          </div>

          {pool.error && (
            <div className="text-xs text-red-400 mb-3">{pool.error}</div>
          )}

          {!pool.pairAddress && !pool.loading ? (
            <div className="text-center py-4 text-sm text-muted-foreground italic">
              Pool not yet created — add liquidity to create it.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mb-0.5">
                  wEMBR Reserve
                </div>
                <div className="font-mono text-sm text-foreground">
                  {formatWei(pool.wEmbrReserve, 4)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mb-0.5">
                  ETH Reserve
                </div>
                <div className="font-mono text-sm text-foreground">
                  {formatWei(pool.ethReserve, 6)}
                </div>
              </div>
              {pool.wEmbrReserve > 0n && pool.ethReserve > 0n && (
                <div className="col-span-2">
                  <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mb-0.5">
                    Price
                  </div>
                  <div className="font-mono text-sm text-foreground">
                    1 wEMBR ={" "}
                    {(
                      Number(pool.ethReserve) / Number(pool.wEmbrReserve)
                    ).toFixed(8)}{" "}
                    ETH
                  </div>
                </div>
              )}
              {baseWallet.wallet && pool.lpTotalSupply > 0n && (
                <div className="col-span-2 pt-2 border-t border-border">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Your LP tokens</span>
                    <span className="font-mono text-foreground">
                      {formatWei(pool.userLpBalance, 6)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-muted-foreground">Your pool share</span>
                    <span className="font-mono text-foreground">
                      {pool.lpTotalSupply > 0n
                        ? (
                            (Number(pool.userLpBalance) /
                              Number(pool.lpTotalSupply)) *
                            100
                          ).toFixed(4)
                        : "0"}
                      %
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Remove toggle */}
      <div className="grid grid-cols-2 gap-2">
        {(["add", "remove"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "p-3 border rounded-sm text-sm font-bold uppercase tracking-wider transition-all flex items-center gap-2",
              mode === m
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
            )}
          >
            {m === "add" ? (
              <Plus className="w-4 h-4" />
            ) : (
              <Minus className="w-4 h-4" />
            )}
            {m === "add" ? "Add Liquidity" : "Remove Liquidity"}
          </button>
        ))}
      </div>

      {/* Add form */}
      {mode === "add" && (
        <Card className="border-border bg-card/80 rounded-sm">
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <Label className="uppercase text-xs font-bold tracking-widest text-muted-foreground">
                ETH amount
              </Label>
              <Input
                placeholder="0.00"
                value={ethIn}
                onChange={(e) => handleEthChange(e.target.value)}
                className="font-mono text-lg bg-secondary/50 border-border"
              />
            </div>
            <div className="flex items-center justify-center">
              <Plus className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Label className="uppercase text-xs font-bold tracking-widest text-muted-foreground">
                wEMBR amount{pool.pairAddress ? " (auto)" : ""}
              </Label>
              <Input
                placeholder="0.00"
                value={wEmbrIn}
                onChange={(e) => handleWEmbrChange(e.target.value)}
                className="font-mono text-lg bg-secondary/50 border-border"
              />
            </div>
            {!pool.pairAddress && (
              <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 rounded-sm px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                No pool yet — your deposit sets the initial price. Enter both amounts manually.
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/40 border border-border rounded-sm px-3 py-2">
              <Info className="w-3.5 h-3.5 shrink-0" />
              LP tokens go to your wallet. Slippage tolerance: 0.5%.
            </div>
            <Button
              className="w-full"
              disabled={isAdding || !baseWallet.wallet || !baseWallet.isOnBase || !ethIn || !wEmbrIn}
              onClick={handleAddLiquidity}
            >
              {isAdding ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              {isAdding ? "Adding…" : "Add Liquidity"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Remove form */}
      {mode === "remove" && (
        <Card className="border-border bg-card/80 rounded-sm">
          <CardContent className="p-6 space-y-4">
            {!pool.pairAddress ? (
              <div className="text-center py-4 text-sm text-muted-foreground italic">
                No pool exists yet.
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="uppercase text-xs font-bold tracking-widest text-muted-foreground">
                      LP tokens to burn
                    </Label>
                    {baseWallet.wallet && pool.userLpBalance > 0n && (
                      <button
                        className="text-xs text-primary hover:underline font-bold uppercase tracking-widest"
                        onClick={() =>
                          setLpIn((Number(pool.userLpBalance) / 1e18).toFixed(18).replace(/\.?0+$/, ""))
                        }
                      >
                        Max
                      </button>
                    )}
                  </div>
                  <Input
                    placeholder="0.00"
                    value={lpIn}
                    onChange={(e) => setLpIn(e.target.value)}
                    className="font-mono text-lg bg-secondary/50 border-border"
                  />
                  {baseWallet.wallet && (
                    <div className="text-xs text-muted-foreground">
                      Balance: {formatWei(pool.userLpBalance, 6)} LP
                    </div>
                  )}
                </div>

                {lpWei > 0n && (
                  <div className="bg-secondary/40 border border-border rounded-sm px-4 py-3 space-y-1.5">
                    <div className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-2">
                      You receive
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">ETH</span>
                      <span className="font-mono text-foreground">
                        ≈ {formatWei(expectedEth, 8)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">wEMBR</span>
                      <span className="font-mono text-foreground">
                        ≈ {formatWei(expectedWEmbr, 6)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/40 border border-border rounded-sm px-3 py-2">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  Slippage tolerance: 0.5%.
                </div>

                <Button
                  className="w-full"
                  variant="outline"
                  disabled={isRemoving || !baseWallet.wallet || !baseWallet.isOnBase || lpWei === 0n}
                  onClick={handleRemoveLiquidity}
                >
                  {isRemoving ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Minus className="w-4 h-4 mr-2" />
                  )}
                  {isRemoving ? "Removing…" : "Remove Liquidity"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EmberSwap() {
  return (
    <Shell>
      <div className="mb-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-3">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 bg-primary/20 rounded-sm border border-primary/50 box-glow" />
            <div className="relative flex items-center justify-center w-full h-full">
              <Zap className="w-6 h-6 text-primary fill-primary/60" />
            </div>
          </div>
          <div>
            <h1 className="text-4xl font-display font-bold uppercase tracking-tighter text-foreground text-glow leading-none">
              EmberSwap
            </h1>
            <p className="text-muted-foreground font-sans text-xs uppercase tracking-widest font-bold mt-1">
              Bridge &amp; Swap · Powered by Emberchain
            </p>
          </div>
        </div>

        {/* Stat chips */}
        <div className="flex flex-wrap gap-2 mt-4">
          <div className="flex items-center gap-1.5 bg-secondary/60 border border-border rounded-sm px-3 py-1.5 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-muted-foreground font-bold uppercase tracking-widest">0.25% fee → EMBR liquidity</span>
          </div>
          <div className="flex items-center gap-1.5 bg-secondary/60 border border-border rounded-sm px-3 py-1.5 text-xs">
            <TrendingUp className="w-3 h-3 text-primary" />
            <span className="text-muted-foreground font-bold uppercase tracking-widest">Swap activity tracked for airdrop</span>
          </div>
          <div className="flex items-center gap-1.5 bg-secondary/60 border border-border rounded-sm px-3 py-1.5 text-xs">
            <Flame className="w-3 h-3 text-primary fill-primary/40" />
            <span className="text-muted-foreground font-bold uppercase tracking-widest">Base Mainnet</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="bridge" className="w-full">
        <TabsList className="grid grid-cols-3 max-w-md bg-secondary rounded-sm p-1 mb-8">
          <TabsTrigger
            value="bridge"
            className="rounded-sm uppercase font-bold text-xs tracking-widest data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Flame className="w-3.5 h-3.5 mr-1.5" /> Bridge
          </TabsTrigger>
          <TabsTrigger
            value="swap"
            className="rounded-sm uppercase font-bold text-xs tracking-widest data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Zap className="w-3.5 h-3.5 mr-1.5" /> Swap
          </TabsTrigger>
          <TabsTrigger
            value="pool"
            className="rounded-sm uppercase font-bold text-xs tracking-widest data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Droplets className="w-3.5 h-3.5 mr-1.5" /> Pool
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bridge">
          <BridgeTab />
        </TabsContent>
        <TabsContent value="swap">
          <SwapTab />
        </TabsContent>
        <TabsContent value="pool">
          <LiquidityTab />
        </TabsContent>
      </Tabs>
    </Shell>
  );
}
