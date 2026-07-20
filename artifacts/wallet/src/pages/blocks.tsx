import React from "react";
import { Shell } from "@/components/layout/shell";
import { useListBlocks, useGetChainStatus, useListTransactions } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import {
  Blocks,
  Clock,
  Flame,
  ArrowUpRight,
  Layers,
  Activity,
  Zap,
  Database,
  Hash,
  TrendingUp,
  ArrowLeftRight,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { formatHash, formatEmbr, cn } from "@/lib/utils";

// ── helpers ────────────────────────────────────────────────────────────────

function abbreviateNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3)  return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatSupply(weiStr: string): string {
  try {
    const wei = BigInt(weiStr);
    const embr = Number(wei / 10n ** 15n) / 1000; // 3-decimal precision
    return embr.toLocaleString(undefined, { maximumFractionDigits: 2 });
  } catch {
    return "0";
  }
}

function timeAgo(ts: string | Date): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── stat cards ─────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "border rounded-sm p-4 flex flex-col gap-1 bg-card/60 backdrop-blur",
        accent ? "border-primary/40 bg-primary/5" : "border-border",
      )}
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground font-sans">
        <span className={accent ? "text-primary" : "text-muted-foreground"}>{icon}</span>
        {label}
      </div>
      <div className="font-mono text-xl font-bold leading-tight text-foreground">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground font-sans">{sub}</div>}
    </div>
  );
}

// ── main page ──────────────────────────────────────────────────────────────

