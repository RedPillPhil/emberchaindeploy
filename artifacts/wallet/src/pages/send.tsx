import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Shell } from "@/components/layout/shell";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useCreateTransaction, useGetWallet } from "@workspace/api-client-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Send, AlertCircle, ArrowRight, CheckCircle2, Shield, Eye, Lock, BookUser } from "lucide-react";
import { formatEmbr } from "@/lib/utils";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { loadContacts, type Contact } from "@/lib/contacts";

const sendSchema = z.object({
  to: z.string().min(40, "Address must be at least 40 characters").startsWith("0x", "Address must start with 0x"),
  amount: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num > 0;
  }, "Amount must be greater than 0"),
});

type SendFormValues = z.infer<typeof sendSchema>;
type TxMode = "public" | "private";

export default function Transfer() {
  const { activeWallet } = useActiveWallet();
  const createTx = useCreateTransaction();
  const [successTxHash, setSuccessTxHash] = useState<string | null>(null);
  const [mode, setMode] = useState<TxMode>("public");
  const [showContacts, setShowContacts] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);

  // Pre-fill address from ?to= query param (e.g. from contacts page)
  const initialTo = new URLSearchParams(window.location.search).get("to") ?? "";

  useEffect(() => { setContacts(loadContacts()); }, []);

  const { data: wallet } = useGetWallet(activeWallet?.address || "", {
    query: { enabled: !!activeWallet?.address }
  });

  const form = useForm<SendFormValues>({
    resolver: zodResolver(sendSchema),
    defaultValues: { to: initialTo, amount: "" },
  });

  const onSubmit = (data: SendFormValues) => {
    if (!activeWallet) return;
    const amountInEmb = BigInt(Math.floor(parseFloat(data.amount) * 1e18)).toString();
    createTx.mutate({
      data: {
        fromPrivateKey: activeWallet.privateKey,
        to: data.to,
        value: amountInEmb,
      }
    }, {
      onSuccess: (tx) => {
        setSuccessTxHash(tx.hash);
        form.reset();
      }
    });
  };

  return (
    <Shell>
      <div className="max-w-2xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-4xl font-display font-bold uppercase tracking-tighter text-foreground mb-2 flex items-center gap-3">
            <Send className="w-8 h-8 text-primary" /> Transfer Funds
          </h1>
          <p className="text-muted-foreground font-sans text-sm uppercase tracking-widest font-bold">
            Move EMBR across the network.
          </p>
        </div>

        {/* Mode selector */}
        <div className="mb-6 grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode("public")}
            className={cn(
              "flex items-center gap-3 p-4 border rounded-sm transition-all text-left",
              mode === "public"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-border/80 hover:bg-secondary/50"
            )}
          >
            <Eye className="w-5 h-5 shrink-0" />
            <div>
              <div className="font-bold uppercase text-sm tracking-wider">Public</div>
              <div className="text-xs opacity-70 mt-0.5">Visible on explorer, can call contracts</div>
            </div>
          </button>
          <button
            onClick={() => { setMode("private"); }}
            className={cn(
              "flex items-center gap-3 p-4 border rounded-sm transition-all text-left relative overflow-hidden",
              mode === "private"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-border/80 hover:bg-secondary/50"
            )}
          >
            {mode === "private" && <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent" />}
            <Lock className="w-5 h-5 shrink-0" />
            <div>
              <div className="font-bold uppercase text-sm tracking-wider">Private</div>
              <div className="text-xs opacity-70 mt-0.5">Sender, recipient &amp; amount hidden</div>
            </div>
          </button>
        </div>

        {/* Private mode redirect notice */}
        {mode === "private" && (
          <Card className="border-primary/50 bg-primary/5 p-6 rounded-sm mb-6">
            <div className="flex gap-4 items-start">
              <Shield className="w-8 h-8 text-primary shrink-0 mt-1" />
              <div>
                <h3 className="font-bold uppercase tracking-wider text-primary mb-2">Private Transaction Mode</h3>
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                  Private sends use the shielded pool — you need a private balance first. Use the <strong>Privacy</strong> screen to shield public EMBR, then send privately.
                </p>
                <p className="text-xs text-muted-foreground mb-4 opacity-70">
                  <strong>Privacy model:</strong> sender, recipient, and amount are hidden on-chain via ring signatures and Pedersen commitments. Shield/unshield boundaries do reveal the public address and amount (by design, same as Zcash). No zero-knowledge range proofs — amounts are enforced via server-side plaintext bounds checks.
                </p>
                <Link
                  href="/privacy"
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-sm text-sm font-bold uppercase tracking-wider hover:bg-primary/90 transition-colors"
                >
                  Go to Privacy Screen <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </Card>
        )}

        {/* Public send form */}
        {mode === "public" && (
          <>
            <Card className="p-1 mb-8 bg-secondary/50 border-border rounded-sm">
              <div className="flex justify-between items-center p-4 border border-dashed border-border">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Public Balance</span>
                <span className="font-mono text-xl text-primary">{wallet ? formatEmbr(wallet.balance) : "0.00"} EMBR</span>
              </div>
            </Card>

            {successTxHash ? (
              <Card className="border-primary bg-primary/5 p-8 text-center rounded-sm animate-in fade-in slide-in-from-bottom-4 duration-500 box-glow">
                <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-primary/50 text-primary">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-display font-bold uppercase mb-2">Transaction Broadcasted</h2>
                <p className="text-muted-foreground text-sm mb-6">Your transaction has been submitted to the mempool.</p>
                <div className="bg-secondary p-3 rounded-sm font-mono text-xs break-all mb-6 border border-border">
                  {successTxHash}
                </div>
                <div className="flex gap-4 justify-center">
                  <Button onClick={() => setSuccessTxHash(null)} variant="outline" className="rounded-sm font-bold uppercase text-xs">
                    Send Another
                  </Button>
                  <Link href="/transactions" className="inline-flex items-center justify-center rounded-sm text-xs font-bold uppercase tracking-wider h-10 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                    View History
                  </Link>
                </div>
              </Card>
            ) : (
              <Card className="border-border bg-card/80 backdrop-blur rounded-sm">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="p-6 space-y-6">
                    <FormField
                      control={form.control}
                      name="to"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center justify-between">
                            <span>Recipient Address</span>
                            {contacts.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setShowContacts(true)}
                                className="flex items-center gap-1 text-primary hover:text-primary/80 transition-colors text-[11px] font-bold uppercase tracking-widest"
                              >
                                <BookUser className="w-3.5 h-3.5" /> Address Book
                              </button>
                            )}
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="0x..." className="font-mono bg-input border-border rounded-sm h-12" {...field} />
                          </FormControl>
                          <FormMessage className="text-destructive uppercase text-xs font-bold" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex justify-between">
                            <span>Amount (EMBR)</span>
                            <button type="button" className="text-primary hover:underline"
                              onClick={() => { if (wallet?.balance) form.setValue("amount", formatEmbr(wallet.balance).replace(/,/g, '')); }}>
                              MAX
                            </button>
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input type="number" step="any" placeholder="0.00" className="font-mono bg-input border-border rounded-sm h-14 text-xl pl-4 pr-16" {...field} />
                              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold uppercase text-xs">EMBR</div>
                            </div>
                          </FormControl>
                          <FormMessage className="text-destructive uppercase text-xs font-bold" />
                        </FormItem>
                      )}
                    />
                    {createTx.isError && (
                      <div className="bg-destructive/10 border border-destructive/50 p-4 rounded-sm flex items-start gap-3 text-destructive">
                        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold uppercase text-sm mb-1">Transaction Failed</div>
                          <div className="text-xs font-mono break-all">{createTx.error?.message || "Unknown error"}</div>
                        </div>
                      </div>
                    )}
                    <Button type="submit" disabled={createTx.isPending} className="w-full h-14 rounded-sm font-bold uppercase tracking-wider text-lg bg-primary text-primary-foreground hover:bg-primary/90 group">
                      {createTx.isPending ? "Signing..." : "Sign & Send"}
                      {!createTx.isPending && <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />}
                    </Button>
                  </form>
                </Form>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Contact picker dialog */}
      <Dialog open={showContacts} onOpenChange={setShowContacts}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-tight flex items-center gap-2">
              <BookUser className="w-5 h-5 text-primary" /> Address Book
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {contacts.map((c) => (
              <button
                key={c.id}
                onClick={() => { form.setValue("to", c.address); setShowContacts(false); }}
                className="w-full text-left p-3 rounded-sm border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-sm bg-primary/10 border border-primary/30 flex items-center justify-center font-display font-bold text-primary text-base uppercase shrink-0">
                  {c.name[0]}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-sm text-foreground">{c.name}</div>
                  <div className="font-mono text-xs text-muted-foreground truncate">
                    {c.address.slice(0, 12)}…{c.address.slice(-8)}
                  </div>
                  {c.notes && <div className="text-xs text-muted-foreground truncate">{c.notes}</div>}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
