import React, { useState, useEffect, useRef, useCallback } from "react";
import { Shell } from "@/components/layout/shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useActiveWallet } from "@/hooks/use-active-wallet";
import { useToast } from "@/hooks/use-toast";
import { useListExchangeListings } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import {
  CreditCard,
  ArrowRight,
  Store,
  CheckCircle2,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Info,
  X,
  Wallet,
  ShieldCheck,
  Zap,
} from "lucide-react";

// ── types ─────────────────────────────────────────────────────────────────────

interface OnrampConfig {
  provider: "transak";
  apiKey: string;
  staging: boolean;
  widgetUrl: string;
  rampUrl: string;
}

// ── currency definitions ──────────────────────────────────────────────────────

interface CurrencyDef {
  id: string;               // exchange currency key
  label: string;            // display name
  transakCurrency: string;  // Transak's crypto symbol
  transakNetwork: string;   // Transak's network slug
  addressLabel: string;
  addressPlaceholder: string;
  addressNote: string;
  evmCompatible: boolean;   // show "Use wallet" shortcut?
  badgeClass: string;       // badge colour
  verifyChain: string;      // e.g. "Ethereum mainnet"
  priceSymbol: string;
  moonpaySlug: string;      // moonpay buy URL fragment
}

const CURRENCIES: CurrencyDef[] = [
  {
    id: "ETH",
    label: "ETH",
    transakCurrency: "ETH",
    transakNetwork: "ethereum",
    addressLabel: "Your Ethereum receive address",
    addressPlaceholder: "0x… (Ethereum mainnet)",
    addressNote: "ETH will land here — use your MetaMask address or any Ethereum mainnet wallet you control.",
    evmCompatible: true,
    badgeClass: "bg-indigo-500/20 text-indigo-400 border-indigo-500/40",
    verifyChain: "Ethereum",
    priceSymbol: "Ξ",
    moonpaySlug: "eth",
  },
  {
    id: "USDT",
    label: "USDT",
    transakCurrency: "USDT",
    transakNetwork: "ethereum",
    addressLabel: "Your Ethereum receive address (USDT ERC-20)",
    addressPlaceholder: "0x… (Ethereum mainnet)",
    addressNote: "USDT (ERC-20) will land at this address. The exchange also accepts USDT on Tron, BSC, and Polygon — the Transak widget lets you choose the network.",
    evmCompatible: true,
    badgeClass: "bg-green-500/20 text-green-400 border-green-500/40",
    verifyChain: "Ethereum / Tron / BSC / Polygon",
    priceSymbol: "$",
    moonpaySlug: "usdt",
  },
  {
    id: "BTC",
    label: "BTC",
    transakCurrency: "BTC",
    transakNetwork: "mainnet",
    addressLabel: "Your Bitcoin receive address",
    addressPlaceholder: "bc1… or 3… or 1… (Bitcoin mainnet)",
    addressNote: "BTC will land at this Bitcoin address. Native SegWit (bc1…) addresses are recommended.",
    evmCompatible: false,
    badgeClass: "bg-amber-500/20 text-amber-400 border-amber-500/40",
    verifyChain: "Bitcoin",
    priceSymbol: "₿",
    moonpaySlug: "btc",
  },
  {
    id: "SOL",
    label: "SOL",
    transakCurrency: "SOL",
    transakNetwork: "solana",
    addressLabel: "Your Solana receive address",
    addressPlaceholder: "Base58 Solana address",
    addressNote: "SOL will land at this Solana address — use your Phantom, Solflare, or any Solana wallet address.",
    evmCompatible: false,
    badgeClass: "bg-purple-500/20 text-purple-400 border-purple-500/40",
    verifyChain: "Solana",
    priceSymbol: "◎",
    moonpaySlug: "sol",
  },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, front = 10, back = 8): string {
  if (s.length <= front + back + 3) return s;
  return s.slice(0, front) + "…" + s.slice(-back);
}

// ── Transak iframe modal ──────────────────────────────────────────────────────

