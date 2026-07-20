import React, { useEffect, useRef, useState } from "react";
import { Shell } from "@/components/layout/shell";
import {
  useGetWallet,
  useGetTransaction,
  useListTransactions,
  useListWallets,
} from "@workspace/api-client-react";
import type { Transaction, Wallet } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Search,
  X,
  Hash,
  Wallet as WalletIcon,
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  Loader2,
  FileCode2,
  Activity,
  ExternalLink,
  Copy,
  Database,
  AlertTriangle,
  Trophy,
  Medal,
  Coins,
  Code2,
  ChevronRight,
} from "lucide-react";
import { cn, formatEmbr, formatHash } from "@/lib/utils";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE    = /^0x[0-9a-fA-F]{64}$/;

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

interface AbiPanelProps {
  address: string;
  abi: Record<string, any>[];
}

function AbiPanel({ address, abi }: AbiPanelProps) {
  const { activeWallet } = useActiveWallet();

  const readFns = abi.filter(
    (f) => f.type === "function" && (f.stateMutability === "view" || f.stateMutability === "pure")
  );
  const writeFns = abi.filter(
    (f) => f.type === "function" && (f.stateMutability === "nonpayable" || f.stateMutability === "payable")
  );

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
            <div className="p-6 text-center text-muted-foreground font-sans text-sm uppercase font-bold tracking-widest">
              No read functions found
            </div>
          ) : (
            <Accordion type="multiple" className="divide-y divide-border/40">
              {readFns.map((fn, i) => (
                <ReadFunctionRow key={i} address={address} fn={fn} />
              ))}
            </Accordion>
          )}
        </Card>
      </TabsContent>

      <TabsContent value="write">
        <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
          {writeFns.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground font-sans text-sm uppercase font-bold tracking-widest">
              No write functions found
            </div>
          ) : (
            <Accordion type="multiple" className="divide-y divide-border/40">
              {writeFns.map((fn, i) => (
                <WriteFunctionRow key={i} address={address} fn={fn} activeWallet={activeWallet} />
              ))}
            </Accordion>
          )}
        </Card>
      </TabsContent>
    </Tabs>
  );
}

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
        body: JSON.stringify({
          functionName: fn.name,
          args: args.map(parseArg),
        }),
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
                onChange={(e) => {
                  const next = [...args];
                  next[i] = e.target.value;
                  setArgs(next);
                }}
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
        {isPayable && (
          <Pill className="ml-2 bg-yellow-500/10 text-yellow-400 border-yellow-500/30">payable</Pill>
        )}
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
                onChange={(e) => {
                  const next = [...args];
                  next[i] = e.target.value;
                  setArgs(next);
                }}
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
              <Link href={`/transactions/${txHash}`} className="hover:underline break-all">
                {txHash}
              </Link>
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

// ── transaction result ────────────────────────────────────────────────────────

