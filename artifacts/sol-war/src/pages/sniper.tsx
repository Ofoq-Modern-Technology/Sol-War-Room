import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useListSniperConfigs,
  useCreateSniperConfig,
  useDeleteSniperConfig,
  useStartSniper,
  useStopSniper,
  useGetSniperTrades,
} from "@workspace/api-client-react";
import type { SniperConfig, SniperTrade, CreateSniperConfigRequest } from "@workspace/api-client-react";
import { useListAllAccounts } from "@/hooks/use-accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Crosshair, Play, Square, Trash2, Plus, RefreshCw, ChevronDown, ChevronUp, Wallet, TrendingUp, Clock, AlertCircle, LogOut, Loader2, Power } from "lucide-react";
import { SolscanLink } from "@/components/solscan-link";

const DEX_OPTIONS = [
  { value: "pumpfun",      label: "Pump.fun",      desc: "New tokens at launch (pre-graduation)" },
  { value: "raydium",      label: "Raydium AMM v4", desc: "New Raydium pools — includes graduated Pump.fun tokens" },
  { value: "raydium_cpmm", label: "Raydium CPMM",  desc: "New CPMM pools — newer Raydium pool format" },
];

const STATUS_COLORS: Record<string, string> = {
  bought: "text-blue-400",
  sold: "text-green-400",
  failed: "text-red-400",
  pending: "text-yellow-400",
};

type SnipeSource = "cto" | "dex" | "both";

interface CreateForm {
  name: string;
  snipeSource: SnipeSource;
  accountIds: number[];
  buyMode: "fixed" | "percent";
  solPerAccount: string;
  buyPercent: string;
  maxBuySlippageBps: string;
  exitStrategy: string;
  exitTimerSeconds: string;
  exitMultiplier: string;
  stopLossPct: string;
  useJito: boolean;
  jitoTipLamports: string;
  targetDexes: string[];
  maxSnipesPerPool: string;
  enableSocialGate: boolean;
}

const DEFAULT_FORM: CreateForm = {
  name: "",
  snipeSource: "cto",
  accountIds: [],
  buyMode: "fixed",
  solPerAccount: "0.05",
  buyPercent: "90",
  maxBuySlippageBps: "1500",
  exitStrategy: "timer",
  exitTimerSeconds: "300",
  exitMultiplier: "1.3",
  stopLossPct: "20",
  useJito: true,
  jitoTipLamports: "100000",
  targetDexes: ["raydium", "raydium_cpmm", "pumpfun"],
  maxSnipesPerPool: "1",
  enableSocialGate: false,
};

// ─── Kill Switch Panel ────────────────────────────────────────────────────────

