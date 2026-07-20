import { useState } from "react";
import { Shell } from "@/components/layout/shell";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useGetWallet } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Shield, Lock, Unlock, Send, AlertCircle, CheckCircle2,
  EyeOff, Info, ChevronDown, ChevronUp, RefreshCw,
} from "lucide-react";
import { formatEmbr } from "@/lib/utils";
import { cn } from "@/lib/utils";

// Direct API calls (not using orval query hooks) so we can pass private key in POST body
async function apiPost(path: string, body: object): Promise<unknown> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return json;
}

interface PrivateNoteInfo {
  id: string;
  amount: string;
  status: "unspent" | "spent";
  source: "shield" | "private-send";
  createdAt: string;
}

interface PrivateBalance {
  address: string;
  balance: string;
  notes: PrivateNoteInfo[];
}

type TabId = "balance" | "shield" | "send" | "unshield" | "ledger";

interface ShieldedTxRecord {
  id: string;
  type: "shield" | "private-send" | "unshield";
  createdAt: string;
  publicAddress: string | null;
  publicAmount: string | null;
  fee: string;
  noteIdsCreated: string[];
  noteIdsSpent: string[];
}

export default function PrivacyPage() {
  const { activeWallet } = useActiveWallet();
  const [activeTab, setActiveTab] = useState<TabId>("balance");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [privBalance, setPrivBalance] = useState<PrivateBalance | null>(null);
  const [ledger, setLedger] = useState<ShieldedTxRecord[] | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  // Shield form
  const [shieldAmount, setShieldAmount] = useState("");
  const [shieldTo, setShieldTo] = useState("");

  // Private send form
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendFee, setSendFee] = useState("");

  // Unshield form
  const [unshieldTo, setUnshieldTo] = useState("");
  const [unshieldAmount, setUnshieldAmount] = useState("");

  const { data: pubWallet, refetch: refetchPub } = useGetWallet(activeWallet?.address || "", {
    query: { enabled: !!activeWallet?.address, refetchInterval: 5000 }
  });

  function reset() {
    setError(null);
    setSuccess(null);
  }

  async function fetchPrivateBalance() {
    if (!activeWallet) return;
    setLoading(true);
    reset();
    try {
      const result = await apiPost("/privacy/balance", { privateKey: activeWallet.privateKey }) as PrivateBalance;
      setPrivBalance(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch private balance");
    } finally {
      setLoading(false);
    }
  }

  async function fetchLedger() {
    setLoading(true);
    reset();
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${base}/api/privacy/transactions?limit=50`);
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
      setLedger(json as ShieldedTxRecord[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch ledger");
    } finally {
      setLoading(false);
    }
  }

  async function handleShield(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWallet) return;
    setLoading(true);
    reset();
    try {
      const amountInEmb = BigInt(Math.floor(parseFloat(shieldAmount) * 1e18)).toString();
      await apiPost("/privacy/shield", {
        fromPrivateKey: activeWallet.privateKey,
        amount: amountInEmb,
        toAddress: shieldTo.trim() || null,
      });
      setSuccess(`Successfully shielded ${shieldAmount} EMBR into the private pool.`);
      setShieldAmount("");
      setShieldTo("");
      refetchPub();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Shield failed");
    } finally {
      setLoading(false);
    }
  }

  async function handlePrivateSend(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWallet) return;
    setLoading(true);
    reset();
    try {
      const amountInEmb = BigInt(Math.floor(parseFloat(sendAmount) * 1e18)).toString();
      const feeInEmb = sendFee.trim() ? BigInt(Math.floor(parseFloat(sendFee) * 1e18)).toString() : undefined;
      await apiPost("/privacy/send", {
        fromPrivateKey: activeWallet.privateKey,
        toAddress: sendTo.trim(),
        amount: amountInEmb,
        fee: feeInEmb,
      });
      setSuccess("Private transaction sent. Sender, recipient, and amount are hidden on-chain.");
      setSendTo("");
      setSendAmount("");
      setSendFee("");
      fetchPrivateBalance();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Private send failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnshield(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWallet) return;
    setLoading(true);
    reset();
    try {
      const amountInEmb = BigInt(Math.floor(parseFloat(unshieldAmount) * 1e18)).toString();
      await apiPost("/privacy/unshield", {
        fromPrivateKey: activeWallet.privateKey,
        toAddress: unshieldTo.trim() || activeWallet.address,
        amount: amountInEmb,
      });
      setSuccess(`Unshielded ${unshieldAmount} EMBR to public address. Destination and amount are visible on-chain.`);
      setUnshieldAmount("");
      setUnshieldTo("");
      refetchPub();
      fetchPrivateBalance();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unshield failed");
    } finally {
      setLoading(false);
    }
  }

  const tabs: { id: TabId; label: string; icon: typeof Shield }[] = [
    { id: "balance", label: "Private Balance", icon: EyeOff },
    { id: "shield", label: "Shield", icon: Shield },
    { id: "send", label: "Private Send", icon: Lock },
    { id: "unshield", label: "Unshield", icon: Unlock },
    { id: "ledger", label: "Ledger", icon: Send },
  ];

  return (
    <Shell>
      <div className="max-w-3xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-4xl font-display font-bold uppercase tracking-tighter text-foreground mb-2 flex items-center gap-3">
            <Shield className="w-8 h-8 text-primary" /> Privacy Pool
          </h1>
          <p className="text-muted-foreground font-sans text-sm uppercase tracking-widest font-bold">
            Shielded transactions — sender, recipient &amp; amount hidden on-chain.
          </p>
        </div>

        {/* Privacy model notice */}
        <Card className="border-primary/20 bg-primary/5 p-4 mb-6 rounded-sm">
          <div className="flex gap-3 items-start">
            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Privacy model:</strong> Private sends use ring signatures (LSAG) to hide which note was spent, and Pedersen commitments to hide amounts. The public/private boundary (shield &amp; unshield) does reveal the address and amount — same as Zcash's transparent↔shielded design.{" "}
              <strong className="text-foreground">Known limitation:</strong> no zero-knowledge range proofs (Bulletproofs) — amounts are verified by a server-side plaintext bounds check, not a trustless cryptographic proof. This chain uses the same server-side key-handling trust model as regular public transactions.
            </div>
          </div>
        </Card>

        {/* Balance summary bar */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-secondary/30 border border-border p-4 rounded-sm">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Public Balance</div>
            <div className="font-mono text-xl text-foreground">{pubWallet ? formatEmbr(pubWallet.balance) : "—"} <span className="text-sm text-muted-foreground">EMBR</span></div>
          </div>
          <div className="bg-primary/5 border border-primary/20 p-4 rounded-sm">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center gap-1">
              <EyeOff className="w-3 h-3" /> Private Balance
            </div>
            <div className="font-mono text-xl text-primary">
              {privBalance ? formatEmbr(privBalance.balance) : "—"} <span className="text-sm text-muted-foreground">EMBR</span>
            </div>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 mb-6 flex-wrap">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                setActiveTab(id);
                reset();
                if (id === "balance") fetchPrivateBalance();
                if (id === "ledger") fetchLedger();
              }}
              className={cn(
                "flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-sm border transition-all",
                activeTab === id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Error / success */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/50 p-4 rounded-sm flex gap-3 items-start text-destructive mb-4">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="text-sm font-mono break-all">{error}</div>
          </div>
        )}
        {success && (
          <div className="bg-primary/10 border border-primary/30 p-4 rounded-sm flex gap-3 items-start text-primary mb-4">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="text-sm">{success}</div>
          </div>
        )}

        {/* Tab content */}

        {/* ── Balance tab ── */}
        {activeTab === "balance" && (
          <Card className="border-border rounded-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold uppercase tracking-wider text-sm">Your Private Notes</h2>
              <Button variant="outline" size="sm" className="rounded-sm text-xs uppercase font-bold gap-1"
                onClick={fetchPrivateBalance} disabled={loading}>
                <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Scan
              </Button>
            </div>

            {!privBalance && (
              <p className="text-muted-foreground text-sm py-8 text-center">
                Press <strong>Scan</strong> to search the pool for notes owned by this wallet.
              </p>
            )}

            {privBalance && (
              <>
                <div className="bg-primary/5 border border-primary/20 p-4 rounded-sm mb-4 flex justify-between items-center">
                  <span className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Total Private Balance</span>
                  <span className="font-mono text-2xl text-primary">{formatEmbr(privBalance.balance)} EMBR</span>
                </div>

                <button
                  onClick={() => setShowNotes(!showNotes)}
                  className="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground hover:text-foreground transition-colors mb-2"
                >
                  {showNotes ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {privBalance.notes.length} note{privBalance.notes.length !== 1 ? "s" : ""} found
                </button>

                {showNotes && (
                  <div className="space-y-2">
                    {privBalance.notes.length === 0 && (
                      <p className="text-muted-foreground text-sm py-4 text-center">No notes found for this wallet.</p>
                    )}
                    {privBalance.notes.map((note) => (
                      <div key={note.id}
                        className={cn(
                          "p-3 border rounded-sm text-xs",
                          note.status === "unspent" ? "border-primary/20 bg-primary/5" : "border-border bg-secondary/20 opacity-60"
                        )}>
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <span className={cn("font-bold uppercase", note.status === "unspent" ? "text-primary" : "text-muted-foreground")}>
                              {note.status}
                            </span>
                            <span className="text-muted-foreground ml-2">via {note.source}</span>
                          </div>
                          <span className="font-mono font-bold">{formatEmbr(note.amount)} EMBR</span>
                        </div>
                        <div className="font-mono text-muted-foreground mt-1 truncate">{note.id}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>
        )}

        {/* ── Shield tab ── */}
        {activeTab === "shield" && (
          <Card className="border-border rounded-sm p-6">
            <h2 className="font-bold uppercase tracking-wider text-sm mb-1">Shield Public EMBR</h2>
            <p className="text-xs text-muted-foreground mb-6">
              Moves EMBR from your public balance into the shielded pool as a hidden note.
              The source address and amount are visible at this boundary.
            </p>
            <form onSubmit={handleShield} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">Amount (EMBR)</label>
                <div className="relative">
                  <Input type="number" step="any" placeholder="0.00" value={shieldAmount} onChange={e => setShieldAmount(e.target.value)}
                    className="font-mono bg-input border-border rounded-sm h-12 pr-16" required />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-xs uppercase">EMBR</div>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">
                  Recipient Address <span className="font-normal normal-case text-muted-foreground">(optional — defaults to your own address)</span>
                </label>
                <Input placeholder={activeWallet?.address || "0x..."} value={shieldTo} onChange={e => setShieldTo(e.target.value)}
                  className="font-mono bg-input border-border rounded-sm h-12" />
              </div>
              <Button type="submit" disabled={loading || !shieldAmount} className="w-full h-12 rounded-sm font-bold uppercase tracking-wider gap-2">
                <Shield className="w-4 h-4" />
                {loading ? "Shielding…" : "Shield EMBR"}
              </Button>
            </form>
          </Card>
        )}

        {/* ── Private Send tab ── */}
        {activeTab === "send" && (
          <Card className="border-border rounded-sm p-6">
            <h2 className="font-bold uppercase tracking-wider text-sm mb-1">Send Privately</h2>
            <p className="text-xs text-muted-foreground mb-6">
              Spends your private notes and creates new hidden notes for the recipient.
              Sender, recipient, and amount are never persisted in a linkable form.
              The recipient must have created/imported a wallet on this node.
            </p>
            <form onSubmit={handlePrivateSend} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">Recipient Address</label>
                <Input placeholder="0x..." value={sendTo} onChange={e => setSendTo(e.target.value)}
                  className="font-mono bg-input border-border rounded-sm h-12" required />
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">Amount (EMBR)</label>
                <div className="relative">
                  <Input type="number" step="any" placeholder="0.00" value={sendAmount} onChange={e => setSendAmount(e.target.value)}
                    className="font-mono bg-input border-border rounded-sm h-12 pr-16" required />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-xs uppercase">EMBR</div>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">
                  Fee (EMBR) <span className="font-normal normal-case">(optional — defaults to 0.01 EMBR)</span>
                </label>
                <div className="relative">
                  <Input type="number" step="any" placeholder="0.01" value={sendFee} onChange={e => setSendFee(e.target.value)}
                    className="font-mono bg-input border-border rounded-sm h-12 pr-16" />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-xs uppercase">EMBR</div>
                </div>
              </div>
              <Button type="submit" disabled={loading || !sendTo || !sendAmount} className="w-full h-12 rounded-sm font-bold uppercase tracking-wider gap-2">
                <Lock className="w-4 h-4" />
                {loading ? "Sending…" : "Send Privately"}
              </Button>
            </form>
          </Card>
        )}

        {/* ── Unshield tab ── */}
        {activeTab === "unshield" && (
          <Card className="border-border rounded-sm p-6">
            <h2 className="font-bold uppercase tracking-wider text-sm mb-1">Unshield to Public</h2>
            <p className="text-xs text-muted-foreground mb-6">
              Moves EMBR from the shielded pool back to a visible public address.
              The destination and amount are visible at this boundary —
              no link to the originating shielded notes is recorded.
            </p>
            <form onSubmit={handleUnshield} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">
                  Destination Address <span className="font-normal normal-case">(optional — defaults to your own address)</span>
                </label>
                <Input placeholder={activeWallet?.address || "0x..."} value={unshieldTo} onChange={e => setUnshieldTo(e.target.value)}
                  className="font-mono bg-input border-border rounded-sm h-12" />
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block mb-1">Amount (EMBR)</label>
                <div className="relative">
                  <Input type="number" step="any" placeholder="0.00" value={unshieldAmount} onChange={e => setUnshieldAmount(e.target.value)}
                    className="font-mono bg-input border-border rounded-sm h-12 pr-16" required />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-xs uppercase">EMBR</div>
                </div>
              </div>
              <Button type="submit" disabled={loading || !unshieldAmount} className="w-full h-12 rounded-sm font-bold uppercase tracking-wider gap-2">
                <Unlock className="w-4 h-4" />
                {loading ? "Unshielding…" : "Unshield EMBR"}
              </Button>
            </form>
          </Card>
        )}

        {/* ── Ledger tab ── */}
        {activeTab === "ledger" && (
          <Card className="border-border rounded-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold uppercase tracking-wider text-sm">Shielded Ledger</h2>
              <Button variant="outline" size="sm" className="rounded-sm text-xs uppercase font-bold gap-1"
                onClick={fetchLedger} disabled={loading}>
                <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refresh
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Public record of shielded-pool operations. Private-send entries show only fee and opaque note IDs — never sender, recipient, or amount.
            </p>

            {!ledger && (
              <p className="text-muted-foreground text-sm py-8 text-center">
                Press <strong>Refresh</strong> to load the public ledger.
              </p>
            )}

            {ledger && ledger.length === 0 && (
              <p className="text-muted-foreground text-sm py-8 text-center">No shielded transactions yet.</p>
            )}

            {ledger && ledger.length > 0 && (
              <div className="space-y-2">
                {ledger.map((record) => (
                  <div key={record.id} className={cn(
                    "p-4 border rounded-sm text-xs",
                    record.type === "shield" ? "border-primary/20 bg-primary/5" :
                    record.type === "unshield" ? "border-amber-500/20 bg-amber-500/5" :
                    "border-border bg-secondary/20"
                  )}>
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <span className={cn(
                        "font-bold uppercase text-sm",
                        record.type === "shield" ? "text-primary" :
                        record.type === "unshield" ? "text-amber-400" :
                        "text-foreground"
                      )}>
                        {record.type === "private-send" ? "🔒 Private Send" :
                         record.type === "shield" ? "🛡 Shield" : "🔓 Unshield"}
                      </span>
                      <span className="text-muted-foreground font-mono">{new Date(record.createdAt).toLocaleString()}</span>
                    </div>

                    {record.publicAddress && (
                      <div className="mb-1">
                        <span className="text-muted-foreground">Address: </span>
                        <span className="font-mono">{record.publicAddress}</span>
                      </div>
                    )}
                    {record.publicAmount && (
                      <div className="mb-1">
                        <span className="text-muted-foreground">Amount: </span>
                        <span className="font-mono font-bold">{formatEmbr(record.publicAmount)} EMBR</span>
                      </div>
                    )}
                    {!record.publicAddress && !record.publicAmount && (
                      <div className="text-muted-foreground italic mb-1">Sender, recipient and amount hidden</div>
                    )}
                    <div className="text-muted-foreground">
                      Fee: <span className="font-mono">{formatEmbr(record.fee)} EMBR</span>
                      {" · "}Notes in: {record.noteIdsCreated.length}, spent: {record.noteIdsSpent.length}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </Shell>
  );
}