function TransactionResult({ hash, onAddressClick }: { hash: string; onAddressClick: (a: string) => void }) {
  const { data: tx, isLoading, isError } = useGetTransaction(hash, {
    query: {
      retry: false,
      refetchInterval: (q) => (q.state.data as Transaction | undefined)?.status === "pending" ? 2000 : false,
    },
  });

  if (isLoading) return <LoadingCard label="Scanning for transaction…" />;
  if (isError || !tx) return <NotFoundCard label="Transaction not found" sub="Double-check the hash and try again." />;

  const statusPill =
    tx.status === "success" ? <Pill className="bg-primary/10 text-primary border-primary/40"><CheckCircle2 className="w-3 h-3" /> Success</Pill>
    : tx.status === "pending" ? <Pill className="bg-accent/10 text-accent border-accent/40"><Loader2 className="w-3 h-3 animate-spin" /> Pending</Pill>
    : <Pill className="bg-destructive/10 text-destructive border-destructive/40"><XCircle className="w-3 h-3" /> Failed</Pill>;

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground font-sans font-bold uppercase tracking-widest">
          <ArrowLeftRight className="w-4 h-4 text-primary" /> Transaction
        </div>
        <div className="flex items-center gap-2">
          {statusPill}
          <Link href={`/transactions/${tx.hash}`}>
            <Button variant="outline" size="sm" className="h-7 text-[10px] rounded-sm gap-1 border-border font-bold uppercase tracking-widest">
              <ExternalLink className="w-3 h-3" /> Full page
            </Button>
          </Link>
        </div>
      </div>

      <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
        <dl>
          <Row label="TX Hash">
            <span className="text-primary font-bold break-all">{tx.hash}</span>
            <CopyButton text={tx.hash} />
          </Row>
          <Row label="Block">
            {tx.blockNumber
              ? <Link href={`/blocks/${tx.blockNumber}`} className="text-primary hover:underline font-bold">#{tx.blockNumber}</Link>
              : <span className="text-muted-foreground italic">Pending in mempool…</span>}
          </Row>
          <Row label="Submitted">
            <span>{new Date(tx.createdAt).toLocaleString()}</span>
          </Row>
          <Row label="From">
            <button onClick={() => onAddressClick(tx.from)} className="text-primary hover:underline break-all text-left">
              {tx.from}
            </button>
            <CopyButton text={tx.from} />
          </Row>
          <Row label="To">
            {tx.to
              ? <><button onClick={() => onAddressClick(tx.to!)} className="text-primary hover:underline break-all text-left">{tx.to}</button><CopyButton text={tx.to} /></>
              : <Pill className="bg-accent/10 text-accent border-accent/40"><FileCode2 className="w-3 h-3" /> Contract Creation</Pill>}
          </Row>
          <Row label="Value">
            <span className="text-glow font-bold text-lg">{formatEmbr(tx.value)} EMBR</span>
          </Row>
          <Row label="Gas Limit">
            {parseInt(tx.gasLimit).toLocaleString()}
          </Row>
          {tx.gasUsed && <Row label="Gas Used">{parseInt(tx.gasUsed).toLocaleString()}</Row>}
          <Row label="Nonce">{tx.nonce}</Row>
          {tx.contractAddress && (
            <Row label="Contract Created">
              <button onClick={() => onAddressClick(tx.contractAddress!)} className="text-accent hover:underline break-all font-bold text-left">
                {tx.contractAddress}
              </button>
            </Row>
          )}
        </dl>
      </Card>

      {tx.data && tx.data !== "0x" && (
        <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-secondary/30 text-xs font-sans font-bold uppercase tracking-widest text-muted-foreground">
            Input Data
          </div>
          <div className="p-4 bg-black font-mono text-xs text-muted-foreground break-all max-h-40 overflow-y-auto">
            {tx.data}
          </div>
        </Card>
      )}

      {tx.error && (
        <Card className="border-destructive/40 bg-destructive/5 rounded-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-destructive/20 bg-destructive/10 text-xs font-sans font-bold uppercase tracking-widest text-destructive flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> Revert Reason
          </div>
          <div className="p-4 font-mono text-sm text-destructive">{tx.error}</div>
        </Card>
      )}
    </div>
  );
}

// ── address result ────────────────────────────────────────────────────────────

interface ContractInfo {
  address: string;
  isContract: boolean;
  bytecodeSize?: number;
  abi?: Record<string, any>[] | null;
  name?: string | null;
  symbol?: string | null;
  decimals?: number | null;
  totalSupply?: string | null;
  isToken: boolean;
  creator?: string | null;
  creatorTx?: string | null;
  createdAt?: string | null;
}

interface TokenHolding {
  contractAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: string;
}