function KillSwitchPanel({
  runningCount,
  holdingsCount,
  pendingCount,
  onDone,
}: {
  runningCount: number;
  holdingsCount: number;
  pendingCount: number;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [firing, setFiring] = useState(false);
  const [result, setResult] = useState<{ stopped: number; pendingCleared: number; sellQueued: number; message: string } | null>(null);
  const { toast } = useToast();

  const handleKill = async () => {
    if (!password) { toast({ title: "Enter your wallet password", variant: "destructive" }); return; }
    if (!window.confirm(
      `⚠️ KILL SWITCH\n\nThis will:\n• Stop ${runningCount} running bot(s)\n• Discard ${pendingCount} pending tx(s)\n• Sell ${holdingsCount} held position(s)\n\nContinue?`
    )) return;

    setFiring(true);
    setResult(null);
    try {
      const r = await fetch("/api/sniper/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await r.json() as { stopped?: number; pendingCleared?: number; sellQueued?: number; message?: string; error?: string };
      if (!r.ok) {
        toast({ title: `Kill-switch failed: ${data.error ?? r.statusText}`, variant: "destructive" });
      } else {
        setResult({ stopped: data.stopped ?? 0, pendingCleared: data.pendingCleared ?? 0, sellQueued: data.sellQueued ?? 0, message: data.message ?? "" });
        toast({ title: "Kill switch engaged", description: data.message });
        onDone();
      }
    } catch (e) {
      toast({ title: String(e), variant: "destructive" });
    } finally {
      setFiring(false);
    }
  };

  return (
    <div className="border border-red-800/50 rounded bg-red-950/15">
      <div className="flex items-center justify-between px-4 py-3 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Power className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <div className="font-mono font-bold text-sm text-red-300">KILL SWITCH</div>
            <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
              Stop all bots · Discard pending · Sell all positions
            </div>
          </div>
          {/* Status chips */}
          <div className="flex items-center gap-1.5 ml-2 flex-wrap">
            <span className={`font-mono text-[10px] px-2 py-0.5 rounded-full border ${runningCount > 0 ? "border-green-700/50 bg-green-950/30 text-green-400" : "border-border/30 text-muted-foreground"}`}>
              {runningCount} bots running
            </span>
            <span className={`font-mono text-[10px] px-2 py-0.5 rounded-full border ${holdingsCount > 0 ? "border-blue-700/50 bg-blue-950/30 text-blue-400" : "border-border/30 text-muted-foreground"}`}>
              {holdingsCount} positions
            </span>
            <span className={`font-mono text-[10px] px-2 py-0.5 rounded-full border ${pendingCount > 0 ? "border-orange-700/50 bg-orange-950/30 text-orange-400" : "border-border/30 text-muted-foreground"}`}>
              {pendingCount} pending
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Input
            type="password"
            placeholder="wallet password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="font-mono text-xs h-8 w-36 border-red-800/40 bg-background/60"
          />
          <Button
            variant="outline"
            disabled={firing}
            onClick={handleKill}
            className="h-8 px-4 font-mono text-sm font-bold border-red-600 text-red-400 hover:bg-red-950/60 hover:text-red-300"
          >
            {firing
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Killing...</>
              : <><Power className="w-4 h-4 mr-2" />KILL ALL</>
            }
          </Button>
        </div>
      </div>

      {result && (
        <div className="border-t border-red-800/30 px-4 py-2 font-mono text-xs text-muted-foreground flex flex-wrap gap-4">
          <span className="text-yellow-400">✓ {result.stopped} bot{result.stopped !== 1 ? "s" : ""} stopped</span>
          <span className="text-orange-400">✓ {result.pendingCleared} pending cleared</span>
          <span className="text-blue-400">⟳ {result.sellQueued} sell{result.sellQueued !== 1 ? "s" : ""} queued (background)</span>
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function CreateConfigPanel({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState<CreateForm>(DEFAULT_FORM);
  const [open, setOpen] = useState(false);
  const { data: accounts } = useListAllAccounts();
  const { toast } = useToast();

  const createMutation = useCreateSniperConfig({
    mutation: {
      onSuccess: () => {
        setForm(DEFAULT_FORM);
        setOpen(false);
        toast({ title: "Sniper config created" });
        onCreated();
      },
      onError: () => toast({ title: "Error creating config", variant: "destructive" }),
    },
  });

  const toggleAccount = (id: number) => {
    setForm(f => ({
      ...f,
      accountIds: f.accountIds.includes(id) ? f.accountIds.filter(x => x !== id) : [...f.accountIds, id],
    }));
  };

  const toggleDex = (dex: string) => {
    setForm(f => ({
      ...f,
      targetDexes: f.targetDexes.includes(dex) ? f.targetDexes.filter(x => x !== dex) : [...f.targetDexes, dex],
    }));
  };

  const handleCreate = () => {
    const enableCtoBuy = form.snipeSource === "cto" || form.snipeSource === "both";
    const targetDexes = form.snipeSource === "cto" ? [] : form.targetDexes;

    const payload = {
      name: form.name,
      accountIds: form.accountIds,
      solPerAccount: Number(form.solPerAccount),
      maxBuySlippageBps: Number(form.maxBuySlippageBps),
      exitStrategy: form.exitStrategy as CreateSniperConfigRequest["exitStrategy"],
      exitTimerSeconds: Number(form.exitTimerSeconds),
      exitMultiplier: Number(form.exitMultiplier),
      useJito: form.useJito,
      jitoTipLamports: Number(form.jitoTipLamports),
      targetDexes,
      maxSnipesPerPool: Number(form.maxSnipesPerPool),
      enableSocialGate: form.enableSocialGate,
      enableCtoBuy,
      buyMode: form.buyMode,
      buyPercent: Number(form.buyPercent),
      stopLossPct: Number(form.stopLossPct),
    } as CreateSniperConfigRequest & { enableSocialGate?: boolean; enableCtoBuy?: boolean; buyMode?: string; buyPercent?: number; stopLossPct?: number };
    createMutation.mutate({ data: payload });
  };

  return (
    <div className="border border-border/50 rounded bg-card/50">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-3 text-left font-mono text-sm"
      >
        <span className="flex items-center gap-2"><Plus className="w-4 h-4 text-primary" /> New Sniper Config</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="p-4 border-t border-border/50 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="font-mono text-xs">Config Name</Label>
              <Input className="font-mono mt-1" placeholder="e.g. Fast Sniper 1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>

            <div className="col-span-2">
              <Label className="font-mono text-xs block mb-1">Buy Amount Mode</Label>
              <div className="flex rounded-md overflow-hidden border border-border/50 w-fit">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, buyMode: "fixed" }))}
                  className={`px-3 py-1.5 font-mono text-xs transition-colors ${form.buyMode === "fixed" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted/30"}`}
                >
                  Fixed SOL
                </button>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, buyMode: "percent" }))}
                  className={`px-3 py-1.5 font-mono text-xs transition-colors border-l border-border/50 ${form.buyMode === "percent" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted/30"}`}
                >
                  % of Balance
                </button>
              </div>
            </div>

            {form.buyMode === "fixed" ? (
              <div>
                <Label className="font-mono text-xs">SOL Per Account</Label>
                <Input className="font-mono mt-1" type="number" step="0.01" min="0.001" value={form.solPerAccount} onChange={e => setForm(f => ({ ...f, solPerAccount: e.target.value }))} />
              </div>
            ) : (
              <div>
                <Label className="font-mono text-xs">% of Balance <span className="text-muted-foreground/60">(keeps 0.005 SOL for fees)</span></Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input className="font-mono w-20" type="number" step="1" min="1" max="100" value={form.buyPercent} onChange={e => setForm(f => ({ ...f, buyPercent: e.target.value }))} />
                  <span className="font-mono text-xs text-muted-foreground">% of each wallet's balance</span>
                </div>
                <p className="font-mono text-[10px] text-yellow-400/80 mt-1">Wallets with insufficient balance are automatically skipped</p>
              </div>
            )}

            <div>
              <Label className="font-mono text-xs">Max Slippage (bps)</Label>
              <Input className="font-mono mt-1" type="number" value={form.maxBuySlippageBps} onChange={e => setForm(f => ({ ...f, maxBuySlippageBps: e.target.value }))} />
            </div>

            <div>
              <Label className="font-mono text-xs">Exit Strategy</Label>
              <Select value={form.exitStrategy} onValueChange={v => setForm(f => ({ ...f, exitStrategy: v }))}>
                <SelectTrigger className="font-mono mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="timer">Timer</SelectItem>
                  <SelectItem value="multiplier">Price Multiplier</SelectItem>
                  <SelectItem value="tpsl">TP / SL</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.exitStrategy === "timer" && (
              <div>
                <Label className="font-mono text-xs">Exit Timer (seconds)</Label>
                <Input className="font-mono mt-1" type="number" value={form.exitTimerSeconds} onChange={e => setForm(f => ({ ...f, exitTimerSeconds: e.target.value }))} />
              </div>
            )}
            {form.exitStrategy === "multiplier" && (
              <div>
                <Label className="font-mono text-xs">Target Multiplier (x)</Label>
                <Input className="font-mono mt-1" type="number" step="0.1" value={form.exitMultiplier} onChange={e => setForm(f => ({ ...f, exitMultiplier: e.target.value }))} />
              </div>
            )}
            {form.exitStrategy === "tpsl" && (
              <div className="col-span-2 grid grid-cols-2 gap-3">
                <div>
                  <Label className="font-mono text-xs">Take Profit (x) <span className="text-muted-foreground/60">e.g. 1.3 = +30%</span></Label>
                  <Input className="font-mono mt-1" type="number" step="0.05" min="1.01" value={form.exitMultiplier} onChange={e => setForm(f => ({ ...f, exitMultiplier: e.target.value }))} />
                </div>
                <div>
                  <Label className="font-mono text-xs">Stop Loss (%) <span className="text-muted-foreground/60">e.g. 20 = sell at -20%</span></Label>
                  <Input className="font-mono mt-1" type="number" step="1" min="1" max="99" value={form.stopLossPct} onChange={e => setForm(f => ({ ...f, stopLossPct: e.target.value }))} />
                </div>
              </div>
            )}
            {form.exitStrategy === "manual" && <div />}

            <div>
              <Label className="font-mono text-xs">Max Snipes Per Pool</Label>
              <Input className="font-mono mt-1" type="number" min="1" value={form.maxSnipesPerPool} onChange={e => setForm(f => ({ ...f, maxSnipesPerPool: e.target.value }))} />
            </div>

            <div>
              <Label className="font-mono text-xs">Jito Tip (lamports)</Label>
              <Input className="font-mono mt-1" type="number" value={form.jitoTipLamports} onChange={e => setForm(f => ({ ...f, jitoTipLamports: e.target.value }))} />
            </div>
          </div>

          {/* ── Snipe Source ─────────────────────────────────────────────── */}
          <div className="space-y-2">
            <Label className="font-mono text-xs font-semibold">Snipe Source</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["cto", "dex", "both"] as SnipeSource[]).map(src => {
                const labels: Record<SnipeSource, string> = { cto: "DexScreener CTO", dex: "DEX Pools", both: "Both" };
                const descs: Record<SnipeSource, string> = {
                  cto: "Buy on DexScreener Community Takeover (polls every 5s). No Helius key needed.",
                  dex: "Buy on new Raydium / Pump.fun pools via WebSocket. Requires Helius key.",
                  both: "Run CTO monitor + DEX pool sniping simultaneously.",
                };
                const active = form.snipeSource === src;
                return (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, snipeSource: src }))}
                    className={`flex flex-col items-start gap-0.5 p-2.5 rounded border text-left transition-colors ${
                      active
                        ? src === "cto"
                          ? "border-orange-500/60 bg-orange-950/30 text-orange-300"
                          : src === "dex"
                          ? "border-blue-500/60 bg-blue-950/30 text-blue-300"
                          : "border-purple-500/60 bg-purple-950/30 text-purple-300"
                        : "border-border/40 bg-card/30 text-muted-foreground hover:border-border/60"
                    }`}
                  >
                    <span className="font-mono text-[10px] font-bold">{labels[src]}</span>
                    <span className="font-mono text-[9px] leading-snug opacity-75">{descs[src]}</span>
                  </button>
                );
              })}
            </div>

            {/* DEX selection — only visible when dex or both is selected */}
            {(form.snipeSource === "dex" || form.snipeSource === "both") && (
              <div className="border border-border/40 rounded p-3 space-y-1.5">
                <Label className="font-mono text-[10px] text-muted-foreground">DEX Pools to Watch</Label>
                {DEX_OPTIONS.map(d => (
                  <label key={d.value} className="flex items-start gap-2 cursor-pointer font-mono">
                    <Checkbox className="mt-0.5" checked={form.targetDexes.includes(d.value)} onCheckedChange={() => toggleDex(d.value)} />
                    <div>
                      <span className="text-xs font-semibold">{d.label}</span>
                      <span className="text-[10px] text-muted-foreground ml-1.5">{d.desc}</span>
                    </div>
                  </label>
                ))}
                {form.targetDexes.length === 0 && (
                  <p className="font-mono text-[10px] text-red-400/80 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    Select at least one DEX pool
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Social Gate ──────────────────────────────────────────────── */}
          {(form.snipeSource === "dex" || form.snipeSource === "both") && (
            <div className="flex items-start gap-3 p-3 border border-yellow-700/30 rounded bg-yellow-950/10">
              <Checkbox
                id="socialGate"
                checked={form.enableSocialGate}
                onCheckedChange={v => setForm(f => ({ ...f, enableSocialGate: !!v }))}
                className="mt-0.5"
              />
              <div>
                <label htmlFor="socialGate" className="font-mono text-xs font-semibold cursor-pointer">Enable Social Gate (xAI)</label>
                <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                  Before buying on Raydium, query xAI Grok to check if any monitored X account mentioned this token.
                  Requires xAI API key configured in Settings. Only applies to Raydium / CPMM pools.
                </p>
              </div>
            </div>
          )}

          <div>
            <Label className="font-mono text-xs block mb-2">
              Select Accounts <span className="text-muted-foreground">({form.accountIds.length} selected)</span>
            </Label>
            <div className="max-h-36 overflow-y-auto border border-border/30 rounded p-2 space-y-1">
              {(accounts ?? []).map(acc => (
                <label key={acc.id} className="flex items-center gap-2 cursor-pointer font-mono text-xs hover:bg-muted/20 rounded px-1 py-0.5">
                  <Checkbox checked={form.accountIds.includes(acc.id)} onCheckedChange={() => toggleAccount(acc.id)} />
                  <span className="text-muted-foreground w-5">#{acc.id}</span>
                  <span>{acc.name ?? `Account ${acc.id}`}</span>
                  <span className="text-muted-foreground ml-auto">{(acc.solBalance ?? 0).toFixed(3)} SOL</span>
                </label>
              ))}
            </div>
          </div>

          <Button
            className="w-full font-mono"
            onClick={handleCreate}
            disabled={createMutation.isPending || !form.name || form.accountIds.length === 0 || ((form.snipeSource === "dex" || form.snipeSource === "both") && form.targetDexes.length === 0)}
          >
            {createMutation.isPending ? "Creating..." : "Create Sniper Config"}
          </Button>
        </div>
      )}
    </div>
  );
}

