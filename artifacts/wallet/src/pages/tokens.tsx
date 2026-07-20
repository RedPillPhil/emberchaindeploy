import React, { useEffect, useState } from "react";
import { Shell } from "@/components/layout/shell";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Coins, Code2, Loader2, ExternalLink, CheckCircle2 } from "lucide-react";
import { cn, formatHash } from "@/lib/utils";

function formatTokenAmount(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  const n = BigInt(raw);
  const d = BigInt(10) ** BigInt(decimals);
  const whole = n / d;
  const frac  = n % d;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return fracStr ? `${whole.toLocaleString()}.${fracStr}` : whole.toLocaleString();
}

interface ContractEntry {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  isToken: boolean;
  creator: string | null;
  creatorTx: string | null;
  createdAt: string;
}

type Tab = "tokens" | "contracts";

export default function Tokens() {
  const [, setLocation] = useLocation();
  // Drive tab from URL hash: /tokens#contracts → contracts tab
  const [tab, setTab] = useState<Tab>(
    () => (typeof window !== "undefined" && window.location.hash === "#contracts") ? "contracts" : "tokens"
  );

  const switchTab = (t: Tab) => {
    setTab(t);
    window.location.hash = t === "contracts" ? "contracts" : "";
  };
  const [tokens, setTokens]       = useState<ContractEntry[]>([]);
  const [contracts, setContracts] = useState<ContractEntry[]>([]);
  const [loadingTokens, setLoadingTokens]       = useState(true);
  const [loadingContracts, setLoadingContracts] = useState(true);

  const fetchAll = () => {
    fetch("/api/tokens")
      .then((r) => r.json())
      .then((d) => setTokens(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoadingTokens(false));

    fetch("/api/contracts/list")
      .then((r) => r.json())
      .then((d) => setContracts(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoadingContracts(false));
  };

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 30_000);
    return () => clearInterval(iv);
  }, []);

  const tabClass = (t: Tab) =>
    cn(
      "px-4 py-2 text-[11px] font-sans font-bold uppercase tracking-widest border-b-2 transition-colors",
      tab === t
        ? "border-primary text-primary"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );

  return (
    <Shell requireWallet={false}>
      {/* Header */}
      <div className="border-b border-border pb-6 mb-0">
        <h1 className="text-4xl font-display font-bold uppercase tracking-tighter text-foreground mb-2 flex items-center gap-3">
          <Coins className="w-8 h-8 text-primary" /> Chain Explorer
        </h1>
        <p className="text-muted-foreground font-sans text-sm uppercase tracking-widest font-bold">
          Tokens &amp; contracts deployed on Emberchain
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-6">
        <button className={tabClass("tokens")} onClick={() => switchTab("tokens")}>
          <span className="flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5" />
            Token Tracker
            {!loadingTokens && (
              <span className="ml-1 px-1.5 py-0.5 text-[9px] rounded-full bg-primary/10 text-primary border border-primary/20">
                {tokens.length}
              </span>
            )}
          </span>
        </button>
        <button className={tabClass("contracts")} onClick={() => switchTab("contracts")}>
          <span className="flex items-center gap-1.5">
            <Code2 className="w-3.5 h-3.5" />
            All Contracts
            {!loadingContracts && (
              <span className="ml-1 px-1.5 py-0.5 text-[9px] rounded-full bg-secondary/80 text-muted-foreground border border-border">
                {contracts.length}
              </span>
            )}
          </span>
        </button>
      </div>

      {/* ── Token Tracker ── */}
      {tab === "tokens" && (
        <>
          {loadingTokens ? (
            <LoadingRow />
          ) : tokens.length === 0 ? (
            <EmptyState
              icon={<Coins className="w-10 h-10 text-muted-foreground mx-auto mb-4" />}
              title="No Tokens Found"
              body="No ERC-20 tokens have been deployed on this network yet."
            />
          ) : (
            <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-secondary/50 border-b border-border font-sans uppercase tracking-widest text-muted-foreground text-[10px]">
                    <tr>
                      <th className="p-3 font-bold w-10">#</th>
                      <th className="p-3 font-bold">Name</th>
                      <th className="p-3 font-bold">Symbol</th>
                      <th className="p-3 font-bold text-right">Total Supply</th>
                      <th className="p-3 font-bold text-right">Decimals</th>
                      <th className="p-3 font-bold">Contract</th>
                      <th className="p-3 font-bold">Deployer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {tokens.map((token, i) => (
                      <tr
                        key={token.address}
                        className="hover:bg-secondary/20 transition-colors cursor-pointer"
                        onClick={() => setLocation(`/tokens/${token.address}`)}
                      >
                        <td className="p-3 font-mono text-muted-foreground text-xs">{i + 1}</td>
                        <td className="p-3">
                          <span className="font-bold text-foreground text-sm">{token.name || "—"}</span>
                        </td>
                        <td className="p-3">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-sans font-bold uppercase tracking-widest border bg-accent/10 text-accent border-accent/40">
                            {token.symbol || "—"}
                          </span>
                        </td>
                        <td className="p-3 text-right font-mono text-sm font-bold text-foreground">
                          {token.totalSupply && token.decimals != null
                            ? formatTokenAmount(token.totalSupply, token.decimals)
                            : "—"}
                        </td>
                        <td className="p-3 text-right font-mono text-sm text-muted-foreground">
                          {token.decimals ?? "—"}
                        </td>
                        <td className="p-3 font-mono text-xs">
                          <button
                            onClick={(e) => { e.stopPropagation(); setLocation(`/tokens/${token.address}`); }}
                            className="text-primary hover:underline flex items-center gap-1"
                          >
                            {formatHash(token.address, 6)}
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </td>
                        <td className="p-3 font-mono text-xs text-muted-foreground">
                          {token.creator ? formatHash(token.creator, 4) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── All Contracts ── */}
      {tab === "contracts" && (
        <>
          {loadingContracts ? (
            <LoadingRow />
          ) : contracts.length === 0 ? (
            <EmptyState
              icon={<Code2 className="w-10 h-10 text-muted-foreground mx-auto mb-4" />}
              title="No Contracts Indexed Yet"
              body="The chain scanner will populate this list automatically as contracts are deployed."
            />
          ) : (
            <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-secondary/50 border-b border-border font-sans uppercase tracking-widest text-muted-foreground text-[10px]">
                    <tr>
                      <th className="p-3 font-bold w-10">#</th>
                      <th className="p-3 font-bold">Contract</th>
                      <th className="p-3 font-bold">Type</th>
                      <th className="p-3 font-bold">Name</th>
                      <th className="p-3 font-bold">Symbol</th>
                      <th className="p-3 font-bold text-right">Total Supply</th>
                      <th className="p-3 font-bold">Deployer</th>
                      <th className="p-3 font-bold">Deploy Tx</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {contracts.map((c, i) => (
                      <tr
                        key={c.address}
                        className="hover:bg-secondary/20 transition-colors cursor-pointer"
                        onClick={() => setLocation(`/tokens/${c.address}`)}
                      >
                        <td className="p-3 font-mono text-muted-foreground text-xs">{i + 1}</td>
                        <td className="p-3 font-mono text-xs">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setLocation(`/tokens/${c.address}`);
                            }}
                            className="text-primary hover:underline flex items-center gap-1"
                          >
                            {formatHash(c.address, 6)}
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </td>
                        <td className="p-3">
                          {c.isToken ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-sans font-bold uppercase tracking-widest border bg-accent/10 text-accent border-accent/40">
                              <CheckCircle2 className="w-2.5 h-2.5" /> ERC-20
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-sans font-bold uppercase tracking-widest border bg-secondary text-muted-foreground border-border">
                              <Code2 className="w-2.5 h-2.5" /> Contract
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-sm text-foreground font-bold">
                          {c.name || <span className="text-muted-foreground font-normal">—</span>}
                        </td>
                        <td className="p-3">
                          {c.symbol ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-sans font-bold uppercase tracking-widest border bg-primary/10 text-primary border-primary/20">
                              {c.symbol}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono text-sm text-foreground">
                          {c.totalSupply && c.decimals != null
                            ? formatTokenAmount(c.totalSupply, c.decimals)
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="p-3 font-mono text-xs text-muted-foreground">
                          {c.creator ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); setLocation(`/ledger/${c.creator}`); }}
                              className="text-primary hover:underline"
                            >
                              {formatHash(c.creator, 4)}
                            </button>
                          ) : "—"}
                        </td>
                        <td className="p-3 font-mono text-xs text-muted-foreground">
                          {c.creatorTx ? formatHash(c.creatorTx, 4) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </Shell>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-3 p-6 border border-border rounded-sm bg-card/50 text-muted-foreground font-sans font-bold uppercase tracking-widest text-sm animate-pulse">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card className="p-12 border-border bg-card/50 rounded-sm text-center">
      {icon}
      <div className="text-foreground font-sans font-bold uppercase tracking-widest mb-2">{title}</div>
      <div className="text-muted-foreground font-sans text-sm">{body}</div>
    </Card>
  );
}