function AddressResult({ address, onAddressClick }: { address: string; onAddressClick: (a: string) => void }) {
  const { activeWallet } = useActiveWallet();
  const isMe = activeWallet?.address.toLowerCase() === address.toLowerCase();

  const { data: wallet, isLoading: walletLoading, isError: walletError } = useGetWallet(address, {
    query: { retry: false, refetchInterval: 5000 },
  });

  const { data: txs, isLoading: txsLoading } = useListTransactions(
    { address, limit: 100 },
    { query: { refetchInterval: 8000 } },
  );

  // Contract info
  const [contractInfo, setContractInfo] = useState<ContractInfo | null>(null);
  const [contractLoading, setContractLoading] = useState(false);

  // Token holdings
  const [tokenHoldings, setTokenHoldings] = useState<TokenHolding[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);

  // Register ABI
  const [abiInput, setAbiInput] = useState("");
  const [abiRegisterLoading, setAbiRegisterLoading] = useState(false);
  const [abiRegisterError, setAbiRegisterError] = useState<string | null>(null);
  const [abiRegisterSuccess, setAbiRegisterSuccess] = useState(false);

  useEffect(() => {
    if (!address) return;
    setContractInfo(null);
    setContractLoading(true);
    fetch(`/api/contracts/${address}`)
      .then((r) => r.json())
      .then((data) => setContractInfo(data))
      .catch(() => {})
      .finally(() => setContractLoading(false));
  }, [address]);

  useEffect(() => {
    if (!address) return;
    setTokenHoldings([]);
    setHoldingsLoading(true);
    fetch(`/api/wallets/${address}/tokens`)
      .then((r) => r.json())
      .then((data) => setTokenHoldings(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setHoldingsLoading(false));
  }, [address]);

  const handleRegisterAbi = async () => {
    setAbiRegisterLoading(true);
    setAbiRegisterError(null);
    setAbiRegisterSuccess(false);
    try {
      const parsed = JSON.parse(abiInput);
      const res = await fetch(`/api/contracts/${address}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ abi: parsed }),
      });
      const data = await res.json();
      if (data.success) {
        setAbiRegisterSuccess(true);
        // Refresh contract info
        const updated = await fetch(`/api/contracts/${address}`).then((r) => r.json());
        setContractInfo(updated);
      } else {
        setAbiRegisterError(data.error || "Failed to register ABI");
      }
    } catch (e: any) {
      setAbiRegisterError(e.message || "Invalid JSON");
    } finally {
      setAbiRegisterLoading(false);
    }
  };

  if (walletLoading) return <LoadingCard label="Loading account…" />;
  if (walletError || !wallet) return <NotFoundCard label="Address not found" sub="No account exists at this address yet." />;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Account card */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground font-sans font-bold uppercase tracking-widest">
          <WalletIcon className="w-4 h-4 text-primary" /> Account
          {isMe && <Pill className="bg-primary/10 text-primary border-primary/40">Your wallet</Pill>}
          {contractInfo?.isContract && (
            <Pill className="bg-accent/10 text-accent border-accent/40">
              <FileCode2 className="w-3 h-3" /> Smart Contract
            </Pill>
          )}
        </div>
        <CopyButton text={address} />
      </div>

      <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
        <dl>
          <Row label="Address">
            <span className="text-primary font-bold break-all">{address}</span>
          </Row>
          <Row label="Balance">
            <span className="text-glow font-bold text-2xl">{formatEmbr(wallet.balance)}</span>
            <span className="ml-2 text-muted-foreground font-sans text-xs uppercase tracking-widest font-bold">EMBR</span>
          </Row>
          <Row label="Nonce">
            <span className="font-bold">{wallet.nonce}</span>
            <span className="ml-2 text-muted-foreground font-sans text-[10px] uppercase tracking-widest">txs sent</span>
          </Row>
          <Row label="Total Transactions">
            <span className="font-bold">{txs?.length ?? "—"}</span>
          </Row>
          {contractInfo?.isContract && contractInfo.bytecodeSize != null && (
            <Row label="Bytecode Size">
              <span className="font-bold">{contractInfo.bytecodeSize.toLocaleString()}</span>
              <span className="ml-2 text-muted-foreground font-sans text-[10px] uppercase tracking-widest">bytes</span>
            </Row>
          )}
        </dl>
      </Card>

      {/* Token info card */}
      {contractInfo?.isContract && contractInfo.isToken && (
        <div>
          <div className="flex items-center gap-2 mb-3 text-xs font-sans font-bold uppercase tracking-widest text-muted-foreground">
            <Coins className="w-3.5 h-3.5 text-accent" /> Token Info
          </div>
          <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
            <dl>
              {contractInfo.name && (
                <Row label="Token Name">
                  <span className="font-bold text-foreground">{contractInfo.name}</span>
                </Row>
              )}
              {contractInfo.symbol && (
                <Row label="Symbol">
                  <Pill className="bg-accent/10 text-accent border-accent/40">{contractInfo.symbol}</Pill>
                </Row>
              )}
              {contractInfo.decimals != null && (
                <Row label="Decimals">
                  <span className="font-bold">{contractInfo.decimals}</span>
                </Row>
              )}
              {contractInfo.totalSupply != null && contractInfo.decimals != null && (
                <Row label="Total Supply">
                  <span className="font-bold text-foreground">
                    {formatTokenAmount(contractInfo.totalSupply, contractInfo.decimals, contractInfo.symbol ?? undefined)}
                  </span>
                </Row>
              )}
              {contractInfo.creator && (
                <Row label="Creator">
                  <button
                    onClick={() => onAddressClick(contractInfo.creator!)}
                    className="text-primary hover:underline break-all text-left"
                  >
                    {contractInfo.creator}
                  </button>
                </Row>
              )}
              {contractInfo.createdAt && (
                <Row label="Created At">
                  <span>{new Date(contractInfo.createdAt).toLocaleString()}</span>
                </Row>
              )}
            </dl>
          </Card>
        </div>
      )}

      {/* Token Holdings */}
      {(holdingsLoading || tokenHoldings.length > 0) && (
        <div>
          <div className="flex items-center gap-2 mb-3 text-xs font-sans font-bold uppercase tracking-widest text-muted-foreground">
            <Coins className="w-3.5 h-3.5" /> Token Holdings
            {holdingsLoading && <Loader2 className="w-3 h-3 animate-spin" />}
          </div>
          {tokenHoldings.length > 0 && (
            <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-secondary/50 border-b border-border font-sans uppercase tracking-widest text-muted-foreground">
                    <tr>
                      <th className="p-3 font-bold">Token Name</th>
                      <th className="p-3 font-bold">Symbol</th>
                      <th className="p-3 font-bold text-right">Balance</th>
                      <th className="p-3 font-bold">Contract Address</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {tokenHoldings.map((t) => (
                      <tr key={t.contractAddress} className="hover:bg-secondary/20 transition-colors">
                        <td className="p-3 font-bold text-foreground">{t.name}</td>
                        <td className="p-3">
                          <Pill className="bg-accent/10 text-accent border-accent/40">{t.symbol}</Pill>
                        </td>
                        <td className="p-3 text-right font-bold text-foreground">
                          {formatTokenAmount(t.balance, t.decimals, t.symbol)}
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => onAddressClick(t.contractAddress)}
                            className="text-primary hover:underline break-all text-left"
                          >
                            {formatHash(t.contractAddress, 6)}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ABI Panel */}
      {contractInfo?.isContract && (
        <div>
          <div className="flex items-center gap-2 mb-3 text-xs font-sans font-bold uppercase tracking-widest text-muted-foreground">
            <Code2 className="w-3.5 h-3.5" /> Contract Interaction
          </div>
          {contractInfo.abi && contractInfo.abi.length > 0 ? (
            <AbiPanel address={address} abi={contractInfo.abi} />
          ) : (
            <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-secondary/30 text-xs font-sans font-bold uppercase tracking-widest text-muted-foreground">
                Register ABI
              </div>
              <div className="p-4 space-y-3">
                <p className="text-xs text-muted-foreground font-sans">
                  No ABI registered for this contract. Paste the JSON ABI below to enable contract interaction.
                </p>
                <Textarea
                  value={abiInput}
                  onChange={(e) => setAbiInput(e.target.value)}
                  placeholder='[{"type":"function","name":"balanceOf",...}]'
                  className="font-mono text-xs min-h-[100px] rounded-sm border-border bg-black/30"
                />
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    onClick={handleRegisterAbi}
                    disabled={abiRegisterLoading || !abiInput.trim()}
                    className="h-7 text-[10px] font-sans font-bold uppercase tracking-widest rounded-sm"
                  >
                    {abiRegisterLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                    Register ABI
                  </Button>
                  {abiRegisterSuccess && (
                    <span className="text-primary text-xs font-sans font-bold uppercase tracking-widest flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Registered!
                    </span>
                  )}
                  {abiRegisterError && (
                    <span className="text-destructive text-xs font-mono flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {abiRegisterError}
                    </span>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* TX history */}
      <div>
        <div className="flex items-center gap-2 mb-3 text-xs font-sans font-bold uppercase tracking-widest text-muted-foreground">
          <Database className="w-3.5 h-3.5" /> Transaction History
          {txsLoading && <Loader2 className="w-3 h-3 animate-spin" />}
          {txs && <span className="text-foreground">{txs.length} found</span>}
        </div>

        <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
          {!txsLoading && (!txs || txs.length === 0) ? (
            <div className="p-8 text-center text-muted-foreground font-sans uppercase font-bold tracking-widest text-sm">
              No transactions found for this address.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-secondary/50 border-b border-border font-sans uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="p-3 font-bold">Status</th>
                    <th className="p-3 font-bold">Hash</th>
                    <th className="p-3 font-bold">Type</th>
                    <th className="p-3 font-bold">From</th>
                    <th className="p-3 font-bold">To</th>
                    <th className="p-3 font-bold text-right">Amount</th>
                    <th className="p-3 font-bold text-right">Block</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {txsLoading && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-muted-foreground font-sans uppercase font-bold tracking-widest">
                        Loading…
                      </td>
                    </tr>
                  )}
                  {txs?.map((tx) => {
                    const isFrom = tx.from.toLowerCase() === address.toLowerCase();
                    const isTo   = tx.to?.toLowerCase() === address.toLowerCase();
                    return (
                      <tr key={tx.hash} className="hover:bg-secondary/20 transition-colors group">
                        <td className="p-3">
                          {tx.status === "success" && <CheckCircle2 className="w-4 h-4 text-primary" />}
                          {tx.status === "pending" && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
                          {tx.status === "failed"  && <XCircle  className="w-4 h-4 text-destructive" />}
                        </td>
                        <td className="p-3">
                          <Link href={`/transactions/${tx.hash}`} className="text-primary hover:underline font-bold" title={tx.hash}>
                            {formatHash(tx.hash, 5)}
                          </Link>
                        </td>
                        <td className="p-3">
                          {tx.to === null
                            ? <span className="text-accent flex items-center gap-1 font-sans text-[10px] uppercase font-bold tracking-widest"><FileCode2 className="w-3 h-3" /> Deploy</span>
                            : <span className={cn("flex items-center gap-1 font-sans text-[10px] uppercase font-bold tracking-widest", isFrom && !isTo ? "text-orange-400" : isTo && !isFrom ? "text-green-400" : "text-muted-foreground")}>
                                <Activity className="w-3 h-3" />
                                {isFrom && !isTo ? "OUT" : isTo && !isFrom ? "IN" : "SELF"}
                              </span>}
                        </td>
                        <td className="p-3">
                          {isFrom
                            ? <span className="text-primary font-bold">This address</span>
                            : <button onClick={() => onAddressClick(tx.from)} className="text-muted-foreground hover:text-primary transition-colors" title={tx.from}>{formatHash(tx.from, 5)}</button>}
                        </td>
                        <td className="p-3">
                          {tx.to === null
                            ? <span className="italic text-muted-foreground/50">Contract</span>
                            : isTo
                            ? <span className="text-primary font-bold">This address</span>
                            : <button onClick={() => onAddressClick(tx.to!)} className="text-muted-foreground hover:text-primary transition-colors" title={tx.to!}>{formatHash(tx.to!, 5)}</button>}
                        </td>
                        <td className={cn("p-3 text-right font-bold", isFrom && !isTo ? "text-orange-400" : isTo && !isFrom ? "text-green-400" : "text-foreground")}>
                          {isFrom && !isTo ? "−" : isTo && !isFrom ? "+" : ""}{formatEmbr(tx.value)}
                        </td>
                        <td className="p-3 text-right text-muted-foreground">
                          {tx.blockNumber
                            ? <Link href={`/blocks/${tx.blockNumber}`} className="hover:text-primary transition-colors">#{tx.blockNumber}</Link>
                            : <span className="italic opacity-50">pending</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── small helpers ─────────────────────────────────────────────────────────────

function LoadingCard({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 p-6 border border-border rounded-sm bg-card/50 text-muted-foreground font-sans font-bold uppercase tracking-widest text-sm animate-pulse">
      <Loader2 className="w-4 h-4 animate-spin" /> {label}
    </div>
  );
}

function NotFoundCard({ label, sub }: { label: string; sub: string }) {
  return (
    <Card className="p-8 border-border bg-card/50 rounded-sm text-center">
      <div className="text-foreground font-sans font-bold uppercase tracking-widest mb-2">{label}</div>
      <div className="text-muted-foreground font-sans text-sm">{sub}</div>
    </Card>
  );
}

// ── top holders ───────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-sm bg-yellow-500/20 border border-yellow-500/50 text-yellow-400">
      <Trophy className="w-3.5 h-3.5" />
    </span>
  );
  if (rank === 2) return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-sm bg-slate-400/20 border border-slate-400/40 text-slate-300">
      <Medal className="w-3.5 h-3.5" />
    </span>
  );
  if (rank === 3) return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-sm bg-orange-700/20 border border-orange-700/40 text-orange-400">
      <Medal className="w-3.5 h-3.5" />
    </span>
  );
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-sm bg-secondary/50 border border-border text-muted-foreground font-mono text-xs font-bold">
      {rank}
    </span>
  );
}

function TopHolders({ onAddressClick }: { onAddressClick: (a: string) => void }) {
  const { activeWallet } = useActiveWallet();
  const { data: wallets, isLoading } = useListWallets({
    query: { refetchInterval: 15000 },
  });

  const sorted = wallets
    ? [...wallets]
        .filter((w) => BigInt(w.balance) > 0n)
        .sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1))
    : [];

  const totalSupply = wallets
    ? wallets.reduce((sum, w) => sum + BigInt(w.balance), 0n)
    : 0n;

  return (
    <div className="mt-8">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="w-4 h-4 text-yellow-400" />
        <span className="font-sans font-bold uppercase tracking-widest text-sm text-foreground">
          Top Holders
        </span>
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        {sorted.length > 0 && (
          <span className="ml-auto text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground">
            {sorted.length} accounts with balance
          </span>
        )}
      </div>

      <Card className="border-border bg-card/80 rounded-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground font-sans font-bold uppercase tracking-widest text-sm animate-pulse flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading holders…
          </div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground font-sans font-bold uppercase tracking-widest text-sm">
            No accounts with a balance yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-secondary/50 border-b border-border font-sans uppercase tracking-widest text-muted-foreground text-[10px]">
                <tr>
                  <th className="p-3 font-bold w-10">#</th>
                  <th className="p-3 font-bold">Address</th>
                  <th className="p-3 font-bold text-right">Balance</th>
                  <th className="p-3 font-bold text-right hidden sm:table-cell">Share</th>
                  <th className="p-3 font-bold text-right hidden md:table-cell">Txs Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {sorted.map((w, i) => {
                  const rank = i + 1;
                  const isMe = activeWallet?.address.toLowerCase() === w.address.toLowerCase();
                  const pct = totalSupply > 0n
                    ? Number((BigInt(w.balance) * 10000n) / totalSupply) / 100
                    : 0;
                  const barWidth = Math.max(pct, 0.5);

                  return (
                    <tr
                      key={w.address}
                      className={cn(
                        "hover:bg-secondary/20 transition-colors group",
                        isMe && "bg-primary/5",
                      )}
                    >
                      {/* Rank */}
                      <td className="p-3">
                        <RankBadge rank={rank} />
                      </td>

                      {/* Address */}
                      <td className="p-3 font-mono text-sm">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => onAddressClick(w.address)}
                            className="text-primary hover:underline font-bold"
                            title={w.address}
                          >
                            <span className="hidden sm:inline">{w.address}</span>
                            <span className="sm:hidden">{w.address.slice(0, 10)}…{w.address.slice(-6)}</span>
                          </button>
                          {isMe && (
                            <Pill className="bg-primary/10 text-primary border-primary/40">
                              You
                            </Pill>
                          )}
                        </div>
                      </td>

                      {/* Balance + bar */}
                      <td className="p-3 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className={cn("font-mono font-bold text-sm", rank === 1 && "text-yellow-400")}>
                            {formatEmbr(w.balance)}
                          </span>
                          <span className="text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground">EMBR</span>
                          {/* mini bar */}
                          <div className="w-24 h-1 bg-secondary rounded-full overflow-hidden hidden sm:block">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                rank === 1 ? "bg-yellow-400" : rank === 2 ? "bg-slate-400" : rank === 3 ? "bg-orange-500" : "bg-primary/60",
                              )}
                              style={{ width: `${Math.min(barWidth, 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Share % */}
                      <td className="p-3 text-right hidden sm:table-cell">
                        <span className="font-mono text-sm text-muted-foreground font-bold">
                          {pct.toFixed(2)}%
                        </span>
                      </td>

                      {/* Nonce / txs sent */}
                      <td className="p-3 text-right hidden md:table-cell">
                        <span className="font-mono text-sm text-muted-foreground">
                          {w.nonce}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function Ledger() {
  const { activeWallet } = useActiveWallet();
  const [query, setQuery]     = useState("");
  const [committed, setCommitted] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed    = query.trim();
  const isAddress  = ADDRESS_RE.test(committed);
  const isHash     = HASH_RE.test(committed);
  const hasResult  = isAddress || isHash;

  // Commit search (debounce-free — only on Enter or when pattern fully matches)
  useEffect(() => {
    const t = trimmed;
    if (ADDRESS_RE.test(t) || HASH_RE.test(t)) {
      setCommitted(t);
    } else if (t === "") {
      setCommitted("");
    }
  }, [trimmed]);

  const handleClear = () => { setQuery(""); setCommitted(""); inputRef.current?.focus(); };
  const handleAddressClick = (addr: string) => { setQuery(addr); setCommitted(addr); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return (
    <Shell requireWallet={false}>
      {/* Header */}
      <div className="border-b border-border pb-6 mb-8">
        <h1 className="text-4xl font-display font-bold uppercase tracking-tighter text-foreground mb-2 flex items-center gap-3">
          <Search className="w-8 h-8 text-primary" /> Ledger Explorer
        </h1>
        <p className="text-muted-foreground font-sans text-sm uppercase tracking-widest font-bold">
          Look up any transaction or account on the Emberchain network
        </p>
      </div>

      {/* Search input */}
      <div className="mb-8">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Paste a transaction hash (0x…64 chars) or wallet address (0x…40 chars)"
            className={cn(
              "pl-12 pr-12 h-14 text-base rounded-sm border font-mono transition-colors",
              "placeholder:font-sans placeholder:text-xs placeholder:uppercase placeholder:tracking-widest placeholder:text-muted-foreground",
              "focus-visible:ring-primary/50",
              committed && "border-primary/40 bg-primary/5",
            )}
            onKeyDown={(e) => { if (e.key === "Enter" && trimmed) setCommitted(trimmed); }}
          />
          {trimmed && (
            <button onClick={handleClear} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Chips */}
        <div className="flex flex-wrap gap-2 mt-3 min-h-[28px]">
          {/* Query type indicator */}
          {trimmed && !isAddress && !isHash && trimmed.length > 2 && (
            <span className="text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground border border-border rounded-sm px-2 py-1">
              {trimmed.startsWith("0x")
                ? `${trimmed.length < 42 ? "address too short" : trimmed.length < 66 ? "hash too short" : "invalid format"}`
                : "must start with 0x"}
            </span>
          )}
          {committed && isAddress && (
            <Pill className="bg-primary/10 text-primary border-primary/40"><WalletIcon className="w-3 h-3" /> Searching account</Pill>
          )}
          {committed && isHash && (
            <Pill className="bg-accent/10 text-accent border-accent/40"><Hash className="w-3 h-3" /> Searching transaction</Pill>
          )}

          {/* My wallet shortcut */}
          {activeWallet && !trimmed && (
            <button
              onClick={() => { setQuery(activeWallet.address); setCommitted(activeWallet.address); }}
              className="text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground border border-border rounded-sm px-2 py-1 hover:border-primary/50 hover:text-primary transition-colors flex items-center gap-1"
            >
              <WalletIcon className="w-3 h-3" /> My account
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {hasResult ? (
        isAddress
          ? <AddressResult address={committed} onAddressClick={handleAddressClick} />
          : <TransactionResult hash={committed} onAddressClick={handleAddressClick} />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-border rounded-sm p-6 bg-card/30">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-sm bg-accent/10 border border-accent/30 flex items-center justify-center">
                  <Hash className="w-4 h-4 text-accent" />
                </div>
                <span className="font-sans font-bold uppercase tracking-widest text-sm">Transaction Hash</span>
              </div>
              <p className="text-muted-foreground font-sans text-sm leading-relaxed">
                Paste a 66-character hex string starting with <code className="text-accent font-mono text-xs">0x</code> to view status, sender, recipient, value, gas, and any revert reason.
              </p>
              <div className="mt-3 font-mono text-xs text-muted-foreground/60 break-all">
                0x4f2a…b7c3
              </div>
            </div>
            <div className="border border-border rounded-sm p-6 bg-card/30">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-sm bg-primary/10 border border-primary/30 flex items-center justify-center">
                  <WalletIcon className="w-4 h-4 text-primary" />
                </div>
                <span className="font-sans font-bold uppercase tracking-widest text-sm">Wallet Address</span>
              </div>
              <p className="text-muted-foreground font-sans text-sm leading-relaxed">
                Paste a 42-character hex address to see live balance, account age, and full transaction history — with IN / OUT flow labelling.
              </p>
              <div className="mt-3 font-mono text-xs text-muted-foreground/60 break-all">
                0x1a2b…c3d4
              </div>
            </div>
          </div>
          <TopHolders onAddressClick={handleAddressClick} />
        </>
      )}
    </Shell>
  );
}
