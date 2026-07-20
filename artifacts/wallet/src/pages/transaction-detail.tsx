import React from "react";
import { Shell } from "@/components/layout/shell";
import { useGetTransaction } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ArrowLeft, ArrowLeftRight, CheckCircle2, XCircle, Loader2, AlertTriangle, Code2 } from "lucide-react";
import { formatEmbr } from "@/lib/utils";
import { decodeCalldata, formatUint256Display } from "@/lib/calldata-decoder";

export default function TransactionDetail() {
  const { hash } = useParams();
  
  const { data: tx, isLoading, isError } = useGetTransaction(hash || "", {
    query: { 
      enabled: !!hash,
      refetchInterval: (query) => (query.state.data as {status?: string} | undefined)?.status === 'pending' ? 2000 : false 
    }
  });

  return (
    <Shell requireWallet={false}>
      <div className="mb-6">
        <Link href="/transactions" className="inline-flex items-center text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to History
        </Link>
        <h1 className="text-4xl font-display font-bold uppercase tracking-tighter text-foreground mb-2 flex items-center gap-3">
          <ArrowLeftRight className="w-8 h-8 text-primary" /> TX Details
        </h1>
      </div>

      {isLoading && <div className="text-muted-foreground uppercase font-bold tracking-widest animate-pulse">Scanning ledgers...</div>}
      
      {isError && <div className="text-destructive uppercase font-bold tracking-widest">Failed to retrieve transaction. It may not exist.</div>}

      {tx && (
        <div className="grid gap-6">
          <Card className="border-border bg-card/80 backdrop-blur rounded-sm">
            <CardHeader className="border-b border-border bg-secondary/30 flex flex-row items-center justify-between">
              <CardTitle className="font-display tracking-tight text-xl uppercase">Payload</CardTitle>
              <div className="flex items-center gap-2">
                {tx.status === 'success' && <span className="bg-primary/20 text-primary border border-primary/50 px-3 py-1 rounded-sm text-xs font-bold uppercase tracking-widest flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> Success</span>}
                {tx.status === 'pending' && <span className="bg-accent/20 text-accent border border-accent/50 px-3 py-1 rounded-sm text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/> In Mempool</span>}
                {tx.status === 'failed' && <span className="bg-destructive/20 text-destructive border border-destructive/50 px-3 py-1 rounded-sm text-xs font-bold uppercase tracking-widest flex items-center gap-2"><XCircle className="w-4 h-4"/> Failed</span>}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <dl className="divide-y divide-border/50 font-mono text-sm">
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">TX Hash</dt>
                  <dd className="md:col-span-3 break-all font-bold text-primary">{tx.hash}</dd>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Block Number</dt>
                  <dd className="md:col-span-3">
                    {tx.blockNumber ? (
                      <Link href={`/blocks/${tx.blockNumber}`} className="text-primary hover:underline font-bold">#{tx.blockNumber}</Link>
                    ) : (
                      <span className="text-muted-foreground italic">Pending...</span>
                    )}
                  </dd>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">From</dt>
                  <dd className="md:col-span-3 break-all bg-secondary/50 w-fit px-2 py-1 rounded-sm border border-border">{tx.from}</dd>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">To</dt>
                  <dd className="md:col-span-3 break-all">
                    {tx.to ? (
                      <span className="bg-secondary/50 w-fit px-2 py-1 rounded-sm border border-border">{tx.to}</span>
                    ) : (
                      <span className="text-accent italic font-sans font-bold uppercase text-xs tracking-widest">Contract Creation</span>
                    )}
                  </dd>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Value</dt>
                  <dd className="md:col-span-3 font-bold text-glow text-xl">{formatEmbr(tx.value)} EMBR</dd>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Gas Limit</dt>
                  <dd className="md:col-span-3">{parseInt(tx.gasLimit).toLocaleString()}</dd>
                </div>
                {tx.gasUsed && (
                  <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                    <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Gas Used</dt>
                    <dd className="md:col-span-3">{parseInt(tx.gasUsed).toLocaleString()}</dd>
                  </div>
                )}
                {tx.contractAddress && (
                  <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors bg-accent/5">
                    <dt className="text-accent font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Created Contract</dt>
                    <dd className="md:col-span-3 break-all font-bold text-accent border border-accent/30 bg-accent/10 px-2 py-1 rounded-sm w-fit">{tx.contractAddress}</dd>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Nonce</dt>
                  <dd className="md:col-span-3">{tx.nonce}</dd>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Submission Time</dt>
                  <dd className="md:col-span-3">{new Date(tx.createdAt).toLocaleString()}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {(tx.data && tx.data !== "0x") && (() => {
            const decoded = decodeCalldata(tx.data);
            if (decoded) {
              return (
                <Card className="border-border bg-card/80 backdrop-blur rounded-sm">
                  <CardHeader className="border-b border-border bg-secondary/30 flex flex-row items-center gap-3">
                    <Code2 className="w-5 h-5 text-primary" />
                    <CardTitle className="font-display tracking-tight text-xl uppercase">
                      Decoded Input —{" "}
                      <span className="text-primary">{decoded.functionName}</span>
                      <span className="text-muted-foreground text-sm font-mono ml-2 normal-case tracking-normal">
                        {decoded.selector}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <dl className="divide-y divide-border/50 font-mono text-sm">
                      {decoded.params.map((p) => {
                        const fmt = p.type === "uint256"
                          ? formatUint256Display(p.value, p.name)
                          : null;
                        return (
                          <div key={p.name} className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                            <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-start pt-1">
                              {p.name}
                              <span className="ml-1 text-muted-foreground/50 font-mono normal-case font-normal tracking-normal text-xs">
                                {p.type}
                              </span>
                            </dt>
                            <dd className="md:col-span-3 break-all">
                              {p.type === "address" ? (
                                <Link
                                  href={`/wallets/${p.value}`}
                                  className="bg-secondary/50 px-2 py-1 rounded-sm border border-border hover:border-primary/50 hover:bg-primary/10 transition-colors inline-block"
                                >
                                  {p.value}
                                </Link>
                              ) : fmt ? (
                                <span className="font-bold text-foreground">
                                  {fmt.display}
                                  {fmt.hint && (
                                    <span className="ml-2 text-muted-foreground text-xs font-normal">
                                      ({fmt.hint})
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-foreground">{p.value}</span>
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                    {/* Raw hex toggle */}
                    <details className="border-t border-border/50">
                      <summary className="p-3 text-xs text-muted-foreground font-sans uppercase tracking-widest cursor-pointer hover:text-foreground transition-colors select-none">
                        Raw calldata
                      </summary>
                      <div className="bg-black text-muted-foreground p-4 font-mono text-xs break-all max-h-40 overflow-y-auto border-t border-border">
                        {tx.data}
                      </div>
                    </details>
                  </CardContent>
                </Card>
              );
            }
            // Unknown function — fall back to raw hex display
            return (
              <Card className="border-border bg-card/80 backdrop-blur rounded-sm">
                <CardHeader className="border-b border-border bg-secondary/30">
                  <CardTitle className="font-display tracking-tight text-xl uppercase">Input Data</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="bg-black text-muted-foreground p-4 rounded-sm font-mono text-xs break-all max-h-64 overflow-y-auto border border-border">
                    {tx.data}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {tx.error && (
            <Card className="border-destructive bg-destructive/5 rounded-sm">
              <CardHeader className="border-b border-destructive/20 bg-destructive/10">
                <CardTitle className="font-display tracking-tight text-xl uppercase text-destructive flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" /> Revert Reason
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="text-destructive font-mono text-sm">
                  {tx.error}
                </div>
              </CardContent>
            </Card>
          )}

          {tx.returnData && tx.returnData !== "0x" && (
            <Card className="border-border bg-card/80 backdrop-blur rounded-sm">
              <CardHeader className="border-b border-border bg-secondary/30">
                <CardTitle className="font-display tracking-tight text-xl uppercase">Return Data</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="bg-black text-primary p-4 rounded-sm font-mono text-xs break-all border border-border">
                  {tx.returnData}
                </div>
              </CardContent>
            </Card>
          )}

        </div>
      )}
    </Shell>
  );
}