function TransakModal({
  config,
  currency,
  receiveAddress,
  onClose,
  onSuccess,
}: {
  config: OnrampConfig;
  currency: CurrencyDef;
  receiveAddress: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const widgetUrl = (() => {
    const params = new URLSearchParams({
      defaultCryptoCurrency: currency.transakCurrency,
      defaultNetwork: currency.transakNetwork,
      themeColor: "FF6B35",
      hideMenu: "true",
      productsAvailed: "BUY",
      exchangeScreenTitle: `Buy ${currency.label} for Emberchain`,
    });
    if (config.apiKey) params.set("apiKey", config.apiKey);
    if (receiveAddress) {
      params.set("walletAddress", receiveAddress);
      params.set("disableWalletAddressForm", "true");
    }
    return `${config.widgetUrl}?${params.toString()}`;
  })();

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.origin.includes("transak.com")) return;
      const data = e.data as { event_id?: string };
      if (
        data?.event_id === "TRANSAK_ORDER_SUCCESSFUL" ||
        data?.event_id === "TRANSAK_ORDER_COMPLETED"
      ) {
        onSuccess();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onSuccess]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg h-[680px] bg-card border border-border rounded-sm shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" />
            <span className="font-bold text-sm uppercase text-foreground">
              Buy {currency.label}
              {config.staging && <span className="text-xs text-amber-400 font-normal ml-1">(test mode)</span>}
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <iframe
          ref={iframeRef}
          src={widgetUrl}
          className="flex-1 w-full border-0 rounded-b-sm"
          allow="camera;microphone;payment;accelerometer;gyroscope;geolocation"
          title="Transak On-Ramp"
        />
      </div>
    </div>
  );
}

// ── step card ─────────────────────────────────────────────────────────────────

