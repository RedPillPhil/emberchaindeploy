/**
 * BackupDialog — two-tab backup modal:
 *   • Keystore File  — password-protect and download an encrypted JSON file
 *   • Raw Private Key — type "I UNDERSTAND" to reveal with 30 s auto-hide
 */
import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Download,
  Eye,
  EyeOff,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  KeyRound,
} from "lucide-react";
import { encryptKeystore, downloadKeystore, markBackupConfirmed } from "@/lib/keystore";
import { useToast } from "@/hooks/use-toast";

type Tab = "keystore" | "rawkey";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  address: string;
  privateKey: string;
}

// ── Keystore tab ──────────────────────────────────────────────────────────────

function KeystoreTab({ address, privateKey }: { address: string; privateKey: string }) {
  const { toast } = useToast();
  const [pw, setPw]         = useState("");
  const [pw2, setPw2]       = useState("");
  const [busy, setBusy]     = useState(false);
  const [done, setDone]     = useState(false);
  const [err, setErr]       = useState("");
  const [showPw, setShowPw] = useState(false);

  const handleDownload = async () => {
    setErr("");
    if (pw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (pw !== pw2)    { setErr("Passwords do not match."); return; }
    setBusy(true);
    try {
      const ks = await encryptKeystore(privateKey, pw, address);
      downloadKeystore(ks);
      markBackupConfirmed(address);
      setDone(true);
      toast({ title: "Keystore downloaded", description: "Keep that file somewhere safe — it's your only backup." });
    } catch (e: any) {
      setErr(e?.message ?? "Encryption failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-sm border border-primary/20 bg-primary/5 text-sm text-muted-foreground leading-relaxed">
        <p className="font-bold text-foreground mb-1">What is a keystore file?</p>
        Your private key will be encrypted with AES-256-GCM (PBKDF2, 600 000 iterations) and
        saved as a <code className="font-mono text-xs">.json</code> file on your device.
        Anyone with this file <em>and</em> your password can access your wallet —
        store them separately.
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-bold uppercase text-muted-foreground">Encryption password</Label>
        <div className="relative">
          <Input
            type={showPw ? "text" : "password"}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Min 8 characters"
            className="pr-10 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-bold uppercase text-muted-foreground">Confirm password</Label>
        <Input
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          placeholder="Repeat password"
          className="font-mono"
        />
      </div>

      {err && (
        <p className="text-destructive text-sm font-bold flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {err}
        </p>
      )}

      {done ? (
        <div className="flex items-center gap-2 p-3 rounded-sm border border-green-500/40 bg-green-500/5 text-green-400 text-sm font-bold">
          <ShieldCheck className="w-4 h-4" /> Keystore downloaded — backup confirmed.
        </div>
      ) : (
        <Button
          onClick={handleDownload}
          disabled={busy || !pw || !pw2}
          className="w-full gap-2"
        >
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Encrypting…</> : <><Download className="w-4 h-4" /> Download Keystore File</>}
        </Button>
      )}
    </div>
  );
}

// ── Raw key tab ───────────────────────────────────────────────────────────────

const CONFIRM_PHRASE = "I UNDERSTAND";
const AUTO_HIDE_SECS = 30;

function RawKeyTab({ address, privateKey }: { address: string; privateKey: string }) {
  const [confirm, setConfirm]     = useState("");
  const [revealed, setRevealed]   = useState(false);
  const [countdown, setCountdown] = useState(AUTO_HIDE_SECS);
  const [copied, setCopied]       = useState(false);
  const timerRef                  = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleReveal = () => {
    if (confirm !== CONFIRM_PHRASE) return;
    markBackupConfirmed(address);
    setRevealed(true);
    setCountdown(AUTO_HIDE_SECS);
  };

  useEffect(() => {
    if (!revealed) return;
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          setRevealed(false);
          setConfirm("");
          clearInterval(timerRef.current!);
          return AUTO_HIDE_SECS;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [revealed]);

  const handleCopy = () => {
    navigator.clipboard.writeText(privateKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-sm border border-destructive/30 bg-destructive/5 text-sm leading-relaxed">
        <p className="font-bold text-destructive mb-1 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" /> Danger zone
        </p>
        <span className="text-muted-foreground">
          Anyone who sees your raw private key can take your funds instantly.
          Never paste it into a website or share it over any channel.
        </span>
      </div>

      {!revealed ? (
        <div className="space-y-3">
          <Label className="text-xs font-bold uppercase text-muted-foreground">
            Type <span className="text-foreground font-mono">{CONFIRM_PHRASE}</span> to reveal
          </Label>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.toUpperCase())}
            placeholder={CONFIRM_PHRASE}
            className="font-mono uppercase tracking-widest"
          />
          <Button
            onClick={handleReveal}
            disabled={confirm !== CONFIRM_PHRASE}
            variant="destructive"
            className="w-full gap-2"
          >
            <Eye className="w-4 h-4" /> Reveal Private Key
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative p-4 rounded-sm border border-destructive/40 bg-destructive/5 font-mono text-sm break-all text-foreground">
            {privateKey}
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors"
              title="Copy"
            >
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <EyeOff className="w-3.5 h-3.5" />
              Auto-hides in <span className="font-bold text-foreground font-mono">{countdown}s</span>
            </span>
            <button
              onClick={() => { setRevealed(false); setConfirm(""); clearInterval(timerRef.current!); }}
              className="font-bold text-destructive hover:underline"
            >
              Hide now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dialog shell ──────────────────────────────────────────────────────────────

export function BackupDialog({ open, onOpenChange, address, privateKey }: Props) {
  const [tab, setTab] = useState<Tab>("keystore");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display uppercase tracking-tight text-xl">
            Backup Wallet
          </DialogTitle>
          <DialogDescription className="text-xs uppercase font-bold text-muted-foreground tracking-widest">
            {address.slice(0, 12)}…{address.slice(-8)}
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex border-b border-border -mx-6 px-6">
          {(["keystore", "rawkey"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide px-3 py-2.5 border-b-2 transition-colors ${
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "keystore" ? (
                <><Download className="w-3.5 h-3.5" /> Keystore File</>
              ) : (
                <><KeyRound className="w-3.5 h-3.5" /> Raw Private Key</>
              )}
            </button>
          ))}
        </div>

        <div className="pt-2">
          {tab === "keystore" ? (
            <KeystoreTab address={address} privateKey={privateKey} />
          ) : (
            <RawKeyTab address={address} privateKey={privateKey} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
