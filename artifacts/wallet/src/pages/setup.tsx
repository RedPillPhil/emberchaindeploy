import React, { useRef, useState } from "react";
import { Shell } from "@/components/layout/shell";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateWallet } from "@workspace/api-client-react";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { Redirect } from "wouter";
import { KeyRound, Flame, ShieldAlert, AlertTriangle, ArrowRight, Upload, Eye, EyeOff, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { decryptKeystore, parseKeystoreFile } from "@/lib/keystore";

type Mode = "choice" | "create" | "import" | "keystore";

export default function Setup() {
  const { activeWallet, setActiveWallet, isLoaded } = useActiveWallet();
  const createWallet = useCreateWallet();

  const [mode, setMode]           = useState<Mode>("choice");
  const [importKey, setImportKey] = useState("");
  const [error, setError]         = useState("");
  const [generatedKey, setGeneratedKey] = useState<{ address: string; privateKey: string } | null>(null);

  // Keystore import state
  const [ksFile, setKsFile]         = useState<File | null>(null);
  const [ksPassword, setKsPassword] = useState("");
  const [showKsPw, setShowKsPw]     = useState(false);
  const [ksLoading, setKsLoading]   = useState(false);
  const fileInputRef                = useRef<HTMLInputElement>(null);

  if (isLoaded && activeWallet) {
    return <Redirect to="/" />;
  }

  // ── Create wallet ───────────────────────────────────────────────────────────

  const handleCreate = () => {
    setError("");
    createWallet.mutate({ data: {} }, {
      onSuccess: (data) => {
        setGeneratedKey({ address: data.address, privateKey: data.privateKey });
      },
      onError: (err: any) => {
        setError(err.message || "Failed to generate wallet");
      }
    });
  };

  // ── Import via raw private key ──────────────────────────────────────────────

  const handleImport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!importKey.trim() || !importKey.startsWith("0x")) {
      setError("Private key must start with 0x");
      return;
    }
    setError("");
    createWallet.mutate({ data: { privateKey: importKey } }, {
      onSuccess: (data) => {
        setActiveWallet({ address: data.address, privateKey: data.privateKey });
      },
      onError: (err: any) => {
        setError(err.message || "Failed to import wallet");
      }
    });
  };

  // ── Import via keystore file ────────────────────────────────────────────────

  const handleKeystoreImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ksFile) { setError("Please choose a keystore file."); return; }
    if (!ksPassword) { setError("Please enter your keystore password."); return; }
    setError("");
    setKsLoading(true);
    try {
      const keystore   = await parseKeystoreFile(ksFile);
      const privateKey = await decryptKeystore(keystore, ksPassword);
      // Validate the private key with the server (derives address, etc.)
      createWallet.mutate({ data: { privateKey } }, {
        onSuccess: (data) => {
          setActiveWallet({ address: data.address, privateKey: data.privateKey });
        },
        onError: (err: any) => {
          setError(err.message || "Failed to mount wallet from keystore.");
          setKsLoading(false);
        }
      });
    } catch (err: any) {
      setError(err?.message ?? "Failed to decrypt keystore.");
      setKsLoading(false);
    }
  };

  const handleAcknowledgeAndProceed = () => {
    if (generatedKey) setActiveWallet(generatedKey);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 scanline">
      <div className="w-full max-w-md relative z-10">

        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-16 h-16 rounded-md bg-primary/20 flex items-center justify-center border border-primary/50 text-primary mb-6 relative">
            <div className="absolute inset-0 bg-primary/20 animate-pulse rounded-md" style={{ filter: "blur(10px)" }}></div>
            <Flame className="w-8 h-8 fill-primary relative z-10" />
          </div>
          <h1 className="text-4xl font-display font-bold text-glow tracking-tighter uppercase">Emberchain</h1>
          <p className="text-muted-foreground mt-2 font-sans text-sm uppercase tracking-widest">Forge Command Interface</p>
        </div>

        {/* ── Choice ─────────────────────────────────────────────────────── */}
        {mode === "choice" && (
          <div className="grid gap-4">
            <Button
              onClick={() => setMode("create")}
              className="h-24 flex flex-col gap-2 items-center justify-center text-lg font-bold border-2 border-primary bg-primary/10 hover:bg-primary hover:text-primary-foreground transition-all duration-300 rounded-sm box-glow"
              variant="outline"
            >
              <Flame className="w-6 h-6" />
              <span>IGNITE NEW WALLET</span>
            </Button>

            <Button
              onClick={() => setMode("import")}
              className="h-20 flex flex-col gap-2 items-center justify-center text-base font-bold border-2 border-secondary bg-secondary/50 hover:bg-secondary hover:text-foreground transition-all duration-300 rounded-sm"
              variant="outline"
            >
              <KeyRound className="w-5 h-5" />
              <span>IMPORT PRIVATE KEY</span>
            </Button>

            <Button
              onClick={() => setMode("keystore")}
              className="h-20 flex flex-col gap-2 items-center justify-center text-base font-bold border-2 border-secondary bg-secondary/50 hover:bg-secondary hover:text-foreground transition-all duration-300 rounded-sm"
              variant="outline"
            >
              <Upload className="w-5 h-5" />
              <span>RESTORE FROM KEYSTORE FILE</span>
            </Button>
          </div>
        )}

        {/* ── Create ─────────────────────────────────────────────────────── */}
        {mode === "create" && !generatedKey && (
          <Card className="border-primary/50 bg-card/80 backdrop-blur rounded-sm">
            <CardHeader>
              <CardTitle className="font-display tracking-tight text-2xl text-primary uppercase">Ignite Wallet</CardTitle>
              <CardDescription className="text-muted-foreground uppercase text-xs font-bold font-sans">
                Generates a fresh cryptographic identity on this node.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert className="bg-destructive/10 border-destructive/50 text-destructive mb-6 rounded-sm">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="font-bold uppercase tracking-wider">Warning</AlertTitle>
                <AlertDescription className="text-xs mt-2 uppercase font-bold leading-relaxed">
                  The generated private key is your only access to funds. We do not store it. You must secure it immediately.
                </AlertDescription>
              </Alert>

              {error && <div className="text-destructive text-sm font-bold uppercase mb-4">{error}</div>}

              <Button
                onClick={handleCreate}
                className="w-full font-bold uppercase tracking-wider h-12 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={createWallet.isPending}
              >
                {createWallet.isPending ? "Forging..." : "Generate Keys"}
                {!createWallet.isPending && <ArrowRight className="ml-2 w-4 h-4" />}
              </Button>
            </CardContent>
            <CardFooter>
              <Button variant="ghost" className="w-full text-muted-foreground uppercase text-xs font-bold rounded-sm hover:bg-secondary" onClick={() => setMode("choice")}>
                Cancel
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* ── Key generated — show & acknowledge ─────────────────────────── */}
        {mode === "create" && generatedKey && (
          <Card className="border-primary bg-card/90 backdrop-blur rounded-sm shadow-[0_0_30px_rgba(255,90,0,0.15)] animate-in fade-in zoom-in duration-500">
            <CardHeader className="border-b border-border pb-4 bg-primary/5">
              <div className="flex items-center gap-2 text-primary mb-2">
                <ShieldAlert className="w-5 h-5" />
                <span className="font-bold font-sans tracking-widest text-xs uppercase">Critical Security Action</span>
              </div>
              <CardTitle className="font-display tracking-tight text-2xl uppercase">Identity Forged</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Public Address</label>
                <div className="bg-secondary p-3 rounded-sm font-mono text-sm break-all border border-border">
                  {generatedKey.address}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-destructive uppercase tracking-widest flex items-center gap-2">
                  <Flame className="w-3 h-3" /> Private Key (DO NOT SHARE)
                </label>
                <div className="bg-destructive/10 p-4 rounded-sm font-mono text-sm break-all border border-destructive/50 text-destructive-foreground">
                  {generatedKey.privateKey}
                </div>
                <p className="text-xs text-muted-foreground font-bold uppercase mt-2">
                  Copy this now. It will never be shown again.
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button
                onClick={handleAcknowledgeAndProceed}
                className="w-full font-bold uppercase tracking-wider h-14 rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 text-lg group"
              >
                I Have Saved My Key
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* ── Import raw private key ──────────────────────────────────────── */}
        {mode === "import" && (
          <Card className="border-border bg-card/80 backdrop-blur rounded-sm">
            <CardHeader>
              <CardTitle className="font-display tracking-tight text-2xl uppercase">Import Key</CardTitle>
              <CardDescription className="text-muted-foreground uppercase text-xs font-bold font-sans">
                Mount an existing identity to this terminal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleImport} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Private Key (0x...)</label>
                  <Input
                    autoFocus
                    type="password"
                    value={importKey}
                    onChange={(e) => setImportKey(e.target.value)}
                    placeholder="0x..."
                    className="font-mono bg-input border-border rounded-sm focus-visible:ring-primary focus-visible:border-primary"
                  />
                </div>

                {error && <div className="text-destructive text-sm font-bold uppercase">{error}</div>}

                <Button
                  type="submit"
                  className="w-full font-bold uppercase tracking-wider h-12 rounded-sm"
                  disabled={createWallet.isPending || !importKey}
                >
                  {createWallet.isPending ? "Mounting..." : "Mount Identity"}
                </Button>
              </form>
            </CardContent>
            <CardFooter>
              <Button variant="ghost" className="w-full text-muted-foreground uppercase text-xs font-bold rounded-sm hover:bg-secondary" onClick={() => setMode("choice")}>
                Cancel
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* ── Import from keystore file ───────────────────────────────────── */}
        {mode === "keystore" && (
          <Card className="border-border bg-card/80 backdrop-blur rounded-sm">
            <CardHeader>
              <CardTitle className="font-display tracking-tight text-2xl uppercase">Restore Wallet</CardTitle>
              <CardDescription className="text-muted-foreground uppercase text-xs font-bold font-sans">
                Decrypt an Emberchain keystore file to recover your wallet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleKeystoreImport} className="space-y-4">

                {/* File picker */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    Keystore JSON file
                  </Label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "flex items-center gap-3 p-4 rounded-sm border-2 border-dashed cursor-pointer transition-colors",
                      ksFile
                        ? "border-primary/40 bg-primary/5 text-foreground"
                        : "border-border hover:border-primary/30 text-muted-foreground"
                    )}
                  >
                    <Upload className="w-5 h-5 shrink-0" />
                    <span className="text-sm font-mono truncate">
                      {ksFile ? ksFile.name : "Click to choose keystore file…"}
                    </span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      setError("");
                      setKsFile(e.target.files?.[0] ?? null);
                    }}
                  />
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    Keystore password
                  </Label>
                  <div className="relative">
                    <Input
                      type={showKsPw ? "text" : "password"}
                      value={ksPassword}
                      onChange={(e) => setKsPassword(e.target.value)}
                      placeholder="Your encryption password"
                      className="font-mono pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKsPw(!showKsPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showKsPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <p className="text-destructive text-sm font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
                  </p>
                )}

                <Button
                  type="submit"
                  className="w-full font-bold uppercase tracking-wider h-12 rounded-sm"
                  disabled={ksLoading || !ksFile || !ksPassword}
                >
                  {ksLoading
                    ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Decrypting…</>
                    : <>Restore Wallet <ArrowRight className="ml-2 w-4 h-4" /></>
                  }
                </Button>
              </form>
            </CardContent>
            <CardFooter>
              <Button
                variant="ghost"
                className="w-full text-muted-foreground uppercase text-xs font-bold rounded-sm hover:bg-secondary"
                onClick={() => { setMode("choice"); setError(""); setKsFile(null); setKsPassword(""); }}
              >
                Cancel
              </Button>
            </CardFooter>
          </Card>
        )}

      </div>
    </div>
  );
}
