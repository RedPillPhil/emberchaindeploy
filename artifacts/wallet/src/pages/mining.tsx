import React, { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/layout/shell";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useGetMiningStatus, useSubmitBlock, useSubmitShare, getMiningTemplate } from "@workspace/api-client-react";
import type { MiningTemplate, SubmitBlockInput } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Flame, Zap, Hash, Database, Terminal, Cpu, Share2 } from "lucide-react";
import { cn, formatEmbr } from "@/lib/utils";
import type { FromWorkerMsg, ToWorkerMsg, WorkerErrorMsg } from "@/workers/mining.worker";

// ── intensity levels ──────────────────────────────────────────────────────────

const INTENSITY_LEVELS = [
  { value: 1, label: "Eco",        batchSize: 100,   description: "~100 H/batch per core — barely perceptible CPU load",         color: "text-blue-400",   bgColor: "bg-blue-400/10",   borderColor: "border-blue-400/40"   },
  { value: 2, label: "Balanced",   batchSize: 500,   description: "~500 H/batch per core — quiet fan, UI stays smooth",          color: "text-green-400",  bgColor: "bg-green-400/10",  borderColor: "border-green-400/40"  },
  { value: 3, label: "High",       batchSize: 2000,  description: "~2k H/batch per core — fan spins up, noticeably faster",      color: "text-yellow-400", bgColor: "bg-yellow-400/10", borderColor: "border-yellow-400/40" },
  { value: 4, label: "Aggressive", batchSize: 8000,  description: "~8k H/batch per core — all cores pegged, tab stays smooth",   color: "text-orange-400", bgColor: "bg-orange-400/10", borderColor: "border-orange-400/40" },
  { value: 5, label: "Max",        batchSize: 25000, description: "~25k H/batch per core — full multi-core, fan will spin up",   color: "text-primary",    bgColor: "bg-primary/10",    borderColor: "border-primary/40"    },
] as const;

// ── core count — one worker per logical CPU, capped at 8 ─────────────────────

const CORE_COUNT = (() => {
  try { return Math.min(navigator.hardwareConcurrency || 4, 8); } catch { return 4; }
})();

// ── helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string) { return s.slice(0, 10) + "…" + s.slice(-6); }

function makeWorker() {
  return new Worker(new URL("../workers/mining.worker.ts", import.meta.url), { type: "module" });
}

// ── BroadcastChannel tab coordination ────────────────────────────────────────
// Prevents two tabs in the same browser from mining simultaneously.
const MINING_CHANNEL = "emberchain_mining";

// ── component ─────────────────────────────────────────────────────────────────

