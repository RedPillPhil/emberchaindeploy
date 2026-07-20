import React, { useState, useMemo } from "react";
import { Shell } from "@/components/layout/shell";
import { useListTransactions } from "@workspace/api-client-react";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { Link, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ArrowLeftRight,
  Activity,
  FileCode2,
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
  ExternalLink,
  X,
} from "lucide-react";
import { formatHash, formatEmbr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export default function Transactions() {
  const { activeWallet } = useActiveWallet();
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");

  // Derive filter mode from query string
  const trimmed = query.trim();
  const isAddress = ADDRESS_RE.test(trimmed);
  const isFullHash = HASH_RE.test(trimmed);
  const addressFilter = isAddress ? trimmed : undefined;

  const { data: transactions, isLoading } = useListTransactions(
    { limit: 100, address: addressFilter },
    { query: { refetchInterval: 5000 } },
  );

  // Client-side filter for partial/full hash queries
  const displayed = useMemo(() => {
    if (!transactions) return [];
    if (!trimmed || isAddress) return transactions;
    return transactions.filter((tx) =>
      tx.hash.toLowerCase().includes(trimmed.toLowerCase()),
    );
  }, [transactions, trimmed, isAddress]);

  const myAddressFilter = !trimmed && activeWallet;

  return (
    <Shell requireWallet={false}>
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-border pb-6 gap-4 mb-6">
        <div>
          <h1 className="text-4xl font-display font-bold uppercase tracking-tighter text-foreground mb-2 flex items-center gap-3">
            <ArrowLeftRight className="w-8 h-8 text-primary" /> Transactions
          </h1>
          <p className="text-muted-foreground font-sans text-sm uppercase tracking-widest font-bold">
            Activity stream across the network.
          </p>
        </div>
      </div>

      {/* Search bar */}
      <div className="mb-4 flex flex-col gap-2">
        <div className="relative flex items-center">
          <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by transaction hash or address…"
            className="pl-9 pr-9 rounded-sm border-border bg-background/60 font-mono text-sm focus-visible:ring-primary/50 placeholder:font-sans placeholder:text-muted-foreground placeholder:text-xs placeholder:uppercase placeholder:tracking-widest"
          />
          {trimmed && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Context chips */}
        <div className="flex flex-wrap items-center gap-2 min-h-[28px]">
          {/* My activity shortcut */}
          {activeWallet && !trimmed && (
            <button
              onClick={() => setQuery(activeWallet.address)}
              className="text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground border border-border rounded-sm px-2 py-1 hover:border-primary/50 hover:text-primary transition-colors"
            >
              My activity
            </button>
          )}

          {/* Address filter active badge */}
          {isAddress && (
            <span className="text-[10px] font-sans font-bold uppercase tracking-widest text-primary border border-primary/40 bg-primary/10 rounded-sm px-2 py-1">
              Filtered by address
            </span>
          )}

          {/* Full hash — offer direct navigation */}
          {isFullHash && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] rounded-sm border-accent/40 text-accent hover:bg-accent/10 font-bold uppercase tracking-widest gap-1"
              onClick={() => navigate(`/transactions/${trimmed}`)}
            >
              <ExternalLink className="w-3 h-3" /> View transaction
            </Button>
          )}

          {/* No results hint */}
          {trimmed && !isLoading && displayed.length === 0 && (
            <span className="text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground">
              No matches
            </span>
          )}

          {/* Result count when filtering */}
          {trimmed && !isLoading && displayed.length > 0 && (
            <span className="text-[10px] font-sans font-bold uppercase tracking-widest text-muted-foreground">
              {displayed.length} result{displayed.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      <Card className="border-border bg-card/80 backdrop-blur rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-sm">
            <thead className="bg-secondary/50 border-b border-border font-sans text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="p-4 font-bold">Status</th>
                <th className="p-4 font-bold">Hash</th>
                <th className="p-4 font-bold">Type</th>
                <th className="p-4 font-bold">From</th>
                <th className="p-4 font-bold">To</th>
                <th className="p-4 font-bold text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading && (
                <tr>
                  <td
                    colSpan={6}
                    className="p-8 text-center text-muted-foreground font-sans uppercase font-bold tracking-widest"
                  >
                    Scanning mempool and ledger...
                  </td>
                </tr>
              )}

              {!isLoading && displayed.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="p-8 text-center text-muted-foreground font-sans uppercase font-bold tracking-widest"
                  >
                    {trimmed ? "No transactions match your search." : "No transactions found."}
                  </td>
                </tr>
              )}

              {displayed.map((tx) => (
                <tr key={tx.hash} className="hover:bg-secondary/20 transition-colors group">
                  <td className="p-4">
                    {tx.status === "success" && <CheckCircle2 className="w-5 h-5 text-primary" />}
                    {tx.status === "pending" && <Loader2 className="w-5 h-5 text-accent animate-spin" />}
                    {tx.status === "failed" && <XCircle className="w-5 h-5 text-destructive" />}
                  </td>
                  <td className="p-4">
                    <Link
                      href={`/transactions/${tx.hash}`}
                      className="text-primary font-bold hover:underline"
                    >
                      <HighlightMatch text={tx.hash} query={!isAddress ? trimmed : ""} short />
                    </Link>
                  </td>
                  <td className="p-4">
                    {tx.to === null ? (
                      <span className="text-accent flex items-center gap-1 font-sans text-[10px] uppercase font-bold tracking-widest">
                        <FileCode2 className="w-3 h-3" /> Deploy
                      </span>
                    ) : (
                      <span className="text-muted-foreground flex items-center gap-1 font-sans text-[10px] uppercase font-bold tracking-widest">
                        <Activity className="w-3 h-3" /> Transfer
                      </span>
                    )}
                  </td>
                  <td className="p-4 text-muted-foreground group-hover:text-foreground transition-colors">
                    <AddressCell
                      address={tx.from}
                      myAddress={activeWallet?.address}
                      query={isAddress ? trimmed : ""}
                      onClick={setQuery}
                    />
                  </td>
                  <td className="p-4 text-muted-foreground group-hover:text-foreground transition-colors">
                    {tx.to === null ? (
                      <span className="italic opacity-50">Contract</span>
                    ) : (
                      <AddressCell
                        address={tx.to}
                        myAddress={activeWallet?.address}
                        query={isAddress ? trimmed : ""}
                        onClick={setQuery}
                      />
                    )}
                  </td>
                  <td className="p-4 text-right font-bold text-foreground">{formatEmbr(tx.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Shell>
  );
}

/** Highlights the matched portion of a hash/address. Short mode shows formatHash unless there's an active query. */
function HighlightMatch({
  text,
  query,
  short = false,
}: {
  text: string;
  query: string;
  short?: boolean;
}) {
  if (!query || !text.toLowerCase().includes(query.toLowerCase())) {
    return <span>{short ? formatHash(text, 6) : text}</span>;
  }
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  return (
    <span title={text}>
      {text.slice(0, idx)}
      <mark className="bg-primary/30 text-primary rounded-sm">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </span>
  );
}

/** Address cell that highlights when it matches the query and can be clicked to filter. */
function AddressCell({
  address,
  myAddress,
  query,
  onClick,
}: {
  address: string;
  myAddress?: string;
  query: string;
  onClick: (v: string) => void;
}) {
  if (myAddress && address.toLowerCase() === myAddress.toLowerCase()) {
    return <span className="text-primary font-bold">YOU</span>;
  }
  const isMatch = query && address.toLowerCase() === query.toLowerCase();
  return (
    <button
      title={`Filter by ${address}`}
      onClick={() => onClick(address)}
      className={cn(
        "hover:text-primary hover:underline transition-colors text-left",
        isMatch && "text-primary font-bold",
      )}
    >
      {formatHash(address, 6)}
    </button>
  );
}
