import React from "react";
import { Shell } from "@/components/layout/shell";
import { useGetBlock } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Box, Hash, Zap, Clock, Activity, FileCode2, Share2 } from "lucide-react";
import { formatEmbr } from "@/lib/utils";

export default function BlockDetail() {
  const { number } = useParams();
  const blockNum = parseInt(number || "0", 10);
  
  const { data: block, isLoading, isError } = useGetBlock(blockNum, {
    query: { enabled: !isNaN(blockNum) }
  });

  return (
    <Shell requireWallet={false}>
      <div className="mb-6">
        <Link href="/blocks" className="inline-flex items-center text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Ledger
        </Link>
        <h1 className="text-4xl font-display font-bold uppercase tracking-tighter text-foreground mb-2 flex items-center gap-3">
          <Box className="w-8 h-8 text-primary" /> Block #{blockNum}
        </h1>
      </div>

      {isLoading && <div className="text-muted-foreground uppercase font-bold tracking-widest animate-pulse">Retrieving Block Data...</div>}
      
      {isError && <div className="text-destructive uppercase font-bold tracking-widest">Failed to retrieve block. It may not exist.</div>}

      {block && (
        <div className="grid gap-6">
          <Card className="border-border bg-card/80 backdrop-blur rounded-sm">
            <CardHeader className="border-b border-border bg-secondary/30">
              <CardTitle className="font-display tracking-tight text-xl uppercase">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <dl className="divide-y divide-border/50 font-mono text-sm">
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Block Hash</dt>
                  <dd className="md:col-span-3 break-all">{block.hash}</dd>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Parent Hash</dt>
                  <dd className="md:col-span-3 break-all text-primary hover:underline">
                    <Link href={`/blocks/${block.number - 1}`}>{block.parentHash}</Link>
                  </dd>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Timestamp</dt>
                  <dd className="md:col-span-3">{new Date(block.timestamp).toLocaleString()} ({block.timestamp})</dd>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Mined By</dt>
                  <dd className="md:col-span-3 bg-secondary/50 w-fit px-2 py-1 rounded-sm border border-border">{block.miner}</dd>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Block Reward</dt>
                  <dd className="md:col-span-3 font-bold text-glow">{formatEmbr(block.reward)} EMBR</dd>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Difficulty</dt>
                  <dd className="md:col-span-3">{parseInt(block.difficulty).toLocaleString()}</dd>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">Nonce</dt>
                  <dd className="md:col-span-3">{block.nonce}</dd>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                  <dt className="text-muted-foreground font-sans font-bold uppercase tracking-widest text-xs md:col-span-1 flex items-center">State Root</dt>
                  <dd className="md:col-span-3 break-all text-xs text-muted-foreground">{block.stateRoot}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {block.payouts && Object.keys(block.payouts).length > 0 && (
            <Card className="border-border bg-card/80 backdrop-blur rounded-sm">
              <CardHeader className="border-b border-border bg-secondary/30">
                <CardTitle className="font-display tracking-tight text-xl uppercase flex items-center gap-2">
                  <Share2 className="w-5 h-5 text-accent" /> Payout Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <dl className="divide-y divide-border/50 font-mono text-sm">
                  {Object.entries(block.payouts).map(([addr, amount]) => (
                    <div key={addr} className="grid grid-cols-1 md:grid-cols-4 p-4 hover:bg-secondary/20 transition-colors">
                      <dt className="md:col-span-3 break-all">{addr}</dt>
                      <dd className="font-bold text-glow text-right">{formatEmbr(amount)} EMBR</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}

          <Card className="border-border bg-card/80 backdrop-blur rounded-sm">
            <CardHeader className="border-b border-border bg-secondary/30 flex flex-row items-center justify-between">
              <CardTitle className="font-display tracking-tight text-xl uppercase">Transactions</CardTitle>
              <div className="bg-primary/20 text-primary border border-primary/50 px-3 py-1 rounded-sm font-mono text-sm font-bold">
                {block.transactionCount}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {block.transactions.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground font-sans uppercase font-bold tracking-widest text-xs">
                  No transactions in this block (Empty block)
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {block.transactions.map((tx) => (
                    <div key={tx.hash} className="p-4 hover:bg-secondary/20 transition-colors">
                      <div className="flex flex-col md:flex-row justify-between gap-4 mb-2">
                        <div className="flex items-center gap-2">
                          {tx.to === null ? (
                            <span className="bg-accent/20 text-accent border border-accent/50 text-[10px] px-2 py-0.5 rounded-sm uppercase font-bold tracking-widest flex items-center gap-1">
                              <FileCode2 className="w-3 h-3" /> Contract Deploy
                            </span>
                          ) : (
                            <span className="bg-secondary text-foreground border border-border text-[10px] px-2 py-0.5 rounded-sm uppercase font-bold tracking-widest flex items-center gap-1">
                              <Activity className="w-3 h-3" /> Transfer
                            </span>
                          )}
                          <Link href={`/transactions/${tx.hash}`} className="font-mono text-primary text-sm hover:underline font-bold truncate max-w-[200px] md:max-w-md">
                            {tx.hash}
                          </Link>
                        </div>
                        <div className="font-mono font-bold text-glow">
                          {formatEmbr(tx.value)} EMBR
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono text-muted-foreground">
                        <div><span className="font-sans uppercase font-bold mr-2 text-[10px]">From:</span>{tx.from}</div>
                        <div>
                          <span className="font-sans uppercase font-bold mr-2 text-[10px]">To:</span>
                          {tx.to === null ? (
                            <span className="text-accent italic">{tx.contractAddress || "Pending Contract"}</span>
                          ) : (
                            tx.to
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Shell>
  );
}