export default function BlockExplorer() {
  const { data: chain } = useGetChainStatus({ query: { refetchInterval: 5000 } });
  const { data: blocks, isLoading: blocksLoading } = useListBlocks(
    { limit: 10 },
    { query: { refetchInterval: 5000 } },
  );
  const { data: txs, isLoading: txsLoading } = useListTransactions(
    { limit: 10 },
    { query: { refetchInterval: 5000 } },
  );

  const latestBlock = blocks?.[0];

  return (
    <Shell requireWallet={false}>
      {/* ── Header ── */}
      <div className="border-b border-border pb-6 mb-6">
        <h1 className="text-4xl font-display font-bold uppercase tracking-tighter text-foreground mb-1 flex items-center gap-3">
          <Layers className="w-8 h-8 text-primary" /> Emberchain Explorer
        </h1>
        <p className="text-muted-foreground font-sans text-sm uppercase tracking-widest font-bold">
          {chain?.chainName ?? "EMBR"} · Proof-of-Work · Single Node
        </p>
      </div>

      {/* ── Overview stats (Etherscan-style top row) ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard
          icon={<Database className="w-3.5 h-3.5" />}
          label="Total Supply"
          value={chain ? `${formatSupply(chain.totalSupply)} EMBR` : "…"}
          sub={`${chain?.height ?? 0} blocks × ${formatEmbr(chain?.blockReward ?? "0")} EMBR`}
          accent
        />
        <StatCard
          icon={<Blocks className="w-3.5 h-3.5" />}
          label="Block Height"
          value={chain ? `#${chain.height.toLocaleString()}` : "…"}
          sub={latestBlock ? `Latest ${timeAgo(latestBlock.timestamp)}` : undefined}
        />
        <StatCard
          icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
          label="Transactions"
          value={chain ? chain.totalTransactions.toLocaleString() : "…"}
          sub={`${chain?.pendingTransactionCount ?? 0} pending`}
        />
        <StatCard
          icon={<Zap className="w-3.5 h-3.5" />}
          label="Difficulty"
          value={chain ? abbreviateNumber(Number(chain.difficulty)) : "…"}
          sub={`Target ${chain?.targetBlockTimeSeconds ?? 8}s/block`}
        />
        <StatCard
          icon={<Clock className="w-3.5 h-3.5" />}
          label="Avg Block Time"
          value={chain?.avgBlockTime != null ? `${chain.avgBlockTime}s` : "…"}
          sub="Last 20 blocks"
        />
        <StatCard
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          label="Block Reward"
          value={`${formatEmbr(chain?.blockReward ?? "0")} EMBR`}
          sub="Per block, to miner"
        />
      </div>

      {/* ── Latest block highlight ── */}
      {latestBlock && (
        <div className="mb-6 border border-primary/20 bg-primary/5 rounded-sm p-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <div className="flex items-center gap-2 font-sans text-[10px] font-bold uppercase tracking-widest text-primary">
            <Flame className="w-3.5 h-3.5" /> Latest Block
          </div>
          <div className="font-mono font-bold text-foreground">
            <Link href={`/blocks/${latestBlock.number}`} className="hover:underline text-primary">
              #{latestBlock.number}
            </Link>
          </div>
          <div className="font-mono text-xs text-muted-foreground">{latestBlock.hash}</div>
          <div className="text-xs text-muted-foreground font-sans">{timeAgo(latestBlock.timestamp)}</div>
          <div className="text-xs font-sans">
            <span className="text-muted-foreground">Miner </span>
            <span className="font-mono">{formatHash(latestBlock.miner, 8)}</span>
          </div>
          <div className="text-xs font-sans">
            <span className="text-muted-foreground">TXs </span>
            <span className="font-mono font-bold">{latestBlock.transactionCount}</span>
          </div>
        </div>
      )}

      {/* ── Two-column layout: Recent Blocks | Recent Transactions ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Recent Blocks */}
        <Card className="border-border bg-card/80 backdrop-blur rounded-sm overflow-hidden">
          <div className="bg-secondary/50 border-b border-border p-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground font-sans">
              <Blocks className="w-4 h-4" /> Recent Blocks
            </div>
            <Link
              href="/blocks"
              className="text-[10px] font-bold uppercase tracking-widest text-primary hover:underline flex items-center gap-1 font-sans"
            >
              View all <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="divide-y divide-border/40">
            {blocksLoading && (
              <div className="p-6 text-center text-muted-foreground text-xs font-sans font-bold uppercase tracking-widest">
                Scanning chain…
              </div>
            )}
            {blocks?.map((block) => (
              <div key={block.hash} className="flex items-center gap-4 px-4 py-3 hover:bg-secondary/20 transition-colors">
                {/* Block number */}
                <div className="w-10 h-10 bg-secondary/60 border border-border rounded-sm flex items-center justify-center shrink-0">
                  <Blocks className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/blocks/${block.number}`}
                      className="font-mono font-bold text-primary hover:underline text-sm"
                    >
                      #{block.number}
                    </Link>
                    <span className="text-[10px] text-muted-foreground font-sans">{timeAgo(block.timestamp)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground font-sans mt-0.5">
                    Miner{" "}
                    <span className="font-mono">{formatHash(block.miner, 6)}</span>
                    {"  "}·{"  "}
                    <span className="text-foreground font-bold">{block.transactionCount} tx</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-mono font-bold text-foreground">
                    {formatEmbr(chain?.blockReward ?? "0")}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-sans">EMBR reward</div>
                </div>
              </div>
            ))}
            {!blocksLoading && (!blocks || blocks.length === 0) && (
              <div className="p-6 text-center text-muted-foreground text-xs font-sans font-bold uppercase tracking-widest">
                No blocks yet. Start the forge.
              </div>
            )}
          </div>
        </Card>

        {/* Recent Transactions */}
        <Card className="border-border bg-card/80 backdrop-blur rounded-sm overflow-hidden">
          <div className="bg-secondary/50 border-b border-border p-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground font-sans">
              <Activity className="w-4 h-4" /> Recent Transactions
            </div>
            <Link
              href="/transactions"
              className="text-[10px] font-bold uppercase tracking-widest text-primary hover:underline flex items-center gap-1 font-sans"
            >
              View all <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="divide-y divide-border/40">
            {txsLoading && (
              <div className="p-6 text-center text-muted-foreground text-xs font-sans font-bold uppercase tracking-widest">
                Scanning mempool…
              </div>
            )}
            {txs?.map((tx) => (
              <div key={tx.hash} className="flex items-center gap-4 px-4 py-3 hover:bg-secondary/20 transition-colors">
                {/* Status icon */}
                <div className="w-10 h-10 bg-secondary/60 border border-border rounded-sm flex items-center justify-center shrink-0">
                  {tx.status === "success" && <CheckCircle2 className="w-4 h-4 text-primary" />}
                  {tx.status === "pending" && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
                  {tx.status === "failed" && <Hash className="w-4 h-4 text-destructive" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/transactions/${tx.hash}`}
                      className="font-mono font-bold text-primary hover:underline text-xs"
                    >
                      {formatHash(tx.hash, 8)}
                    </Link>
                    <span className="text-[10px] text-muted-foreground font-sans capitalize">{tx.status}</span>
                  </div>
                  <div className="text-xs text-muted-foreground font-sans mt-0.5">
                    <span className="font-mono">{formatHash(tx.from, 6)}</span>
                    {" → "}
                    <span className="font-mono">{tx.to ? formatHash(tx.to, 6) : "Contract"}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-mono font-bold text-foreground">{formatEmbr(tx.value)}</div>
                  <div className="text-[10px] text-muted-foreground font-sans">EMBR</div>
                </div>
              </div>
            ))}
            {!txsLoading && (!txs || txs.length === 0) && (
              <div className="p-6 text-center text-muted-foreground text-xs font-sans font-bold uppercase tracking-widest">
                No transactions yet.
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ── Chain parameters table ── */}
      <Card className="mt-6 border-border bg-card/80 backdrop-blur rounded-sm overflow-hidden">
        <div className="bg-secondary/50 border-b border-border p-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground font-sans">
          <Database className="w-4 h-4" /> Chain Parameters
        </div>
        <div className="divide-y divide-border/40 font-mono text-sm">
          {[
            ["Chain Name", chain?.chainName ?? "…"],
            ["Symbol / Ticker", chain?.symbol ?? "…"],
            ["Consensus", "Proof of Work (keccak256)"],
            ["Block Reward", chain ? `${formatEmbr(chain.blockReward)} EMBR` : "…"],
            ["Target Block Time", chain ? `${chain.targetBlockTimeSeconds}s` : "…"],
            ["Genesis Difficulty", "60,000"],
            ["Decimals", "18 (like ETH/wei)"],
            ["Total Supply", chain ? `${formatSupply(chain.totalSupply)} EMBR (${chain.totalSupply} wei)` : "…"],
            ["Total Blocks Mined", chain ? chain.height.toLocaleString() : "…"],
            ["Total Transactions", chain ? chain.totalTransactions.toLocaleString() : "…"],
            ["Current Difficulty", chain ? Number(chain.difficulty).toLocaleString() : "…"],
            ["Latest Block Hash", chain ? chain.latestBlockHash : "…"],
          ].map(([label, value]) => (
            <div key={label} className="grid grid-cols-2 px-4 py-2.5 hover:bg-secondary/10 transition-colors">
              <span className="text-muted-foreground font-sans text-xs font-bold uppercase tracking-widest self-center">
                {label}
              </span>
              <span className="text-foreground text-xs break-all">{value}</span>
            </div>
          ))}
        </div>
      </Card>
    </Shell>
  );
}