function SniperLogs({ configId, enabled }: { configId: number; enabled: boolean }) {
  const { data: logs } = useQuery<string[]>({
    queryKey: ["sniperLogs", configId],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/sniper/configs/${configId}/logs?limit=80`, { signal });
      return r.json() as Promise<string[]>;
    },
    enabled,
    refetchInterval: enabled ? 2000 : false,
  });

  return (
    <div className="bg-black/60 rounded p-2 h-48 overflow-y-auto font-mono text-[10px] space-y-0.5">
      {(logs ?? []).length === 0 ? (
        <div className="text-muted-foreground/50 italic">No logs yet...</div>
      ) : (logs ?? []).map((line, i) => (
        <div key={i} className={
          line.includes("FAILED") || line.includes("error") || line.includes("SELL FAILED") ? "text-red-400" :
          line.includes("OK") || line.includes("SOLD") ? "text-green-400" :
          line.includes("Jito unavailable") || line.includes("fallback") ? "text-yellow-400" :
          line.includes("Sniping") ? "text-yellow-300" :
          line.includes("New pool") ? "text-primary font-bold" :
          "text-muted-foreground"
        }>
          {line}
        </div>
      ))}
    </div>
  );
}

function TradeRow({ trade }: { trade: SniperTrade }) {
  return (
    <div className="border border-border/30 rounded px-2 py-1.5 font-mono text-xs space-y-0.5">
      <div className="flex items-center justify-between">
        <SolscanLink address={trade.mintAddress} type="token" label={`${trade.mintAddress.slice(0, 8)}...`} className="text-primary" />
        <span className={`font-semibold ${STATUS_COLORS[trade.status] ?? "text-muted-foreground"}`}>{trade.status.toUpperCase()}</span>
      </div>
      <div className="flex gap-3 text-muted-foreground flex-wrap">
        <span>dex:{trade.dex}</span>
        <span>spent:{trade.solSpent.toFixed(3)}◎</span>
        {trade.solReceived != null && (
          <span className={trade.pnlSol != null && trade.pnlSol >= 0 ? "text-green-400" : "text-red-400"}>
            rcv:{trade.solReceived.toFixed(4)}◎
            {trade.pnlSol != null && ` (${trade.pnlSol >= 0 ? "+" : ""}${trade.pnlSol.toFixed(4)})`}
          </span>
        )}
      </div>
      {trade.buyTxSignature && (
        <SolscanLink address={trade.buyTxSignature} type="tx" label="buy tx" className="text-muted-foreground text-[10px]" />
      )}
      {trade.error && <div className="text-red-400 text-[10px] truncate">{trade.error}</div>}
    </div>
  );
}

function ConfigCard({ config, onRefresh }: { config: SniperConfig; onRefresh: () => void }) {
  const [password, setPassword] = useState("");
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();
  const isRunning = config.status === "running";

  const { data: trades } = useGetSniperTrades(config.id, { limit: 30 }, {
    query: { enabled: expanded, refetchInterval: expanded ? 4000 : false },
  });

  const startMutation = useStartSniper({
    mutation: {
      onSuccess: () => { onRefresh(); toast({ title: `Sniper "${config.name}" started` }); },
      onError: () => toast({ title: "Start failed — wrong password?", variant: "destructive" }),
    },
  });

  const stopMutation = useStopSniper({
    mutation: {
      onSuccess: () => { onRefresh(); toast({ title: `Sniper "${config.name}" stopped` }); },
    },
  });

  const deleteMutation = useDeleteSniperConfig({
    mutation: {
      onSuccess: () => { onRefresh(); toast({ title: "Config deleted" }); },
    },
  });

  const exitLabel = config.exitStrategy === "timer"
    ? `${config.exitTimerSeconds}s timer`
    : config.exitStrategy === "multiplier"
    ? `${config.exitMultiplier}x target`
    : "manual";

  const pnlColor = (config.totalPnlSol ?? 0) >= 0 ? "text-green-400" : "text-red-400";
  const accountCount = Array.isArray(config.accountIds) ? config.accountIds.length : 0;

  return (
    <div className="border border-border/50 rounded bg-card/50">
      <div className="p-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-sm">{config.name}</span>
            <Badge variant={isRunning ? "default" : "secondary"} className="font-mono text-xs">
              {isRunning ? "LIVE" : "IDLE"}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {(config.targetDexes as string[]).length > 0
                ? (config.targetDexes as string[]).join(" • ")
                : <span className="text-orange-400/80">CTO only</span>
              }
            </span>
            {(config as typeof config & { enableCtoBuy?: boolean }).enableCtoBuy && (
              <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30">CTO</span>
            )}
          </div>
          <div className="flex gap-4 mt-1.5 text-xs font-mono text-muted-foreground flex-wrap">
            <span>{config.solPerAccount} SOL/acct</span>
            <span>{config.maxBuySlippageBps}bps slip</span>
            <span>exit:{exitLabel}</span>
            <span>{accountCount} accts</span>
            <span>snipes:{config.totalSnipes}</span>
            <span className={`${pnlColor} font-semibold`}>
              PnL:{(config.totalPnlSol ?? 0) >= 0 ? "+" : ""}{(config.totalPnlSol ?? 0).toFixed(4)} SOL
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isRunning ? (
            <div className="flex items-center gap-1">
              <Input
                className="font-mono text-xs w-28 h-7"
                type="password"
                placeholder="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 font-mono text-xs border-green-600 text-green-400 hover:bg-green-950"
                onClick={() => startMutation.mutate({ id: config.id, data: { password } })}
                disabled={startMutation.isPending || !password}
              >
                <Play className="w-3 h-3 mr-1" /> Start
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 font-mono text-xs border-yellow-600 text-yellow-400 hover:bg-yellow-950"
              onClick={() => stopMutation.mutate({ id: config.id })}
              disabled={stopMutation.isPending}
            >
              <Square className="w-3 h-3 mr-1" /> Stop
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-red-500/60 hover:text-red-400"
            onClick={() => { if (window.confirm("Delete this sniper config?")) deleteMutation.mutate({ id: config.id }); }}
            disabled={isRunning}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/50 p-3 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">Live Logs</div>
              <SniperLogs configId={config.id} enabled={expanded} />
            </div>

            <div>
              <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-2">Recent Trades</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(trades ?? []).length === 0 ? (
                  <div className="text-muted-foreground/50 italic font-mono text-xs">No trades yet</div>
                ) : (trades ?? []).map((trade: SniperTrade) => (
                  <TradeRow key={trade.id} trade={trade} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Holdings View ────────────────────────────────────────────────────────────

function HoldingRow({
  trade,
  now,
  sellPassword,
  onSellDone,
}: {
  trade: SniperTrade;
  now: number;
  sellPassword: string;
  onSellDone: (tradeId: number, ok: boolean) => void;
}) {
  const { toast } = useToast();
  const [selling, setSelling] = useState(false);
  const boughtMs = trade.boughtAt ? new Date(trade.boughtAt).getTime() : null;
  const heldStr = boughtMs ? formatDuration(now - boughtMs) : "?";

  const handleSell = useCallback(async () => {
    if (!sellPassword) { toast({ title: "Enter your wallet password first", variant: "destructive" }); return; }
    setSelling(true);
    try {
      const r = await fetch(`/api/sniper/trades/${trade.id}/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: sellPassword }),
      });
      const data = await r.json() as { error?: string; status?: string };
      if (!r.ok) {
        toast({ title: `Sell failed: ${data.error ?? r.statusText}`, variant: "destructive" });
        onSellDone(trade.id, false);
      } else {
        toast({ title: `Position sold (${data.status ?? "sold"})` });
        onSellDone(trade.id, true);
      }
    } catch (err) {
      toast({ title: `Network error: ${err instanceof Error ? err.message : "unknown"}`, variant: "destructive" });
      onSellDone(trade.id, false);
    } finally {
      setSelling(false);
    }
  }, [sellPassword, trade.id, toast, onSellDone]);

  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-2 items-center px-2 py-1.5 hover:bg-muted/10 rounded font-mono text-xs border-b border-border/20 last:border-0">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <SolscanLink
          address={trade.mintAddress}
          type="token"
          label={trade.mintAddress.slice(0, 10) + "…"}
          className="text-primary shrink-0"
        />
        <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 shrink-0 border-border/40">
          {trade.dex}
        </Badge>
        <span className="text-muted-foreground shrink-0">{trade.solSpent.toFixed(4)}◎ in</span>
        {trade.tokensReceived != null && trade.tokensReceived > 0 && (
          <span className="text-blue-300/80 shrink-0">
            {trade.tokensReceived > 1_000_000
              ? (trade.tokensReceived / 1_000_000).toFixed(2) + "M"
              : trade.tokensReceived > 1_000
              ? (trade.tokensReceived / 1_000).toFixed(1) + "K"
              : trade.tokensReceived.toFixed(0)}{" "}tkns
          </span>
        )}
        <span className="text-muted-foreground/60 flex items-center gap-1 shrink-0">
          <Clock className="w-3 h-3" />{heldStr}
        </span>
        {trade.buyTxSignature && (
          <SolscanLink address={trade.buyTxSignature} type="tx" label="buy tx" className="text-muted-foreground/50 text-[10px] shrink-0" />
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={selling}
        onClick={handleSell}
        className="h-6 px-2 text-[10px] font-mono border-red-700/50 text-red-400 hover:bg-red-950/40 shrink-0"
      >
        {selling ? <Loader2 className="w-3 h-3 animate-spin" /> : <><LogOut className="w-3 h-3 mr-1" />Sell</>}
      </Button>
    </div>
  );
}

