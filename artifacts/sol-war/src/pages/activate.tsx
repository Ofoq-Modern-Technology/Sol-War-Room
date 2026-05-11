import { useState, useEffect, useRef } from "react";
import { Key, Terminal, ExternalLink, CheckCircle2, AlertTriangle, Loader2, CreditCard, Copy, ChevronLeft, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Props {
  onActivated: () => void;
  status?: string;
}

type Plan = "monthly" | "annual" | "lifetime";
type Currency = "SOL" | "USDC";

interface Pricing {
  monthlyPriceSol: number;
  annualPriceSol: number;
  lifetimePriceSol: number;
  monthlyPriceUsdc: number;
  annualPriceUsdc: number;
  lifetimePriceUsdc: number;
  productName?: string;
}

interface PurchaseSession {
  purchaseId: string;
  walletAddress: string;
  expectedAmountSol: number | null;
  expectedAmountUsdc: number | null;
  currency: Currency;
  plan: Plan;
  expiresAt: string;
}

type PurchaseStep = "select" | "paying" | "success";

const PLAN_LABELS: Record<Plan, string> = { monthly: "Monthly", annual: "Annual", lifetime: "Lifetime" };
const PLAN_DESC: Record<Plan, string> = { monthly: "30 days", annual: "1 year", lifetime: "Forever" };

export default function ActivatePage({ onActivated, status }: Props) {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Purchase flow
  const [showPurchase, setShowPurchase] = useState(false);
  const [step, setStep] = useState<PurchaseStep>("select");
  const [plan, setPlan] = useState<Plan>("monthly");
  const [currency, setCurrency] = useState<Currency>("USDC");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [session, setSession] = useState<PurchaseSession | null>(null);
  const [initLoading, setInitLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [copied, setCopied] = useState(false);
  const [pollStatus, setPollStatus] = useState<"polling" | "paid" | "expired">("polling");
  const [licenseKey, setLicenseKey] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch pricing when purchase panel opens
  useEffect(() => {
    if (!showPurchase || pricing) return;
    setPricingLoading(true);
    fetch(`${BASE}/api/purchase/pricing`)
      .then(r => r.json())
      .then(d => setPricing(d as Pricing))
      .catch(() => {})
      .finally(() => setPricingLoading(false));
  }, [showPurchase]);

  // Countdown timer
  useEffect(() => {
    if (step !== "paying" || !session) return;
    const expiresMs = new Date(session.expiresAt).getTime();
    countdownRef.current = setInterval(() => {
      const left = Math.max(0, Math.floor((expiresMs - Date.now()) / 1000));
      setCountdown(left);
      if (left === 0) {
        clearInterval(countdownRef.current!);
        setPollStatus("expired");
      }
    }, 1000);
    return () => clearInterval(countdownRef.current!);
  }, [step, session]);

  // Poll payment status
  useEffect(() => {
    if (step !== "paying" || !session) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/purchase/status/${session.purchaseId}`);
        const d = await r.json() as { status: string; licenseKey?: string };
        if (d.status === "paid" && d.licenseKey) {
          clearInterval(pollRef.current!);
          setLicenseKey(d.licenseKey);
          setPollStatus("paid");
          setStep("success");
        } else if (d.status === "expired") {
          clearInterval(pollRef.current!);
          setPollStatus("expired");
        }
      } catch {}
    }, 6000);
    return () => clearInterval(pollRef.current!);
  }, [step, session]);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const token = localStorage.getItem("solwar_token");
      const r = await fetch(`${BASE}/api/license/activate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ licenseKey: key.trim() }),
      });
      const data = await r.json() as { success?: boolean; error?: string };
      if (!r.ok || !data.success) {
        setError(data.error ?? "Activation failed. Check your license key.");
        return;
      }
      onActivated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function initPurchase(e: React.FormEvent) {
    e.preventDefault();
    setPurchaseError(null);
    setInitLoading(true);
    try {
      const r = await fetch(`${BASE}/api/purchase/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, plan, currency }),
      });
      const data = await r.json() as PurchaseSession & { error?: string };
      if (!r.ok || !data.purchaseId) {
        setPurchaseError(data.error ?? "Failed to create payment session");
        return;
      }
      setSession(data);
      setStep("paying");
    } catch (e) {
      setPurchaseError(e instanceof Error ? e.message : "Network error");
    } finally {
      setInitLoading(false);
    }
  }

  function copyAddress() {
    if (!session) return;
    navigator.clipboard.writeText(session.walletAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  function getPrice(p: Plan, c: Currency): string {
    if (!pricing) return "…";
    if (c === "USDC") {
      const v = p === "monthly" ? pricing.monthlyPriceUsdc : p === "annual" ? pricing.annualPriceUsdc : pricing.lifetimePriceUsdc;
      return `$${v} USDC`;
    } else {
      const v = p === "monthly" ? pricing.monthlyPriceSol : p === "annual" ? pricing.annualPriceSol : pricing.lifetimePriceSol;
      return `${v} SOL`;
    }
  }

  function formatCountdown(secs: number): string {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  const isExpired = status === "expired";
  const isInvalid = status === "invalid";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="fixed inset-0 pointer-events-none bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,255,0,0.01)_2px,rgba(0,255,0,0.01)_4px)]" />

      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 text-primary font-mono text-2xl font-bold tracking-widest">
            <Terminal className="w-7 h-7" /> SOL_WAR_ROOM
          </div>
          <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
            {showPurchase ? "Purchase Subscription" : "License Activation Required"}
          </p>
        </div>

        {!showPurchase ? (
          /* ── Activate Panel ── */
          <div className="bg-card border border-primary/20 rounded-xl p-8 shadow-lg shadow-primary/5 space-y-6">
            {isExpired && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-950/30 border border-red-700/40 text-red-400 text-xs font-mono">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                Your license has expired. Renew your subscription to continue.
              </div>
            )}
            {isInvalid && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-950/30 border border-red-700/40 text-red-400 text-xs font-mono">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                License key invalid. Please check you copied it correctly.
              </div>
            )}
            {!isExpired && !isInvalid && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-950/30 border border-yellow-700/40 text-yellow-400 text-xs font-mono">
                <Key className="w-4 h-4 mt-0.5 flex-shrink-0" />
                Enter your license key to activate this installation.
              </div>
            )}

            <form onSubmit={activate} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">License Key</label>
                <div className="relative">
                  <Key className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={key}
                    onChange={e => setKey(e.target.value)}
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                    className="pl-9 font-mono bg-background border-border/60 focus:border-primary text-sm"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-red-400 text-xs font-mono p-2 rounded bg-red-950/20 border border-red-800/30">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full font-mono tracking-wider" disabled={loading}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Activating…</> : "Activate License"}
              </Button>
            </form>

            <div className="border-t border-border/30 pt-4 space-y-3">
              <p className="text-xs font-mono text-muted-foreground">Don't have a license?</p>
              <button
                onClick={() => setShowPurchase(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-primary/30 bg-primary/5 text-primary font-mono text-sm font-semibold hover:bg-primary/10 transition-colors"
              >
                <CreditCard className="w-4 h-4" /> Purchase Subscription
              </button>
            </div>
          </div>
        ) : (
          /* ── Purchase Panel ── */
          <div className="bg-card border border-primary/20 rounded-xl shadow-lg shadow-primary/5 overflow-hidden">
            {/* Back button */}
            {step !== "success" && (
              <div className="px-6 pt-4">
                <button onClick={() => { setShowPurchase(false); setStep("select"); setSession(null); setPurchaseError(null); }}
                  className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronLeft className="w-3.5 h-3.5" /> Back to activation
                </button>
              </div>
            )}

            {step === "select" && (
              <form onSubmit={initPurchase} className="p-6 space-y-5">
                {/* Plan selection */}
                <div className="space-y-2">
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Choose Plan</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["monthly", "annual", "lifetime"] as Plan[]).map(p => (
                      <button
                        key={p} type="button"
                        onClick={() => setPlan(p)}
                        className={`flex flex-col items-center py-3 rounded-lg border text-xs font-mono transition-all ${plan === p ? "border-primary bg-primary/10 text-primary" : "border-border/40 text-muted-foreground hover:border-primary/40"}`}
                      >
                        <span className="font-bold">{PLAN_LABELS[p]}</span>
                        <span className="text-muted-foreground mt-0.5 text-[10px]">{PLAN_DESC[p]}</span>
                        <span className={`mt-1.5 font-bold text-sm ${plan === p ? "text-primary" : ""}`}>
                          {pricingLoading ? "…" : getPrice(p, currency)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Currency toggle */}
                <div className="space-y-2">
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Pay With</p>
                  <div className="flex gap-2">
                    {(["USDC", "SOL"] as Currency[]).map(c => (
                      <button key={c} type="button" onClick={() => setCurrency(c)}
                        className={`flex-1 py-2 rounded-lg border text-xs font-mono font-bold transition-all ${currency === c ? "border-primary bg-primary/10 text-primary" : "border-border/40 text-muted-foreground hover:border-primary/40"}`}
                      >
                        {c} {c === "USDC" ? "(stablecoin)" : "(native)"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Customer details */}
                <div className="space-y-3">
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Your Details</p>
                  <input value={name} onChange={e => setName(e.target.value)} required
                    placeholder="Full name"
                    className="w-full px-3 py-2 bg-background border border-border/50 rounded-md text-sm font-mono focus:outline-none focus:border-primary" />
                  <input value={email} onChange={e => setEmail(e.target.value)} required type="email"
                    placeholder="Email address (for records)"
                    className="w-full px-3 py-2 bg-background border border-border/50 rounded-md text-sm font-mono focus:outline-none focus:border-primary" />
                </div>

                {purchaseError && (
                  <div className="flex items-center gap-2 text-red-400 text-xs font-mono p-2 rounded bg-red-950/20 border border-red-800/30">
                    <AlertTriangle className="w-3.5 h-3.5" /> {purchaseError}
                  </div>
                )}

                <button type="submit" disabled={initLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground font-mono text-sm font-bold rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
                  {initLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {initLoading ? "Generating Address…" : `Pay ${getPrice(plan, currency)}`}
                </button>
              </form>
            )}

            {step === "paying" && session && (
              <div className="p-6 space-y-5">
                <div className="space-y-1">
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    {PLAN_LABELS[session.plan]} — {session.currency}
                  </p>
                  <div className="text-2xl font-bold font-mono text-primary">
                    {session.currency === "USDC"
                      ? `$${session.expectedAmountUsdc} USDC`
                      : `${session.expectedAmountSol} SOL`}
                  </div>
                </div>

                {/* Payment address */}
                <div className="space-y-2">
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Send to this address</p>
                  <div className="bg-background border border-border/50 rounded-lg p-3 space-y-2">
                    <code className="block text-[11px] font-mono text-primary break-all leading-relaxed">
                      {session.walletAddress}
                    </code>
                    <button onClick={copyAddress}
                      className={`flex items-center gap-1.5 text-xs font-mono transition-colors ${copied ? "text-green-400" : "text-muted-foreground hover:text-primary"}`}>
                      {copied ? <><CheckCircle2 className="w-3.5 h-3.5" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy Address</>}
                    </button>
                  </div>
                </div>

                {/* Warning */}
                <div className="text-xs font-mono text-yellow-400/80 bg-yellow-950/20 border border-yellow-800/30 rounded-lg p-3 space-y-1">
                  <p className="font-bold">Important:</p>
                  <p>Send <strong>exactly {session.currency === "USDC" ? `$${session.expectedAmountUsdc} USDC` : `${session.expectedAmountSol} SOL`}</strong> to the address above on <strong>Solana mainnet</strong>.</p>
                  <p className="text-muted-foreground">This address is unique to your order.</p>
                </div>

                {/* Countdown + status */}
                <div className="space-y-3">
                  {pollStatus === "polling" && (
                    <div className="flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Monitoring for payment…
                      </div>
                      <span className={`font-mono font-bold ${countdown < 120 ? "text-red-400" : "text-muted-foreground"}`}>
                        {formatCountdown(countdown)}
                      </span>
                    </div>
                  )}
                  {pollStatus === "expired" && (
                    <div className="text-xs font-mono text-red-400 text-center p-2 bg-red-950/20 rounded border border-red-800/30">
                      Session expired. <button onClick={() => { setStep("select"); setSession(null); setPollStatus("polling"); }} className="underline">Start over</button>
                    </div>
                  )}
                </div>

                {/* Already sent link */}
                <p className="text-center text-xs font-mono text-muted-foreground/50">
                  Already sent? It may take up to 30 seconds to detect.
                </p>
              </div>
            )}

            {step === "success" && licenseKey && (
              <div className="p-6 space-y-5">
                <div className="text-center space-y-2">
                  <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
                  <h3 className="font-mono font-bold text-lg text-green-400">Payment Confirmed!</h3>
                  <p className="text-xs font-mono text-muted-foreground">Your license key has been generated</p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Your License Key</p>
                  <div className="bg-background border border-primary/40 rounded-lg p-4">
                    <code className="text-primary font-mono font-bold tracking-widest text-sm block text-center">
                      {licenseKey}
                    </code>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground/60 text-center">
                    Save this key — it won't be shown again
                  </p>
                </div>

                <button
                  onClick={() => { setKey(licenseKey); setShowPurchase(false); }}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground font-mono text-sm font-bold rounded-lg hover:opacity-90 transition-opacity"
                >
                  <Key className="w-4 h-4" /> Activate Now
                </button>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-xs font-mono text-muted-foreground/50">
          self-hosted · one key per installation
        </p>
      </div>
    </div>
  );
}
