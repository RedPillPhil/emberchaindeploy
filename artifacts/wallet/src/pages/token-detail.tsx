import React, { useEffect, useState } from "react";
import { Shell } from "@/components/layout/shell";
import { useParams, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Coins,
  Code2,
  Loader2,
  Copy,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatHash } from "@/lib/utils";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { Link } from "wouter";

// ── token amount formatter ────────────────────────────────────────────────────

function formatTokenAmount(raw: string, decimals: number, symbol?: string): string {
  if (!raw || raw === "0") return symbol ? `0 ${symbol}` : "0";
  const n = BigInt(raw);
  const d = BigInt(10) ** BigInt(decimals);
  const whole = n / d;
  const frac  = n % d;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  const formatted = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return symbol ? `${formatted} ${symbol}` : formatted;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-sans font-bold uppercase tracking-widest border", className)}>
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors border-b border-border/50 last:border-0">
      <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-[10px] flex items-center mb-1 md:mb-0">
        {label}
      </dt>
      <dd className="md:col-span-3 font-mono text-sm">{children}</dd>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-2 text-muted-foreground hover:text-primary transition-colors"
      title="Copy"
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ── ABI Panel ────────────────────────────────────────────────────────────────

function parseArg(val: string): unknown {
  try { return JSON.parse(val); } catch { return val; }
}

function ReadFunctionRow({ address, fn }: { address: string; fn: Record<string, any> }) {
  const inputs: any[] = fn.inputs || [];
  const [args, setArgs] = useState<string[]>(inputs.map(() => ""));
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleQuery = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${address}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ functionName: fn.name, args: args.map(parseArg) }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(JSON.stringify(data.decoded, null, 2));
      } else {
        setError(data.error || "Unknown error");
      }
    } catch (e: any) {
      setError(e.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  const paramStr = inputs.map((inp: any) => `${inp.type} ${inp.name}`).join(", ");

  return (
    <AccordionItem value={fn.name} className="border-0 px-4">
      <AccordionTrigger className="font-mono text-sm text-primary hover:no-underline py-3">
        <span>{fn.name}</span>
        {paramStr && <span className="ml-2 text-muted-foreground text-xs">({paramStr})</span>}
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-3 pb-2">
          {inputs.map((inp: any, i: number) => (
            <div key={i} className="space-y-1">
              <label className="text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground">
                {inp.name} ({inp.type})
              </label>
              <Input
                value={args[i]}
                onChange={(e) => { const next = [...args]; next[i] = e.target.value; setArgs(next); }}
                placeholder={inp.type}
                className="h-8 text-xs font-mono rounded-sm border-border"
              />
            </div>
          ))}
          <Button
            size="sm"
            onClick={handleQuery}
            disabled={loading}
            className="h-7 text-[10px] font-sans font-bold uppercase tracking-widest rounded-sm"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            Query
          </Button>
          {result !== null && (
            <pre className="bg-black/60 border border-border rounded-sm p-3 text-xs font-mono text-primary whitespace-pre-wrap break-all">
              {result}
            </pre>
          )}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-xs font-mono border border-destructive/30 rounded-sm p-2 bg-destructive/5">
              <AlertTriangle className="w-3 h-3 shrink-0" /> {error}
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function WriteFunctionRow({
  address,
  fn,
  activeWallet,
}: {
  address: string;
  fn: Record<string, any>;
  activeWallet: { address: string; privateKey: string } | null;
}) {
  const inputs: any[] = fn.inputs || [];
  const isPayable = fn.stateMutability === "payable";
  const [args, setArgs] = useState<string[]>(inputs.map(() => ""));
  const [value, setValue] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!activeWallet) return;
    setLoading(true);
    setTxHash(null);
    setError(null);
    try {
      const body: any = {
        functionName: fn.name,
        args: args.map(parseArg),
        fromPrivateKey: activeWallet.privateKey,
      };
      if (isPayable && value) body.value = value;
      const res = await fetch(`/api/contracts/${address}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setTxHash(data.txHash);
      } else {
        setError(data.error || "Unknown error");
      }
    } catch (e: any) {
      setError(e.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  const paramStr = inputs.map((inp: any) => `${inp.type} ${inp.name}`).join(", ");

  return (
    <AccordionItem value={fn.name} className="border-0 px-4">
      <AccordionTrigger className="font-mono text-sm text-accent hover:no-underline py-3">
        <span>{fn.name}</span>
        {paramStr && <span className="ml-2 text-muted-foreground text-xs">({paramStr})</span>}
        {isPayable && <Pill className="ml-2 bg-yellow-500/10 text-yellow-400 border-yellow-500/30">payable</Pill>}
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-3 pb-2">
          {inputs.map((inp: any, i: number) => (
            <div key={i} className="space-y-1">
              <label className="text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground">
                {inp.name} ({inp.type})
              </label>
              <Input
                value={args[i]}
                onChange={(e) => { const next = [...args]; next[i] = e.target.value; setArgs(next); }}
                placeholder={inp.type}
                className="h-8 text-xs font-mono rounded-sm border-border"
              />
            </div>
          ))}
          {isPayable && (
            <div className="space-y-1">
              <label className="text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground">
                Value (EMBR)
              </label>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                className="h-8 text-xs font-mono rounded-sm border-border"
              />
            </div>
          )}
          {!activeWallet ? (
            <div className="text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground border border-border rounded-sm px-3 py-2">
              Connect a wallet to send transactions
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleSend}
              disabled={loading}
              className="h-7 text-[10px] font-sans font-bold uppercase tracking-widest rounded-sm border-accent/40 text-accent hover:bg-accent/10"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Send
            </Button>
          )}
          {txHash && (
            <div className="flex items-center gap-2 text-primary text-xs font-mono border border-primary/30 rounded-sm p-2 bg-primary/5">
              <CheckCircle2 className="w-3 h-3 shrink-0" />
              <span>TX: </span>
              <Link href={`/transactions/${txHash}`} className="hover:underline break-all">{txHash}</Link>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-xs font-mono border border-destructive/30 rounded-sm p-2 bg-destructive/5">
              <AlertTriangle className="w-3 h-3 shrink-0" /> {error}
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function AbiPanel({ address, abi }: { address: string; abi: Record<string, any>[] }) {
  const { activeWallet } = useActiveWallet();
  const readFns = abi.filter((f) => f.type === "function" && (f.stateMutability === "view" || f.stateMutability === "pure"));
  const writeFns = abi.filter((f) => f.type === "function" && (f.stateMutability === "nonpayable" || f.stateMutability === "payable"));

  return (
    <Tabs defaultValue="read" className="w-full">
      <TabsList className="w-full rounded-sm border border-border bg-secondary/30 mb-4">
        <TabsTrigger value="read" className="flex-1 rounded-sm text-[10px] font-sans font-bold uppercase tracking-widest">
          Read Contract
        </TabsTrigger>
        <TabsTrigger value="write" className="flex-1 rounded-sm text-[10px] font-sans font-bold uppercase tracking-widest">
          Write Contract
        </TabsTrigger>
      </TabsList>
      <TabsContent value="read">
        <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
          {readFns.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground font-sans text-sm uppercase font-bold tracking-widest">No read functions found</div>
          ) : (
            <Accordion type="multiple" className="divide-y divide-border/40">
              {readFns.map((fn, i) => <ReadFunctionRow key={i} address={address} fn={fn} />)}
            </Accordion>
          )}
        </Card>
      </TabsContent>
      <TabsContent value="write">
        <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
          {writeFns.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground font-sans text-sm uppercase font-bold tracking-widest">No write functions found</div>
          ) : (
            <Accordion type="multiple" className="divide-y divide-border/40">
              {writeFns.map((fn, i) => <WriteFunctionRow key={i} address={address} fn={fn} activeWallet={activeWallet} />)}
            </Accordion>
          )}
        </Card>
      </TabsContent>
    </Tabs>
  );
}

// ── Contract verification panel ───────────────────────────────────────────────

function VerifyPanel({ address, onVerified }: { address: string; onVerified: () => void }) {
  const [open, setOpen] = useState(false);
  const [abiText, setAbiText] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    let parsed: object[];
    try {
      parsed = JSON.parse(abiText);
      if (!Array.isArray(parsed)) throw new Error("ABI must be a JSON array");
    } catch (e: any) {
      setError(e.message || "Invalid JSON");
      return;
    }
    setLoading(true);
    try {
      const body: Record<string, unknown> = { abi: parsed };
      if (name.trim()) body.name = name.trim();
      const res = await fetch(`/api/contracts/${address}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Registration failed");
      onVerified();
    } catch (e: any) {
      setError(e.message || "Failed to register ABI");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
      {/* Not-verified banner */}
      <div className="flex items-center gap-3 p-5 border-b border-border/50 bg-amber-500/5">
        <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-sans font-bold uppercase tracking-widest text-amber-400">
            Contract not verified
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Paste the contract ABI to enable read &amp; write interactions.
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition-colors text-[10px] font-sans font-bold uppercase tracking-widest shrink-0"
        >
          Verify
          <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div className="p-5 space-y-4">
          {/* Optional name */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground">
              Contract name <span className="font-normal opacity-60">(optional)</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. EmberBridge"
              className="h-8 text-sm font-mono rounded-sm border-border"
            />
          </div>

          {/* ABI textarea */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground">
              ABI JSON <span className="text-destructive">*</span>
            </label>
            <Textarea
              value={abiText}
              onChange={(e) => setAbiText(e.target.value)}
              placeholder={'[\n  {\n    "type": "function",\n    "name": "example",\n    ...\n  }\n]'}
              className="h-52 font-mono text-xs rounded-sm border-border resize-y leading-relaxed"
            />
            <p className="text-[10px] text-muted-foreground">
              Paste the full ABI array from your Hardhat/Foundry build artifacts, or from the compilation output.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-destructive text-xs font-mono border border-destructive/30 rounded-sm p-3 bg-destructive/5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSubmit}
              disabled={loading || !abiText.trim()}
              className="h-8 text-[10px] font-sans font-bold uppercase tracking-widest rounded-sm px-4"
            >
              {loading
                ? <><Loader2 className="w-3 h-3 animate-spin mr-1.5" /> Registering…</>
                : <><ShieldCheck className="w-3 h-3 mr-1.5" /> Register ABI</>
              }
            </Button>
            <button
              onClick={() => { setOpen(false); setError(null); setAbiText(""); setName(""); }}
              className="text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── token detail data ─────────────────────────────────────────────────────────

interface ContractDetail {
  address: string;
  isToken: boolean;
  isContract?: boolean;
  bytecodeSize?: number;
  name?: string | null;
  symbol?: string | null;
  decimals?: number | null;
  totalSupply?: string | null;
  holderCount?: number;
  holders?: { address: string; balance: string }[];
  abi?: Record<string, any>[] | null;
  creator?: string | null;
  creatorTx?: string | null;
  createdAt?: string | null;
}

export default function TokenDetailPage() {
  const params = useParams<{ address: string }>();
  const address = params.address;
  const [, setLocation] = useLocation();

  const [token, setToken] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadContract = React.useCallback(() => {
    if (!address) return;
    setLoading(true);
    setError(null);
    // Try ERC-20 token endpoint first; fall back to generic contract endpoint
    fetch(`/api/tokens/${address}`)
      .then((r) => r.ok ? r.json() : Promise.reject("not-token"))
      .then((data) => { setToken({ ...data, isToken: true }); setLoading(false); })
      .catch(() => {
        fetch(`/api/contracts/${address}`)
          .then((r) => {
            if (!r.ok) throw new Error("Contract not found");
            return r.json();
          })
          .then((data) => {
            if (!data.isContract) throw new Error("No contract at this address");
            setToken(data);
          })
          .catch((e) => setError(e.message || "Failed to load contract"))
          .finally(() => setLoading(false));
      });
  }, [address]);

  useEffect(() => { loadContract(); }, [loadContract]);

  if (loading) {
    return (
      <Shell requireWallet={false}>
        <div className="flex items-center gap-3 p-6 border border-border rounded-sm bg-card/50 text-muted-foreground font-sans font-bold uppercase tracking-widest text-sm animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      </Shell>
    );
  }

  if (error || !token) {
    return (
      <Shell requireWallet={false}>
        <Card className="p-8 border-border bg-card/50 rounded-sm text-center">
          <div className="text-foreground font-sans font-bold uppercase tracking-widest mb-2">Not Found</div>
          <div className="text-muted-foreground font-sans text-sm">{error || "No contract at this address."}</div>
        </Card>
      </Shell>
    );
  }

  const isToken = token.isToken;
  const totalSupplyBig = token.totalSupply ? BigInt(token.totalSupply) : 0n;
  const holders = token.holders ?? [];

  return (
    <Shell requireWallet={false}>
      {/* Header */}
      <div className="border-b border-border pb-6 mb-8">
        <h1 className="text-4xl font-display font-bold uppercase tracking-tighter text-foreground mb-2 flex items-center gap-3 flex-wrap">
          {isToken
            ? <Coins className="w-8 h-8 text-primary" />
            : <Code2 className="w-8 h-8 text-primary" />}
          {token.name || (isToken ? "Unknown Token" : "Contract")}
          {isToken && token.symbol && (
            <Pill className="bg-accent/10 text-accent border-accent/40 text-lg px-3 py-1">
              {token.symbol}
            </Pill>
          )}
          {!isToken && (
            <Pill className="bg-secondary text-muted-foreground border-border text-lg px-3 py-1">
              Contract
            </Pill>
          )}
          {/* Verified / unverified badge */}
          {token.abi && token.abi.length > 0 ? (
            <Pill className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs px-2 py-0.5">
              <ShieldCheck className="w-3 h-3" /> Verified
            </Pill>
          ) : (
            <Pill className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs px-2 py-0.5">
              <ShieldAlert className="w-3 h-3" /> Unverified
            </Pill>
          )}
        </h1>
        <p className="text-muted-foreground font-mono text-sm break-all">
          {token.address}
          <CopyButton text={token.address} />
        </p>
      </div>

      {/* Info card */}
      <Card className="border-border bg-card/80 rounded-sm overflow-hidden mb-6">
        <dl>
          <Row label="Address">
            <span className="text-primary font-bold break-all">{token.address}</span>
            <CopyButton text={token.address} />
          </Row>
          {token.bytecodeSize != null && (
            <Row label="Bytecode Size">
              <span className="font-bold">{token.bytecodeSize} bytes</span>
            </Row>
          )}
          {token.creator && (
            <Row label="Creator">
              <button
                onClick={() => setLocation(`/ledger?q=${token.creator}`)}
                className="text-primary hover:underline break-all text-left"
              >
                {token.creator}
              </button>
              <CopyButton text={token.creator!} />
            </Row>
          )}
          {token.creatorTx && (
            <Row label="Creator TX">
              <Link href={`/transactions/${token.creatorTx}`} className="text-primary hover:underline flex items-center gap-1 break-all">
                {formatHash(token.creatorTx, 8)}
                <ExternalLink className="w-3 h-3 shrink-0" />
              </Link>
            </Row>
          )}
          {token.createdAt && (
            <Row label="Created At">
              <span>{new Date(token.createdAt).toLocaleString()}</span>
            </Row>
          )}
          {isToken && token.decimals != null && (
            <Row label="Decimals">
              <span className="font-bold">{token.decimals}</span>
            </Row>
          )}
          {isToken && token.totalSupply != null && token.decimals != null && (
            <Row label="Total Supply">
              <span className="font-bold text-foreground">
                {formatTokenAmount(token.totalSupply, token.decimals, token.symbol ?? undefined)}
              </span>
            </Row>
          )}
          {isToken && token.holderCount != null && (
            <Row label="Holders">
              <span className="font-bold">{token.holderCount}</span>
            </Row>
          )}
        </dl>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue={isToken ? "holders" : "read"} className="w-full">
        <TabsList className="w-full rounded-sm border border-border bg-secondary/30 mb-4">
          {isToken && (
            <TabsTrigger value="holders" className="flex-1 rounded-sm text-[10px] font-sans font-bold uppercase tracking-widest">
              Holders
            </TabsTrigger>
          )}
          <TabsTrigger value="read" className="flex-1 rounded-sm text-[10px] font-sans font-bold uppercase tracking-widest">
            Read Contract
          </TabsTrigger>
          <TabsTrigger value="write" className="flex-1 rounded-sm text-[10px] font-sans font-bold uppercase tracking-widest">
            Write Contract
          </TabsTrigger>
        </TabsList>

        {/* Holders tab — ERC-20 only */}
        {isToken && (
          <TabsContent value="holders">
            <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
              {holders.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground font-sans font-bold uppercase tracking-widest text-sm">
                  No holders yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-secondary/50 border-b border-border font-sans uppercase tracking-widest text-muted-foreground text-[10px]">
                      <tr>
                        <th className="p-3 font-bold w-10">#</th>
                        <th className="p-3 font-bold">Address</th>
                        <th className="p-3 font-bold text-right">Balance</th>
                        <th className="p-3 font-bold text-right">% of Supply</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {holders.map((h, i) => {
                        const pct = totalSupplyBig > 0n
                          ? Number((BigInt(h.balance) * 10000n) / totalSupplyBig) / 100
                          : 0;
                        return (
                          <tr key={h.address} className="hover:bg-secondary/20 transition-colors">
                            <td className="p-3 font-mono text-muted-foreground text-xs">{i + 1}</td>
                            <td className="p-3 font-mono text-sm">
                              <button onClick={() => setLocation(`/ledger`)} className="text-primary hover:underline break-all text-left">
                                {h.address}
                              </button>
                            </td>
                            <td className="p-3 text-right font-mono text-sm font-bold text-foreground">
                              {formatTokenAmount(h.balance, token.decimals!, token.symbol ?? undefined)}
                            </td>
                            <td className="p-3 text-right font-mono text-sm text-muted-foreground">
                              {pct.toFixed(4)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </TabsContent>
        )}

        {/* Read Contract tab */}
        <TabsContent value="read">
          {token.abi && token.abi.length > 0 ? (
            <AbiPanel
              address={token.address}
              abi={token.abi.filter((f) => f.type === "function" && (f.stateMutability === "view" || f.stateMutability === "pure"))}
            />
          ) : (
            <VerifyPanel address={token.address} onVerified={loadContract} />
          )}
        </TabsContent>

        {/* Write Contract tab */}
        <TabsContent value="write">
          {token.abi && token.abi.length > 0 ? (
            <AbiPanel
              address={token.address}
              abi={token.abi.filter((f) => f.type === "function" && (f.stateMutability === "nonpayable" || f.stateMutability === "payable"))}
            />
          ) : (
            <VerifyPanel address={token.address} onVerified={loadContract} />
          )}
        </TabsContent>
      </Tabs>
    </Shell>
  );
}