interface WalletHolding {
  accountId: number;
  accountName: string;
  trades: SniperTrade[];
  totalSolAtRisk: number;
}

function HoldingsView() {
  const { data: accounts } = useListAllAccounts();
  const [now, setNow] = useState(Date.now());
  const [sellPassword, setSellPassword] = useState("");
  const [sellingAll, setSellingAll] = useState(false);
  const { toast } = useToast();

  const { data: allTrades, isLoading, refetch } = useQuery<SniperTrade[]>({
    queryKey: ["sniperAllTrades"],
    queryFn: async ({ signal }) => {
      const r = await fetch("/api/sniper/trades?limit=500", { signal });
      return r.json() as Promise<SniperTrade[]>;
    },
    refetchInterval: 8000,
  });

  // Tick every second so "held for" times stay live
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const accountMap = useMemo(() => {
    const m: Record<number, string> = {};
    (accounts ?? []).forEach(a => { m[a.id] = a.name ?? `Wallet ${a.id}`; });
    return m;
  }, [accounts]);

  const walletHoldings = useMemo((): WalletHolding[] => {
    const bought = (allTrades ?? []).filter(t => t.status === "bought");
    const grouped: Record<number, SniperTrade[]> = {};
    bought.forEach(t => {
      if (!grouped[t.accountId]) grouped[t.accountId] = [];
      grouped[t.accountId].push(t);
    });
    return Object.entries(grouped)
      .map(([accId, ts]) => ({
        accountId: Number(accId),
        accountName: accountMap[Number(accId)] ?? `Wallet ${accId}`,
        trades: ts.sort((a, b) => new Date(b.boughtAt ?? 0).getTime() - new Date(a.boughtAt ?? 0).getTime()),
        totalSolAtRisk: ts.reduce((s, t) => s + t.solSpent, 0),
      }))
      .sort((a, b) => b.totalSolAtRisk - a.totalSolAtRisk);
  }, [allTrades, accountMap]);

  const pendingTrades = useMemo(() =>
    (allTrades ?? []).filter(t => t.status === "pending"), [allTrades]);

  const soldTrades = useMemo(() =>
    (allTrades ?? [])
      .filter(t => t.status === "sold")
      .sort((a, b) => new Date(b.soldAt ?? b.boughtAt ?? 0).getTime() - new Date(a.soldAt ?? a.boughtAt ?? 0).getTime()),
    [allTrades]);

  const realizedPnl = useMemo(() =>
    soldTrades.reduce((s, t) => s + (t.pnlSol ?? 0), 0), [soldTrades]);

  const winners = useMemo(() => soldTrades.filter(t => (t.pnlSol ?? 0) >= 0).length, [soldTrades]);
  const losers  = useMemo(() => soldTrades.filter(t => (t.pnlSol ?? 0) < 0).length,  [soldTrades]);

  const totalAtRisk = walletHoldings.reduce((s, w) => s + w.totalSolAtRisk, 0);
  const totalPositions = walletHoldings.reduce((s, w) => s + w.trades.length, 0);

  const handleSellAll = async () => {
    if (!sellPassword) { toast({ title: "Enter your wallet password first", variant: "destructive" }); return; }
    if (!window.confirm(`Sell ALL ${totalPositions} position(s)? This will execute market sells immediately.`)) return;
    setSellingAll(true);
    try {
      const r = await fetch("/api/sniper/sell-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: sellPassword }),
      });
      const data = await r.json() as { queued?: number; message?: string; error?: string };
      if (!r.ok) {
        toast({ title: `Sell-all failed: ${data.error ?? r.statusText}`, variant: "destructive" });
      } else {
        toast({ title: data.message ?? `Selling ${data.queued ?? 0} positions...` });
        setTimeout(() => void refetch(), 4000);
      }
    } catch (err) {
      toast({ title: `Network error: ${err instanceof Error ? err.message : "unknown"}`, variant: "destructive" });
    } finally {
      setSellingAll(false);
    }
  };

  const handleSellDone = useCallback((_tradeId: number, ok: boolean) => {
    if (ok) setTimeout(() => void refetch(), 1500);
  }, [refetch]);

  if (isLoading) {
    return <div className="font-mono text-sm text-muted-foreground animate-pulse py-8 text-center">Loading holdings...</div>;
  }

  return (
    <div className="space-y-3">
      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="border border-border/40 rounded p-2.5 bg-card/30 text-center">
          <div className="font-mono text-lg font-bold text-blue-400">{totalPositions}</div>
          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">OPEN POSITIONS</div>
        </div>
        <div className="border border-border/40 rounded p-2.5 bg-card/30 text-center">
          <div className="font-mono text-lg font-bold text-yellow-400">{totalAtRisk.toFixed(4)} ◎</div>
          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">SOL AT RISK</div>
        </div>
        <div className="border border-border/40 rounded p-2.5 bg-card/30 text-center">
          <div className={`font-mono text-lg font-bold ${pendingTrades.length > 0 ? "text-orange-400" : "text-muted-foreground"}`}>
            {pendingTrades.length}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">PENDING TXS</div>
        </div>
        <div className={`border rounded p-2.5 text-center ${realizedPnl >= 0 ? "border-green-700/40 bg-green-950/20" : "border-red-700/40 bg-red-950/20"}`}>
          <div className={`font-mono text-lg font-bold ${realizedPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
            {realizedPnl >= 0 ? "+" : ""}{realizedPnl.toFixed(4)} ◎
          </div>
          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
            REALIZED P&amp;L
            {soldTrades.length > 0 && (
              <span className="ml-1 text-[9px]">
                <span className="text-green-500">{winners}W</span>
                {" / "}
                <span className="text-red-500">{losers}L</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Pending warning */}
      {pendingTrades.length > 0 && (
        <div className="border border-orange-500/30 rounded p-2.5 bg-orange-950/20 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
          <div className="font-mono text-xs text-orange-300">
            <span className="font-bold">{pendingTrades.length} pending transaction{pendingTrades.length > 1 ? "s" : ""}</span>
            {" "}— in-flight, may still confirm on-chain. Check Solscan to verify.
          </div>
        </div>
      )}

      {/* Sell controls */}
      <div className="border border-red-800/40 rounded p-3 bg-red-950/10 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <LogOut className="w-4 h-4 text-red-400 shrink-0" />
          <span className="font-mono text-xs text-red-300 shrink-0 font-semibold">Sell Positions</span>
          <Input
            type="password"
            placeholder="wallet password"
            value={sellPassword}
            onChange={e => setSellPassword(e.target.value)}
            className="font-mono text-xs h-7 w-36 shrink-0 border-red-800/40 bg-background/50"
          />
          <span className="font-mono text-[10px] text-muted-foreground shrink-0">Used to sign each sell tx</span>
          <Button
            size="sm"
            variant="outline"
            disabled={sellingAll || totalPositions === 0}
            onClick={handleSellAll}
            className="ml-auto h-7 px-3 font-mono text-xs border-red-600 text-red-400 hover:bg-red-950/50 shrink-0"
          >
            {sellingAll
              ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Selling...</>
              : <><LogOut className="w-3.5 h-3.5 mr-1.5" />Sell All {totalPositions > 0 ? `(${totalPositions})` : ""}</>
            }
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void refetch()} className="h-7 px-2 font-mono text-xs gap-1">
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {walletHoldings.length === 0 ? (
        <div className="text-center py-10 font-mono text-muted-foreground text-sm border border-dashed border-border/30 rounded">
          No active positions. Start a sniper to accumulate tokens.
        </div>
      ) : (
        <div className="space-y-2">
          {walletHoldings.map(wallet => (
            <div key={wallet.accountId} className="border border-border/50 rounded bg-card/50 overflow-hidden">
              <div className="px-3 py-2 border-b border-border/40 bg-card/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="w-3.5 h-3.5 text-primary" />
                  <span className="font-mono font-bold text-sm">{wallet.accountName}</span>
                  <Badge variant="secondary" className="font-mono text-[9px] px-1.5">
                    {wallet.trades.length} position{wallet.trades.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-yellow-500/70" />
                  <span className="font-mono text-xs text-yellow-400 font-semibold">
                    {wallet.totalSolAtRisk.toFixed(4)} ◎ deployed
                  </span>
                </div>
              </div>
              <div className="divide-y divide-border/10">
                {wallet.trades.map(trade => (
                  <HoldingRow
                    key={trade.id}
                    trade={trade}
                    now={now}
                    sellPassword={sellPassword}
                    onSellDone={handleSellDone}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Closed Positions ─────────────────────────────────────────────── */}
      {soldTrades.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <div className="font-mono text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Closed Positions ({soldTrades.length})
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">
              <span className="text-green-400">{winners} wins</span>
              {" · "}
              <span className="text-red-400">{losers} losses</span>
              {" · "}
              <span className={realizedPnl >= 0 ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
                total {realizedPnl >= 0 ? "+" : ""}{realizedPnl.toFixed(4)} ◎
              </span>
            </div>
          </div>
          <div className="border border-border/40 rounded overflow-hidden">
            {soldTrades.map(trade => {
              const isLoss = (trade.pnlSol ?? 0) < 0;
              return (
                <div
                  key={trade.id}
                  className={`grid grid-cols-[1fr_auto] gap-x-3 items-center px-3 py-1.5 border-b border-border/10 last:border-0 font-mono text-xs
                    ${isLoss ? "bg-red-950/20 hover:bg-red-950/30" : "bg-green-950/10 hover:bg-green-950/20"}`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <SolscanLink
                      address={trade.mintAddress}
                      type="token"
                      label={trade.mintAddress.slice(0, 10) + "…"}
                      className={isLoss ? "text-red-400" : "text-green-400"}
                    />
                    <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 border-border/30">
                      {trade.dex}
                    </Badge>
                    <span className="text-muted-foreground">{trade.solSpent.toFixed(4)}◎ in</span>
                    {trade.solReceived != null && (
                      <span className={isLoss ? "text-red-300/80" : "text-green-300/80"}>
                        {(trade.solReceived as number).toFixed(4)}◎ out
                      </span>
                    )}
                    {trade.sellTxSignature && (
                      <SolscanLink address={trade.sellTxSignature} type="tx" label="sell tx" className="text-muted-foreground/50 text-[10px]" />
                    )}
                  </div>
                  <div className={`font-bold shrink-0 ${isLoss ? "text-red-400" : "text-green-400"}`}>
                    {(trade.pnlSol ?? 0) >= 0 ? "+" : ""}{(trade.pnlSol ?? 0).toFixed(4)} ◎
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SniperPage() {
  const [tab, setTab] = useState<"configs" | "holdings">("configs");
  const { data: configs, isLoading, refetch } = useListSniperConfigs({
    query: { refetchInterval: 5000 },
  });

  const runningCount = (configs ?? []).filter(c => c.status === "running").length;

  // Pre-fetch holdings count for badge
  const { data: allTrades } = useQuery<SniperTrade[]>({
    queryKey: ["sniperAllTrades"],
    queryFn: async ({ signal }) => {
      const r = await fetch("/api/sniper/trades?limit=500", { signal });
      return r.json() as Promise<SniperTrade[]>;
    },
    refetchInterval: 10000,
  });
  const holdingsCount = (allTrades ?? []).filter(t => t.status === "bought").length;
  const pendingCount = (allTrades ?? []).filter(t => t.status === "pending").length;

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crosshair className="w-5 h-5 text-primary text-glow" />
          <h1 className="font-mono font-bold text-xl tracking-tight">New Pool Sniper</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {configs ? `${runningCount}/${configs.length} running` : ""}
          </span>
          <Button size="sm" variant="ghost" onClick={() => refetch()} className="h-7 px-2">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border/50 pb-0">
        <button
          onClick={() => setTab("configs")}
          className={`px-4 py-2 font-mono text-sm border-b-2 transition-colors ${
            tab === "configs"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Configs
          {runningCount > 0 && (
            <span className="ml-2 bg-primary/20 text-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {runningCount} live
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("holdings")}
          className={`px-4 py-2 font-mono text-sm border-b-2 transition-colors ${
            tab === "holdings"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Holdings
          {holdingsCount > 0 && (
            <span className="ml-2 bg-blue-500/20 text-blue-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {holdingsCount}
            </span>
          )}
          {pendingCount > 0 && (
            <span className="ml-1 bg-orange-500/20 text-orange-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {pendingCount} pending
            </span>
          )}
        </button>
      </div>

      {tab === "configs" && (
        <>
          {/* Kill switch — always visible at top */}
          <KillSwitchPanel
            runningCount={runningCount}
            holdingsCount={holdingsCount}
            pendingCount={pendingCount}
            onDone={() => refetch()}
          />

          <div className="border border-primary/20 rounded p-3 bg-primary/5 font-mono text-xs text-muted-foreground space-y-1">
            <div className="text-primary font-semibold">How it works</div>
            <div>• Listens to Raydium AMM v4, Raydium CPMM, and Pump.fun events via WebSocket (requires Helius key)</div>
            <div>• On new pool detection → instantly buys with all selected accounts using Jupiter + optional Jito bundle</div>
            <div>• Auto-exit: timer (sell after N seconds), multiplier (sell at target price), or manual</div>
            <div>• Jito MEV bundles are not reachable from this server — transactions fall back to direct RPC automatically</div>
          </div>

          <CreateConfigPanel onCreated={() => refetch()} />

          {isLoading ? (
            <div className="font-mono text-sm text-muted-foreground animate-pulse">Loading configs...</div>
          ) : (configs ?? []).length === 0 ? (
            <div className="text-center py-10 font-mono text-muted-foreground text-sm">
              No sniper configs yet. Create one above to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {(configs ?? []).map(cfg => (
                <ConfigCard key={cfg.id} config={cfg} onRefresh={() => refetch()} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "holdings" && <HoldingsView />}
    </div>
  );
}