export default function Mining() {
  const { activeWallet } = useActiveWallet();
  const submitBlock = useSubmitBlock();
  const submitShareMutation = useSubmitShare();

  const [isMining, setIsMining]               = useState(false);
  const [hashRate, setHashRate]               = useState(0);
  const [sessionBlocks, setSessionBlocks]     = useState(0);
  const [sessionShares, setSessionShares]     = useState(0);
  const [confirmedShares, setConfirmedShares] = useState(0);
  const [selectedIntensity, setSelectedIntensity] = useState(2);
  const [logs, setLogs]                       = useState<string[]>([]);
  const [tabBlocked, setTabBlocked]           = useState(false);

  // Pool of workers — one per CPU core
  const workerPoolRef       = useRef<Worker[]>([]);
  // Per-worker hash rates — summed for display
  const hashRatesRef        = useRef<Map<Worker, number>>(new Map());
  const miningRef           = useRef(false);   // mirrors isMining without stale-closure issues
  const templateRef         = useRef<MiningTemplate | null>(null);
  const templateFetchingRef = useRef(false);   // prevents duplicate simultaneous fetches
  const channelRef          = useRef<BroadcastChannel | null>(null);

  const { data: status } = useGetMiningStatus({ query: { refetchInterval: 3000 } });

  const addLog = useCallback((msg: string, kind: "default" | "found" | "warn" = "default") => {
    const tag = kind === "found" ? "★ " : kind === "warn" ? "! " : "  ";
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${tag}${msg}`, ...prev].slice(0, 80));
  }, []);

  // ── worker lifecycle ────────────────────────────────────────────────────────

  const stopWorker = useCallback(() => {
    miningRef.current = false;
    setIsMining(false);
    setHashRate(0);
    for (const w of workerPoolRef.current) {
      w.postMessage({ type: "stop" } satisfies ToWorkerMsg);
      setTimeout(() => w.terminate(), 300);
    }
    workerPoolRef.current = [];
    hashRatesRef.current.clear();
    templateFetchingRef.current = false;
  }, []);

  const startWorkerWithTemplate = useCallback(
    (template: MiningTemplate, intensity: number) => {
      const level = INTENSITY_LEVELS.find((l) => l.value === intensity) ?? INTENSITY_LEVELS[1]!;

      /** Terminate the current pool and spawn a fresh one for `tmpl`. */
      function spawnPool(tmpl: MiningTemplate) {
        // Tear down old pool
        for (const w of workerPoolRef.current) w.terminate();
        workerPoolRef.current = [];
        hashRatesRef.current.clear();
        templateFetchingRef.current = false;
        templateRef.current = tmpl;

        const newPool: Worker[] = [];

        for (let i = 0; i < CORE_COUNT; i++) {
          const worker = makeWorker();
          newPool.push(worker);

          worker.onmessage = async (e: MessageEvent<FromWorkerMsg | WorkerErrorMsg>) => {
            const msg = e.data;

            // ── progress ────────────────────────────────────────────────────
            if (msg.type === "progress") {
              hashRatesRef.current.set(worker, msg.hashRate);
              const total = Array.from(hashRatesRef.current.values()).reduce((s, r) => s + r, 0);
              setHashRate(total);
              // Only log from the first worker to avoid flooding the terminal
              if (worker === newPool[0]) {
                addLog(`nonce:${msg.nonce.slice(0, 12)}  hash:${msg.hash.slice(0, 18)}… miss`);
              }
            }

            // ── share ────────────────────────────────────────────────────────
            if (msg.type === "share") {
              setSessionShares((n) => n + 1);
              if (templateRef.current) {
                const t = templateRef.current;
                submitShareMutation.mutateAsync({
                  minerAddress: t.header.miner,
                  header: t.header,
                  nonce: msg.nonce,
                }).then((result) => {
                  if (result.accepted) setConfirmedShares((n) => n + 1);
                  if (result.blockFound) {
                    addLog(`★ SHARE PROMOTED TO BLOCK #${t.header.number}!`, "found");
                    setSessionBlocks((n) => n + 1);
                  }
                }).catch(() => {
                  // Stale or duplicate shares are expected — silently ignore
                });
              }
            }

            // ── block found ──────────────────────────────────────────────────
            if (msg.type === "found") {
              addLog(`BLOCK FOUND! nonce:${msg.nonce}  hash:${msg.blockHash.slice(0, 18)}… — submitting…`, "found");

              // Stop all OTHER workers immediately — this one already halted itself
              for (const w of workerPoolRef.current) {
                if (w !== worker) w.postMessage({ type: "stop" } satisfies ToWorkerMsg);
              }

              if (!templateRef.current) return;
              const t = templateRef.current;
              const submitPayload: SubmitBlockInput = {
                minerAddress: t.header.miner,
                header: t.header,
                nonce: msg.nonce,
                blockHash: msg.blockHash,
                pendingTxHashes: t.pendingTxHashes,
              };

              try {
                await submitBlock.mutateAsync(submitPayload);
                setSessionBlocks((n) => n + 1);
                addLog(`★ BLOCK FORGED! Fetching next template…`, "found");
              } catch (err) {
                const errorMsg = (err as { message?: string })?.message ?? "Submit failed";
                if (errorMsg.includes("Stale")) {
                  addLog(`Template stale — chain advanced. Refreshing…`, "warn");
                } else {
                  addLog(`Submit error: ${errorMsg}`, "warn");
                }
              }

              if (!miningRef.current) return;
              try {
                const newTemplate = await getMiningTemplate(t.header.miner);
                if (!miningRef.current) return;
                spawnPool(newTemplate);
              } catch {
                addLog("Failed to fetch next template — retrying in 2s…", "warn");
                setTimeout(() => {
                  if (!miningRef.current) return;
                  getMiningTemplate(t.header.miner)
                    .then((nt) => { if (miningRef.current) spawnPool(nt); })
                    .catch(() => stopWorker());
                }, 2000);
              }
            }

            // ── need template ────────────────────────────────────────────────
            if (msg.type === "needTemplate") {
              // Debounce — only one worker in the pool should trigger a fetch
              if (templateFetchingRef.current) return;
              templateFetchingRef.current = true;

              if (!miningRef.current) { templateFetchingRef.current = false; return; }
              const minerAddr = templateRef.current?.header.miner ?? activeWallet?.address;
              if (!minerAddr) { templateFetchingRef.current = false; return; }

              getMiningTemplate(minerAddr).then((nt) => {
                templateFetchingRef.current = false;
                if (!miningRef.current) return;
                // Restart the whole pool on the new template
                spawnPool(nt);
              }).catch(() => {
                templateFetchingRef.current = false;
                setTimeout(() => {
                  if (!miningRef.current) return;
                  const addr = templateRef.current?.header.miner ?? activeWallet?.address;
                  if (!addr) return;
                  getMiningTemplate(addr)
                    .then((nt) => { if (miningRef.current) spawnPool(nt); })
                    .catch(() => stopWorker());
                }, 2000);
              });
            }

            // ── stopped ──────────────────────────────────────────────────────
            if (msg.type === "stopped") {
              worker.terminate();
            }

            // ── error ────────────────────────────────────────────────────────
            if ((msg as unknown as WorkerErrorMsg).type === "error") {
              addLog(`Worker error: ${(msg as unknown as WorkerErrorMsg).message}`, "warn");
              stopWorker();
            }
          };

          worker.onerror = (e) => {
            const detail = [e.message, e.filename ? `${e.filename}:${e.lineno}` : ""].filter(Boolean).join(" ");
            addLog(`Worker load error: ${detail || "(no detail — check browser console)"}`, "warn");
            stopWorker();
          };

          worker.postMessage({
            type: "start",
            header: tmpl.header,
            target: tmpl.target,
            shareTarget: tmpl.shareTarget,
            batchSize: level.batchSize,
          } satisfies ToWorkerMsg);
        }

        workerPoolRef.current = newPool;
      }

      spawnPool(template);
    },
    [addLog, stopWorker, submitBlock, submitShareMutation],
  );

  // ── handlers ────────────────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    if (!activeWallet || miningRef.current) return;
    channelRef.current?.postMessage({ type: "mining_started" });
    setTabBlocked(false);
    miningRef.current = true;
    setIsMining(true);
    setSessionBlocks(0);
    setSessionShares(0);
    setConfirmedShares(0);
    setHashRate(0);
    const level = INTENSITY_LEVELS.find((l) => l.value === selectedIntensity) ?? INTENSITY_LEVELS[1]!;
    addLog(`IGNITE @ ${CORE_COUNT} cores × intensity ${selectedIntensity} (${level.label}) — mining for ${truncate(activeWallet.address)}`);
    try {
      const template = await getMiningTemplate(activeWallet.address);
      if (!miningRef.current) return;
      addLog(`Template: block #${template.header.number} · ${template.pendingTxHashes.length} pending txs · diff ${template.header.difficulty}`);
      startWorkerWithTemplate(template, selectedIntensity);
    } catch (err) {
      addLog(`Failed to fetch template: ${(err as Error).message}`, "warn");
      stopWorker();
    }
  }, [activeWallet, selectedIntensity, addLog, startWorkerWithTemplate, stopWorker]);

  const handleStop = useCallback(() => {
    addLog("HALT — cooling down forge.");
    stopWorker();
    channelRef.current?.postMessage({ type: "mining_stopped" });
  }, [addLog, stopWorker]);

  const handleIntensityChange = useCallback((level: number) => {
    setSelectedIntensity(level);
    if (miningRef.current && templateRef.current) {
      const lvl = INTENSITY_LEVELS.find((l) => l.value === level) ?? INTENSITY_LEVELS[1]!;
      addLog(`Intensity → ${level} (${lvl.label})`);
      // Hot-swap: broadcast new batchSize to all active workers
      for (const w of workerPoolRef.current) {
        w.postMessage({
          type: "start",
          header: templateRef.current.header,
          target: templateRef.current.target,
          shareTarget: templateRef.current.shareTarget,
          batchSize: lvl.batchSize,
        } satisfies ToWorkerMsg);
      }
    }
  }, [addLog]);

  // ── BroadcastChannel: single-tab enforcement ────────────────────────────────
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(MINING_CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (e) => {
      if (e.data?.type === "mining_started") {
        if (miningRef.current) {
          addLog("! Another tab started mining on this device — pausing this tab.", "warn");
          stopWorker();
        }
        setTabBlocked(true);
      }
      if (e.data?.type === "mining_stopped") {
        setTabBlocked(false);
      }
    };
    return () => { ch.close(); channelRef.current = null; };
  }, [addLog, stopWorker]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      miningRef.current = false;
      for (const w of workerPoolRef.current) w.terminate();
      channelRef.current?.postMessage({ type: "mining_stopped" });
    };
  }, []);

  // ── render ───────────────────────────────────────────────────────────────────

  const currentLevel = INTENSITY_LEVELS.find((l) => l.value === selectedIntensity) ?? INTENSITY_LEVELS[1]!;

  return (
    <Shell>
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-border pb-6 gap-4 mb-6">
        <div>
          <h1 className="text-4xl font-display font-bold uppercase tracking-tighter text-foreground mb-2 flex items-center gap-3">
            <Flame className={cn("w-8 h-8", isMining ? "text-primary animate-pulse" : "text-muted-foreground")} />
            Mining Forge
          </h1>
          <p className="text-muted-foreground font-sans text-sm uppercase tracking-widest font-bold">
            {CORE_COUNT} CPU cores · keccak256 proof-of-work · runs in your browser
          </p>
        </div>

        <div className="flex gap-3">
          {isMining ? (
            <Button
              onClick={handleStop}
              className="h-14 px-8 rounded-sm font-display text-lg uppercase tracking-widest bg-destructive text-destructive-foreground hover:bg-destructive/90 animate-pulse"
            >
              SCRAM (Stop)
            </Button>
          ) : (
            <Button
              onClick={handleStart}
              disabled={!activeWallet}
              className="h-14 px-8 rounded-sm font-display text-lg uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90 box-glow"
            >
              IGNITE FORGE
            </Button>
          )}
        </div>
      </div>

      {/* Tab-blocked warning */}
      {tabBlocked && (
        <div className="mb-4 flex items-start gap-3 bg-amber-500/10 border border-amber-500/40 rounded-sm p-4 text-sm">
          <Zap className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-amber-300 font-sans">
            <span className="font-bold">Another tab on this device is already mining.</span>{" "}
            Click <span className="font-bold">Ignite Forge</span> here to switch mining to this tab — the other tab will pause automatically.
          </p>
        </div>
      )}

      {/* Info banner */}
      <div className="mb-6 flex items-start gap-3 bg-secondary/40 border border-border rounded-sm p-4 text-sm">
        <Cpu className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-muted-foreground font-sans leading-relaxed">
          <span className="text-foreground font-bold">Mining uses all {CORE_COUNT} CPU cores on this device.</span>{" "}
          Each core runs a dedicated Web Worker grinding keccak256 hashes in parallel — no page freezes, no GPU required.
          Valid shares are submitted for proportional EMBR payout even if your tab doesn't find the winning block.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: stats + intensity */}
        <div className="lg:col-span-1 space-y-4">
          <Card className={cn(
            "p-6 rounded-sm border transition-colors duration-500",
            isMining ? "border-primary bg-primary/5" : "border-border bg-card/50",
          )}>
            <div className="flex items-center gap-3 mb-5">
              <div className={cn("w-3 h-3 rounded-full", isMining ? "bg-primary animate-pulse box-glow" : "bg-muted")} />
              <span className="font-bold uppercase tracking-widest text-sm font-sans">
                {isMining ? "Forge Active" : "Forge Idle"}
              </span>
              {isMining && (
                <span className={cn("ml-auto text-[10px] font-bold uppercase tracking-widest border rounded-sm px-2 py-0.5 font-sans", currentLevel.color, currentLevel.borderColor, currentLevel.bgColor)}>
                  {currentLevel.label}
                </span>
              )}
            </div>

            <div className="space-y-5">
              <div>
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center gap-2 font-sans">
                  <Zap className="w-3 h-3 text-accent" /> Hash Rate
                </div>
                <div className="font-mono text-4xl font-bold text-glow">
                  {isMining ? hashRate.toLocaleString() : "0"}
                  <span className="text-sm text-muted-foreground ml-1">H/s</span>
                </div>
                {isMining && (
                  <p className="text-[10px] text-muted-foreground font-sans mt-0.5">
                    {CORE_COUNT} workers combined
                  </p>
                )}
              </div>

              <div>
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center gap-2 font-sans">
                  <Database className="w-3 h-3 text-primary" /> Session Blocks
                </div>
                <div className="font-mono text-3xl">{sessionBlocks}</div>
              </div>

              <div>
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center gap-2 font-sans">
                  <Share2 className="w-3 h-3 text-accent" /> Confirmed Shares
                </div>
                <div className="font-mono text-3xl">{confirmedShares}</div>
                <p className="text-[10px] text-muted-foreground font-sans mt-0.5">
                  server-credited this session
                </p>
              </div>

              {(() => {
                const sharesInRound = status?.sharesInRound ?? {};
                const totalShares = Object.values(sharesInRound).reduce((s, n) => s + n, 0);
                const myShares = activeWallet
                  ? (sharesInRound[activeWallet.address.toLowerCase()] ?? 0)
                  : 0;
                const pct = totalShares > 0 ? ((myShares / totalShares) * 100).toFixed(1) : "0.0";
                return (
                  <div>
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center gap-2 font-sans">
                      <Zap className="w-3 h-3 text-yellow-400" /> Est. Payout Cut
                    </div>
                    <div className="font-mono text-3xl">
                      {pct}<span className="text-sm text-muted-foreground ml-1">%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-sans mt-0.5">
                      {myShares} / {totalShares} shares this round
                    </p>
                  </div>
                );
              })()}

              <div className="pt-4 border-t border-border/50">
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1 font-sans">
                  <Hash className="w-3 h-3 inline mr-1" /> Network Difficulty
                </div>
                <div className="font-mono text-xs break-all text-muted-foreground">
                  {status?.difficulty || "…"}
                </div>
              </div>

              <div className="pt-2 border-t border-border/50">
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1 flex items-center gap-1 font-sans">
                  <Cpu className="w-3 h-3" /> Compute Source
                </div>
                <div className="text-xs font-sans text-muted-foreground">
                  {CORE_COUNT} browser WebWorkers (multi-core)<br />
                  <span className="opacity-60">keccak256 · {CORE_COUNT} threads · no GPU</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Intensity selector */}
          <Card className="p-4 rounded-sm border border-border bg-card/50">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2 font-sans">
              <Zap className="w-3 h-3" /> Mining Intensity
            </div>
            <div className="space-y-2">
              {INTENSITY_LEVELS.map((level) => {
                const isActive = selectedIntensity === level.value;
                const isLive   = isMining && selectedIntensity === level.value;
                return (
                  <button
                    key={level.value}
                    onClick={() => handleIntensityChange(level.value)}
                    className={cn(
                      "w-full text-left rounded-sm border px-3 py-2 transition-all duration-150",
                      isActive
                        ? cn("border-2", level.borderColor, level.bgColor)
                        : "border-border/50 hover:border-border bg-transparent hover:bg-secondary/20",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className={cn("font-bold text-xs uppercase tracking-widest font-sans", isActive ? level.color : "text-muted-foreground")}>
                        {level.value}. {level.label}
                      </span>
                      {isLive && (
                        <span className={cn("text-[9px] font-bold uppercase tracking-widest font-sans animate-pulse", level.color)}>
                          LIVE
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-sans mt-0.5 leading-relaxed">
                      {level.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </Card>

          {isMining && activeWallet && (
            <Card className="p-3 border-primary/30 bg-primary/5 rounded-sm">
              <div className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1 font-sans">Payout Address</div>
              <div className="font-mono text-xs break-all text-muted-foreground">{activeWallet.address}</div>
            </Card>
          )}
        </div>

        {/* Terminal */}
        <Card className="lg:col-span-2 border-border bg-black rounded-sm overflow-hidden flex flex-col h-[540px]">
          <div className="bg-secondary/50 border-b border-border p-3 flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-widest font-sans">
            <Terminal className="w-4 h-4" /> Forge Output Terminal
          </div>
          <div className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-0.5 bg-black">
            {logs.length === 0 && (
              <div className="text-muted-foreground/50 italic">Waiting for ignition sequence…</div>
            )}
            {logs.map((log, i) => (
              <div
                key={i}
                className={cn(
                  "leading-relaxed",
                  log.includes("★") || log.includes("BLOCK FORGED") || log.includes("BLOCK FOUND")
                    ? "text-primary font-bold bg-primary/10 px-1 rounded-sm"
                    : log.includes("!")
                    ? "text-amber-400/80"
                    : log.includes("IGNITE") || log.includes("Template:") || log.includes("Intensity")
                    ? "text-accent"
                    : log.includes("HALT")
                    ? "text-muted-foreground"
                    : "text-green-500/70",
                )}
              >
                {log}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