function StepCard({ n, title, desc, done, active }: {
  n: string; title: string; desc: string; done?: boolean; active?: boolean;
}) {
  return (
    <div className={`flex gap-3 p-3 rounded-sm border transition-all ${
      done ? "border-green-500/40 bg-green-500/5"
           : active ? "border-primary/40 bg-primary/5"
           : "border-border bg-secondary/20"
    }`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
        done ? "bg-green-500/20 text-green-400 border border-green-500/40"
             : active ? "bg-primary/20 text-primary border border-primary/40"
             : "bg-secondary text-muted-foreground border border-border"
      }`}>
        {done ? <CheckCircle2 className="w-4 h-4" /> : n}
      </div>
      <div>
        <p className={`text-xs font-bold uppercase ${done ? "text-green-400" : active ? "text-primary" : "text-muted-foreground"}`}>
          {title}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

// ── currency picker ───────────────────────────────────────────────────────────

function CurrencyPicker({
  selected,
  onChange,
}: {
  selected: CurrencyDef;
  onChange: (c: CurrencyDef) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest">
        Which currency do you want to buy?
      </p>
      <div className="grid grid-cols-4 gap-2">
        {CURRENCIES.map((c) => {
          const isSelected = c.id === selected.id;
          return (
            <button
              key={c.id}
              onClick={() => onChange(c)}
              className={`flex flex-col items-center gap-1 py-3 px-2 rounded-sm border text-xs font-bold uppercase tracking-wide transition-all ${
                isSelected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/30 hover:text-foreground"
              }`}
            >
              <span className="text-base leading-none">{currencyIcon(c.id)}</span>
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function currencyIcon(id: string): string {
  switch (id) {
    case "ETH":  return "Ξ";
    case "USDT": return "₮";
    case "BTC":  return "₿";
    case "SOL":  return "◎";
    default:     return "?";
  }
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function OnRamp() {
  const { activeWallet } = useActiveWallet();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [config, setConfig] = useState<OnrampConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyDef>(CURRENCIES[0]);
  const [receiveAddress, setReceiveAddress] = useState("");

  const [widgetOpen, setWidgetOpen] = useState(false);
  const [purchaseDone, setPurchaseDone] = useState(false);

  // All open listings, filtered to the selected currency
  const { data: listings = [] } = useListExchangeListings({ status: "open" });
  const matchingListings = listings.filter((l) => l.currency === selectedCurrency.id);

  useEffect(() => {
    fetch("/api/onramp/config")
      .then((r) => r.json())
      .then((d) => { setConfig(d as OnrampConfig); setConfigLoading(false); })
      .catch(() => setConfigLoading(false));
  }, []);

  // When currency changes, clear address (different format) and reset purchase done
  const handleCurrencyChange = (c: CurrencyDef) => {
    setSelectedCurrency(c);
    setReceiveAddress("");
    setPurchaseDone(false);
    setWidgetOpen(false);
  };

  const handleSuccess = useCallback(() => {
    setWidgetOpen(false);
    setPurchaseDone(true);
    toast({
      title: `${selectedCurrency.label} purchase initiated!`,
      description: `Your ${selectedCurrency.label} will arrive shortly. Head to the Exchange to buy EMBR.`,
    });
  }, [toast, selectedCurrency.label]);

  const openWidget = () => {
    if (!receiveAddress.trim()) {
      toast({
        variant: "destructive",
        title: `Enter your ${selectedCurrency.label} address`,
        description: `We need to know where to send your ${selectedCurrency.label}.`,
      });
      return;
    }
    setWidgetOpen(true);
  };

  const c = selectedCurrency;

  return (
    <Shell requireWallet={false}>
      {widgetOpen && config && (
        <TransakModal
          config={config}
          currency={c}
          receiveAddress={receiveAddress}
          onClose={() => setWidgetOpen(false)}
          onSuccess={handleSuccess}
        />
      )}

      <div className="max-w-2xl mx-auto space-y-6">
        {/* header */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-sm bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
            <CreditCard className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl tracking-tight text-foreground uppercase">
              Buy EMBR
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Get {c.label} with your card or bank, then trade it for EMBR on the peer-to-peer exchange — the chain verifies every payment automatically.
            </p>
          </div>
        </div>

        {/* how it works */}
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest">How it works</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <StepCard
              n="1"
              title={`Get ${c.label}`}
              desc={`Buy ${c.label} with a credit card, debit card, or bank transfer via Transak — directly to your ${c.label === "BTC" ? "Bitcoin" : c.label === "SOL" ? "Solana" : "Ethereum"} wallet.`}
              done={purchaseDone}
              active={!purchaseDone}
            />
            <StepCard
              n="2"
              title="Find a listing"
              desc={`Browse open EMBR listings on the Exchange that accept ${c.label} as payment.`}
              done={false}
              active={purchaseDone}
            />
            <StepCard
              n="3"
              title="Submit & claim"
              desc={`Pay the seller's ${c.label} address, paste the tx hash, and EMBR is released automatically after on-chain verification.`}
              done={false}
              active={false}
            />
          </div>
        </div>

        {/* purchase complete banner */}
        {purchaseDone && (
          <div className="p-4 rounded-sm border border-green-500/40 bg-green-500/5 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-green-400 text-sm">{c.label} purchase initiated!</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Your {c.label} will arrive in your wallet within a few minutes. Once it lands, head to the Exchange and pick an open listing that accepts {c.label}.
              </p>
            </div>
            <Button size="sm" onClick={() => navigate("/exchange")} className="shrink-0 gap-1.5">
              <Store className="w-4 h-4" /> Exchange
            </Button>
          </div>
        )}

        {/* step 1 card */}
        <Card className="border-border bg-card">
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/20 border border-primary/40 text-primary text-xs font-bold flex items-center justify-center">1</div>
              <h2 className="font-bold text-sm uppercase text-foreground tracking-wide">Get {c.label} with your card</h2>
              {config?.staging && (
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40 text-xs ml-auto">Test mode</Badge>
              )}
            </div>

            {/* currency selector */}
            <CurrencyPicker selected={c} onChange={handleCurrencyChange} />

            {/* receive address */}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-muted-foreground font-bold">
                {c.addressLabel}
              </Label>
              <div className="flex gap-2">
                <Input
                  value={receiveAddress}
                  onChange={(e) => setReceiveAddress(e.target.value)}
                  placeholder={c.addressPlaceholder}
                  className="font-mono text-sm flex-1"
                />
                {c.evmCompatible && activeWallet && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setReceiveAddress(activeWallet.address)}
                    title="Use your EMBR wallet address (valid for EVM chains)"
                    className="shrink-0 text-xs"
                  >
                    <Wallet className="w-3.5 h-3.5 mr-1" /> Use wallet
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground flex items-start gap-1">
                <Info className="w-3 h-3 shrink-0 mt-0.5" />
                {c.addressNote}
              </p>
            </div>

            {/* buy button */}
            <Button
              onClick={openWidget}
              disabled={configLoading || !receiveAddress.trim()}
              className="w-full gap-2"
              size="lg"
            >
              {configLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</>
              ) : (
                <><CreditCard className="w-4 h-4" /> Buy {c.label} — Card / Bank</>
              )}
            </Button>

            {/* trust badges */}
            <div className="flex flex-wrap gap-3">
              {[
                { icon: ShieldCheck, label: "KYC'd by Transak" },
                { icon: Zap,         label: "Instant card payments" },
                { icon: Info,        label: "170+ countries" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="w-3.5 h-3.5 text-primary" /> {label}
                </div>
              ))}
            </div>

            {config?.staging && (
              <div className="p-2.5 rounded-sm border border-amber-500/30 bg-amber-500/5 text-xs text-amber-400/80 leading-relaxed">
                ⚠️ <strong>Transak test mode</strong> — no real money charged.
                Add a <code className="font-mono">TRANSAK_API_KEY</code> Replit secret to enable live payments (free at{" "}
                <a href="https://transak.com" target="_blank" rel="noopener noreferrer" className="underline">transak.com</a>).
              </div>
            )}

            {/* alternative providers */}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground transition-colors font-bold uppercase tracking-wide">
                Alternative on-ramp providers
              </summary>
              <div className="mt-2 space-y-2 pl-2 border-l border-border">
                {[
                  {
                    name: "Ramp Network",
                    href: `https://app.ramp.network/?defaultAsset=${c.transakCurrency}`,
                    note: `Buy ${c.label} directly; no account required.`,
                  },
                  {
                    name: "MoonPay",
                    href: `https://www.moonpay.com/buy/${c.moonpaySlug}`,
                    note: `Widely available; card & bank supported.`,
                  },
                  {
                    name: "Coinbase Pay",
                    href: "https://pay.coinbase.com",
                    note: "US/EU users; instant with Coinbase account.",
                  },
                ].map(({ name, href, note }) => (
                  <div key={name}>
                    <a href={href} target="_blank" rel="noopener noreferrer"
                       className="text-primary hover:underline font-bold inline-flex items-center gap-1">
                      {name} <ExternalLink className="w-3 h-3" />
                    </a>
                    <span className="ml-1">{note}</span>
                  </div>
                ))}
                <p className="text-muted-foreground/60 mt-2">
                  Any provider works as long as {c.label} lands at your address on the correct network.
                </p>
              </div>
            </details>
          </CardContent>
        </Card>

        {/* step 2 card */}
        <Card className="border-border bg-card">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full border text-xs font-bold flex items-center justify-center ${
                  purchaseDone
                    ? "bg-primary/20 border-primary/40 text-primary"
                    : "bg-secondary border-border text-muted-foreground"
                }`}>2</div>
                <h2 className="font-bold text-sm uppercase text-foreground tracking-wide">
                  Trade {c.label} for EMBR on the Exchange
                </h2>
              </div>
              <Button
                size="sm"
                variant={purchaseDone ? "default" : "outline"}
                onClick={() => navigate("/exchange")}
                className="shrink-0 gap-1.5"
              >
                <Store className="w-4 h-4" /> Exchange <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              Once your {c.label} arrives, go to the Exchange, find a listing that accepts {c.label}, reserve it, and send
              your {c.label} to the seller's address. The chain will verify the payment on {c.verifyChain} and release your EMBR automatically.
            </p>

            {/* live listings preview */}
            {matchingListings.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest">
                  {matchingListings.length} open listing{matchingListings.length !== 1 ? "s" : ""} accepting {c.label} right now
                </p>
                {matchingListings.slice(0, 3).map((listing) => {
                  const embrAmt = Number(BigInt(listing.amountEmbr)) / 1e18;
                  return (
                    <div
                      key={listing.id}
                      className="flex items-center gap-3 p-3 rounded-sm border border-border bg-secondary/30 hover:border-primary/30 transition-colors cursor-pointer"
                      onClick={() => navigate("/exchange")}
                    >
                      <Badge className={`${c.badgeClass} text-xs font-bold uppercase shrink-0`}>
                        {c.label}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-foreground text-sm">
                          {embrAmt.toLocaleString("en-US", { maximumFractionDigits: 4 })} EMBR
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {truncate(listing.sellerAddress)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-foreground text-sm">
                          {c.priceSymbol}{listing.priceAmount} {c.label}
                        </p>
                        <p className="text-xs text-muted-foreground">asking price</p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </div>
                  );
                })}
                {matchingListings.length > 3 && (
                  <p className="text-xs text-muted-foreground text-center">
                    +{matchingListings.length - 3} more on the Exchange →
                  </p>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-sm border border-border bg-secondary/20 text-sm text-muted-foreground flex items-start gap-2">
                <Store className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  No {c.label} listings open right now — try a different currency above, check back after getting your {c.label},
                  or{" "}
                  <button onClick={() => navigate("/exchange")} className="text-primary underline-offset-2 hover:underline">
                    list EMBR yourself
                  </button>{" "}
                  to attract buyers.
                </span>
              </div>
            )}

            {/* flow diagram */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap pt-1">
              {[
                `Your ${c.label} wallet`,
                "→",
                `${c.label} to seller`,
                "→",
                `Verified on ${c.verifyChain}`,
                "→",
                "EMBR to your wallet",
              ].map((step, i) => (
                <span
                  key={i}
                  className={
                    step === "→"
                      ? "text-primary font-bold"
                      : "font-mono bg-secondary/60 px-1.5 py-0.5 rounded-sm border border-border"
                  }
                >
                  {step}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* FAQ */}
        <Card className="border-border bg-card">
          <CardContent className="p-5 space-y-4">
            <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Common questions</p>
            {[
              {
                q: "Do I need a Coinbase or Binance account?",
                a: "No. Transak lets you buy crypto with a card or bank transfer without creating an exchange account. Your coins go straight to the address you enter.",
              },
              {
                q: "How long does it take to arrive?",
                a: "Card purchases typically settle in a few minutes. Bitcoin can take 10–30 minutes depending on network congestion. Bank transfers can take 1–3 business days.",
              },
              {
                q: "Why is there no direct EMBR purchase?",
                a: "EMBR is a newly minted chain with no established market price. The peer-to-peer exchange lets the market discover a natural price through real trades.",
              },
              {
                q: "What if there are no listings for my chosen currency?",
                a: "Try selecting a different currency — ETH tends to have the most listings. You can also mine EMBR directly for free by clicking FORGE (MINE) in the sidebar.",
              },
              {
                q: "Is my Ethereum address the same as my EMBR address?",
                a: "EMBR uses the same secp256k1 address format as Ethereum (0x…), so the same private key works on both chains. This is why you can use 'Use wallet' for ETH and USDT purchases.",
              },
            ].map(({ q, a }) => (
              <details key={q} className="group">
                <summary className="cursor-pointer text-sm font-bold text-foreground hover:text-primary transition-colors list-none flex items-center justify-between">
                  {q}
                  <span className="text-muted-foreground group-open:rotate-90 transition-transform text-lg leading-none ml-2">›</span>
                </summary>
                <p className="mt-2 text-sm text-muted-foreground pl-2 border-l border-border">{a}</p>
              </details>
            ))}
          </CardContent>
        </Card>

        {/* disclaimer */}
        <p className="text-xs text-muted-foreground text-center leading-relaxed pb-4">
          On-ramp services are provided by Transak and other third parties.
          Emberchain has no affiliation with these providers and does not handle fiat payments.
          Verify all addresses before sending. Always do your own research.
        </p>
      </div>
    </Shell>
  );
}
