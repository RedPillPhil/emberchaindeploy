import React, { useEffect, useRef, useState } from "react";
import { Shell } from "@/components/layout/shell";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useGetWallet, useGetChainStatus, useGetMiningStatus } from "@workspace/api-client-react";
import { formatEmbr } from "@/lib/utils";
import {
  Flame, Database, Clock, Activity, Zap, Cpu,
  ArrowUpRight, Users, QrCode, Copy, Check,
  ShieldAlert, ShieldCheck, Share2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import QRCode from "react-qr-code";
import { Card } from "@/components/ui/card";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { BackupDialog } from "@/components/backup-dialog";
import { isBackupConfirmed } from "@/lib/keystore";

// Need Blocks icon
import { Blocks } from "lucide-react";

function abbreviateNumber(n: bigint): string {
  const num = Number(n);
  if (num >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (num >= 1e9)  return (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6)  return (num / 1e6).toFixed(2) + "M";
  if (num >= 1e3)  return (num / 1e3).toFixed(2) + "K";
  return num.toLocaleString();
}

export default function Dashboard() {
  const { activeWallet } = useActiveWallet();
  const [showQR, setShowQR]             = useState(false);
  const [copied, setCopied]             = useState(false);
  const [showBackup, setShowBackup]     = useState(false);
  const [backedUp, setBackedUp]         = useState(false);

  // Re-check backup flag whenever the dialog closes or wallet changes
  useEffect(() => {
    if (activeWallet?.address) {
      setBackedUp(isBackupConfirmed(activeWallet.address));
    }
  }, [activeWallet?.address, showBackup]);

  const copyAddress = () => {
    if (!activeWallet?.address) return;
    navigator.clipboard.writeText(activeWallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Polling queries
  const { data: wallet } = useGetWallet(activeWallet?.address || "", {
    query: {
      enabled: !!activeWallet?.address,
      refetchInterval: 3000,
    }
  });

  const { data: chainStatus } = useGetChainStatus({
    query: { refetchInterval: 3000 }
  });

  const { data: miningStatus } = useGetMiningStatus({
    query: { refetchInterval: 3000 }
  });

  // Track balance changes to animate
  const prevBalance = useRef(wallet?.balance);
  const balanceRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (wallet?.balance && prevBalance.current && wallet.balance !== prevBalance.current) {
      if (balanceRef.current) {
        balanceRef.current.classList.remove("animate-pulse-fast");
        void balanceRef.current.offsetWidth;
        balanceRef.current.classList.add("animate-pulse-fast");
      }
    }
    prevBalance.current = wallet?.balance;
  }, [wallet?.balance]);

  return (
    <Shell>
      {/* ── Backup nudge banner ─────────────────────────────────────────── */}
      {activeWallet && !backedUp && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-sm border border-amber-500/40 bg-amber-500/5 -mt-2 mb-2">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-400/90 flex-1">
            <span className="font-bold">Your wallet is not backed up.</span>{" "}
            If you lose access to this browser, your EMBR is gone.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/60 gap-1.5"
            onClick={() => setShowBackup(true)}
          >
            <ShieldCheck className="w-3.5 h-3.5" /> Back up now
          </Button>
        </div>
      )}

      <div className="flex items-end justify-between border-b border-border pb-6">
        <div>
          <h1 className="text-4xl font-display font-bold uppercase tracking-tighter text-foreground mb-1">
            System Overview
          </h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground font-bold uppercase tracking-widest">
            <span className={cn("w-2 h-2 rounded-full", chainStatus ? "bg-primary animate-pulse" : "bg-muted")}></span>
            {chainStatus ? "Node Online" : "Connecting..."}
          </div>
        </div>

        {/* Backup button — always accessible from header area */}
        {activeWallet && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowBackup(true)}
            className={cn(
              "gap-1.5 text-xs",
              backedUp
                ? "border-green-500/30 text-green-400 hover:bg-green-500/10"
                : "border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
            )}
          >
            {backedUp
              ? <><ShieldCheck className="w-3.5 h-3.5" /> Backed Up</>
              : <><ShieldAlert className="w-3.5 h-3.5" /> Backup Wallet</>
            }
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Main Balance Card */}
        <Card className="md:col-span-2 border-primary/20 bg-card/50 backdrop-blur flex flex-col justify-between overflow-hidden relative">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <Flame className="w-48 h-48" />
          </div>

          <div className="p-6 relative z-10">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Active Balance
            </div>

            <div
              ref={balanceRef}
              className="text-6xl sm:text-8xl font-display font-bold tracking-tighter text-glow truncate text-foreground transition-all"
            >
              {wallet ? formatEmbr(wallet.balance) : "0.00"}
            </div>
            <div className="text-primary font-bold uppercase tracking-widest text-sm mt-1">
              EMBR
            </div>
          </div>

          <div className="bg-secondary/50 p-4 border-t border-border flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center relative z-10">
            <div className="font-mono text-xs text-muted-foreground truncate min-w-0">
              <span className="font-sans font-bold uppercase mr-2 text-foreground">ADDR:</span>
              <span className="truncate">{activeWallet?.address}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="font-mono text-xs">
                <span className="font-sans font-bold uppercase mr-2 text-muted-foreground">NONCE:</span>
                {wallet?.nonce || 0}
              </div>
              <button
                onClick={copyAddress}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Copy address"
              >
                {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setShowQR(true)}
                className="text-muted-foreground hover:text-primary transition-colors"
                title="Show QR code"
              >
                <QrCode className="w-4 h-4" />
              </button>
            </div>
          </div>
        </Card>

        {/* QR receive dialog */}
        <Dialog open={showQR} onOpenChange={setShowQR}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-display uppercase tracking-tight">Receive EMBR</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="bg-white p-4 rounded-sm border border-border">
                <QRCode value={activeWallet?.address ?? ""} size={200} />
              </div>
              <p className="font-mono text-xs text-muted-foreground text-center break-all px-2">
                {activeWallet?.address}
              </p>
              <Button onClick={copyAddress} variant="outline" className="w-full">
                {copied ? <><Check className="w-4 h-4 mr-2 text-primary" /> Copied!</> : <><Copy className="w-4 h-4 mr-2" /> Copy Address</>}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Backup dialog */}
        {activeWallet && (
          <BackupDialog
            open={showBackup}
            onOpenChange={setShowBackup}
            address={activeWallet.address}
            privateKey={activeWallet.privateKey}
          />
        )}

        {/* Pool Activity */}
        <Card className="border border-border bg-card/50 flex flex-col justify-between p-6 relative overflow-hidden">
          <div>
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-6 flex items-center justify-between">
              <span>Pool Activity</span>
              <span className="text-primary flex items-center gap-1 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-primary inline-block" /> LIVE
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-3xl font-display font-bold">
                  {miningStatus?.activeMiners ?? 0}
                </div>
                <div className="text-xs text-muted-foreground font-bold uppercase">Active Miners</div>
              </div>

              <div>
                <div className="text-3xl font-display font-bold">
                  {Object.values(miningStatus?.sharesInRound ?? {}).reduce((s, n) => s + n, 0)}
                </div>
                <div className="text-xs text-muted-foreground font-bold uppercase">Shares This Round</div>
              </div>

              <div>
                <div className="text-xl font-mono">
                  {chainStatus?.avgBlockTime != null ? `${chainStatus.avgBlockTime.toFixed(1)}s` : "…"}
                </div>
                <div className="text-xs text-muted-foreground font-bold uppercase">Avg Block Time</div>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <Link href="/mining" className="flex items-center text-xs font-bold uppercase text-primary hover:text-primary-foreground hover:bg-primary transition-colors py-2 px-3 border border-primary/30 rounded-sm w-fit group">
              Open Mining Control <ArrowUpRight className="w-3 h-3 ml-2 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
            </Link>
          </div>
        </Card>

      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-4">
        <StatBlock
          icon={<Blocks className="w-4 h-4" />}
          label="Block Height"
          value={chainStatus?.height.toLocaleString() || "..."}
        />
        <StatBlock
          icon={<Zap className="w-4 h-4 text-accent" />}
          label="Difficulty"
          value={chainStatus ? abbreviateNumber(BigInt(chainStatus.difficulty)) : "..."}
        />
        <StatBlock
          icon={<Clock className="w-4 h-4" />}
          label="Avg Block Time"
          value={chainStatus?.avgBlockTime != null ? `${chainStatus.avgBlockTime.toFixed(1)}s` : "..."}
        />
        <StatBlock
          icon={<Activity className="w-4 h-4" />}
          label="Pending TXs"
          value={chainStatus?.pendingTransactionCount.toString() || "0"}
        />
        <StatBlock
          icon={<Users className="w-4 h-4 text-primary" />}
          label="Active Miners"
          value={(miningStatus?.activeMiners ?? 0).toString()}
        />
      </div>

    </Shell>
  );
}

function StatBlock({ label, value, icon }: { label: string, value: string, icon: React.ReactNode }) {
  return (
    <div className="bg-secondary/30 border border-border p-4 rounded-sm flex flex-col gap-2">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
        {icon} {label}
      </div>
      <div className="font-mono text-xl">{value}</div>
    </div>
  );
}
