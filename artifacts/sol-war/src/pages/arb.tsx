import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Bot, Plus, Trash2, Play, Square, RefreshCw, TrendingUp, TrendingDown,
  Minus, Zap, Target, AlertTriangle, CheckCircle2, XCircle, Clock, Activity,
  Lock, ArrowRight
} from "lucide-react";
import {
  useListArbConfigs,
  useCreateArbConfig,
  useDeleteArbConfig,
  useStartArbConfig,
  useStopArbConfig,
  useGetArbLogs,
} from "@workspace/api-client-react";
import type { ArbConfig, ArbLog } from "@workspace/api-client-react";
import { useListAllAccounts } from "@/hooks/use-accounts";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// All DEXes we can scan — must match Jupiter's label names exactly
const ALL_DEXES = [
  { key: "Raydium",         label: "Raydium AMM v4",      tag: "RAY" },
  { key: "Raydium CLMM",   label: "Raydium CLMM",         tag: "RAY+" },
  { key: "Orca",            label: "Orca (legacy)",        tag: "ORC" },
  { key: "Whirlpool",       label: "Orca Whirlpools",      tag: "WHP" },
  { key: "Meteora DLMM",   label: "Meteora DLMM",          tag: "MET" },
  { key: "Meteora Pools",  label: "Meteora Standard AMM",  tag: "MET+" },
  { key: "Pump.fun AMM",   label: "PumpSwap (graduated)",  tag: "PSW" },
  { key: "Fluxbeam",       label: "FluxBeam",              tag: "FLX" },
];

const DEFAULT_DEXES = ["Raydium", "Raydium CLMM", "Orca", "Whirlpool", "Meteora DLMM", "Pump.fun AMM"];

const createSchema = z.object({
  name: z.string().min(1, "Required"),
  accountId: z.coerce.number().int().positive("Select an account"),
  mintAddress: z.string().min(32, "Valid mint address required"),
  tokenSymbol: z.string().optional(),
  inputAmountSol: z.coerce.number().positive().default(0.1),
  minProfitSol: z.coerce.number().min(0).default(0.001),
  jitoTipLamports: z.coerce.number().int().min(0).default(10000),
  scanIntervalMs: z.coerce.number().int().min(1000).default(5000),
  slippageBps: z.coerce.number().int().min(1).default(100),
  targetDexes: z.array(z.string()).min(2, "Select at least 2 DEXes").default(DEFAULT_DEXES),
});

const startSchema = z.object({ password: z.string().min(1, "Required") });

function DexTag({ dex }: { dex: string }) {
  const d = ALL_DEXES.find(d => d.key === dex);
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-primary/10 text-primary border border-primary/20">
      {d?.tag ?? dex.slice(0, 4).toUpperCase()}
    </span>
  );
}

function StatusBadge({ status, isRunning }: { status: string; isRunning: boolean }) {
  if (isRunning || status === "running") {
    return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 font-mono text-[10px] animate-pulse">● SCANNING</Badge>;
  }
  return <Badge variant="outline" className="text-muted-foreground font-mono text-[10px]">IDLE</Badge>;
}

function LogRow({ log }: { log: ArbLog }) {
  const isExecuted = log.status === "executed";
  const isLoss = log.status === "executed_loss";
  const isFailed = log.status === "failed" || log.status === "sell_failed";
  const isOpportunity = log.status === "opportunity";
  const isNoOpp = log.status === "no_opportunity";
  const isExecuting = log.status === "executing";

  const ts = new Date(log.createdAt).toLocaleTimeString();

  const dexPair = log.buyDex && log.sellDex
    ? <><DexTag dex={log.buyDex} /><ArrowRight className="w-2.5 h-2.5 text-muted-foreground/40 inline mx-0.5" /><DexTag dex={log.sellDex} /></>
    : null;

  return (
    <div className={`flex items-center gap-2 text-[11px] font-mono px-3 py-1.5 border-b border-border/20 last:border-0
      ${isExecuted ? "bg-green-500/5" : ""}
      ${isLoss ? "bg-orange-500/5" : ""}
      ${isFailed ? "bg-red-500/5" : ""}
      ${isOpportunity ? "bg-yellow-500/5" : ""}
    `}>
      <span className="text-muted-foreground w-[68px] shrink-0">{ts}</span>

      {isExecuted   && <CheckCircle2  className="w-3 h-3 text-green-400 shrink-0" />}
      {isLoss       && <TrendingDown  className="w-3 h-3 text-orange-400 shrink-0" />}
      {isFailed     && <XCircle       className="w-3 h-3 text-red-400 shrink-0" />}
      {isOpportunity && <Zap          className="w-3 h-3 text-yellow-400 shrink-0" />}
      {isNoOpp      && <Minus         className="w-3 h-3 text-muted-foreground/30 shrink-0" />}
      {isExecuting  && <RefreshCw     className="w-3 h-3 text-blue-400 animate-spin shrink-0" />}

      {/* DEX pair tags */}
      {dexPair && <span className="flex items-center gap-0.5 shrink-0">{dexPair}</span>}

      <span className={`flex-1 truncate
        ${isExecuted ? "text-green-400" : ""}
        ${isLoss ? "text-orange-400" : ""}
        ${isFailed ? "text-red-400" : ""}
        ${isOpportunity ? "text-yellow-400" : ""}
        ${isNoOpp ? "text-muted-foreground/30" : ""}
      `}>
        {isNoOpp      && `no opp  profit: ${(log.profitSol ?? 0) >= 0 ? "+" : ""}${(log.profitSol ?? 0).toFixed(5)} SOL`}
        {isOpportunity && `OPPORTUNITY  +${log.profitSol?.toFixed(5)} SOL`}
        {isExecuting  && "executing..."}
        {isExecuted   && `+${log.profitSol?.toFixed(5)} SOL  (in: ${log.inputSol.toFixed(4)}  out: ${log.outputSol?.toFixed(4)})`}
        {isLoss       && `${log.profitSol?.toFixed(5)} SOL  (in: ${log.inputSol.toFixed(4)}  out: ${log.outputSol?.toFixed(4)})`}
        {isFailed     && (log.error ?? "failed")}
      </span>

      {log.buyTxSignature && (
        <a href={`https://solscan.io/tx/${log.buyTxSignature}`} target="_blank" rel="noreferrer"
          className="text-primary/50 hover:text-primary text-[9px] shrink-0">BUY↗</a>
      )}
      {log.sellTxSignature && (
        <a href={`https://solscan.io/tx/${log.sellTxSignature}`} target="_blank" rel="noreferrer"
          className="text-primary/50 hover:text-primary text-[9px] shrink-0">SELL↗</a>
      )}
    </div>
  );
}

function ArbConfigCard({ cfg, onRefresh }: { cfg: ArbConfig; onRefresh: () => void }) {
  const [startOpen, setStartOpen] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const { toast } = useToast();
  const deleteMutation = useDeleteArbConfig();
  const startMutation = useStartArbConfig();
  const stopMutation = useStopArbConfig();

  const { data: logs, refetch: refetchLogs } = useGetArbLogs(cfg.id, { limit: 80 }, {
    query: { enabled: showLogs, refetchInterval: cfg.isRunning ? 2000 : false }
  });

  const startForm = useForm<z.infer<typeof startSchema>>({
    resolver: zodResolver(startSchema),
    defaultValues: { password: "" }
  });

  const profitColor = (cfg.totalProfitSol ?? 0) >= 0 ? "text-green-400" : "text-red-400";
  const dexList = Array.isArray(cfg.targetDexes) ? cfg.targetDexes as unknown as string[] : [];

  const handleStart = (data: z.infer<typeof startSchema>) => {
    startMutation.mutate({ id: cfg.id, data }, {
      onSuccess: () => { setStartOpen(false); startForm.reset(); onRefresh(); toast({ title: "Bot started", description: `${cfg.name} is scanning` }); },
      onError: (e) => toast({ title: "Failed to start", description: e.message, variant: "destructive" })
    });
  };

  const handleStop = () => {
    stopMutation.mutate({ id: cfg.id }, {
      onSuccess: () => { onRefresh(); toast({ title: "Bot stopped" }); },
      onError: (e) => toast({ title: "Failed to stop", description: e.message, variant: "destructive" })
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete arb bot "${cfg.name}"?`)) return;
    deleteMutation.mutate({ id: cfg.id }, {
      onSuccess: () => { onRefresh(); toast({ title: "Deleted" }); },
      onError: (e) => toast({ title: "Failed", description: e.message, variant: "destructive" })
    });
  };

  return (
    <Card className={`glass-panel transition-all ${cfg.isRunning ? "border-green-500/40" : "border-border/40"}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Bot className={`w-4 h-4 ${cfg.isRunning ? "text-green-400" : "text-muted-foreground"}`} />
              <span className="font-mono font-bold text-sm">{cfg.name}</span>
              <StatusBadge status={cfg.status} isRunning={cfg.isRunning} />
            </div>
            <p className="font-mono text-[10px] text-muted-foreground">
              {cfg.walletName} › {cfg.accountName} · {cfg.mintAddress.slice(0, 8)}...{cfg.tokenSymbol ? ` (${cfg.tokenSymbol})` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {cfg.isRunning ? (
              <Button size="sm" variant="outline" className="h-8 px-2 font-mono text-xs border-red-500/50 text-red-400 hover:bg-red-500/10" onClick={handleStop} disabled={stopMutation.isPending}>
                <Square className="w-3 h-3 mr-1" /> Stop
              </Button>
            ) : (
              <Dialog open={startOpen} onOpenChange={setStartOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="h-8 px-2 font-mono text-xs border-glow">
                    <Play className="w-3 h-3 mr-1" /> Start
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle className="font-mono">Start — {cfg.name}</DialogTitle></DialogHeader>
                  <Form {...startForm}>
                    <form onSubmit={startForm.handleSubmit(handleStart)} className="space-y-4">
                      <FormField control={startForm.control} name="password" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs flex items-center gap-1"><Lock className="w-3 h-3 text-primary" /> Decrypt Password</FormLabel>
                          <FormControl><Input type="password" placeholder="Master Password" className="font-mono bg-background" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <Button type="submit" className="w-full font-mono border-glow" disabled={startMutation.isPending}>
                        {startMutation.isPending ? "Starting..." : "Launch Bot"}
                      </Button>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            )}
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400" onClick={handleDelete}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-background/50 rounded-md p-2 space-y-0.5">
            <p className="font-mono text-[9px] text-muted-foreground uppercase">Input</p>
            <p className="font-mono text-xs font-bold">{cfg.inputAmountSol} SOL</p>
          </div>
          <div className="bg-background/50 rounded-md p-2 space-y-0.5">
            <p className="font-mono text-[9px] text-muted-foreground uppercase">Min Profit</p>
            <p className="font-mono text-xs font-bold text-yellow-400">{cfg.minProfitSol} SOL</p>
          </div>
          <div className="bg-background/50 rounded-md p-2 space-y-0.5">
            <p className="font-mono text-[9px] text-muted-foreground uppercase">Arbs</p>
            <p className="font-mono text-xs font-bold">{cfg.totalArbs}</p>
          </div>
          <div className="bg-background/50 rounded-md p-2 space-y-0.5">
            <p className="font-mono text-[9px] text-muted-foreground uppercase">P&L</p>
            <p className={`font-mono text-xs font-bold ${profitColor}`}>
              {(cfg.totalProfitSol ?? 0) >= 0 ? "+" : ""}{(cfg.totalProfitSol ?? 0).toFixed(5)}
            </p>
          </div>
        </div>

        {/* DEX scanning matrix */}
        <div className="space-y-1">
          <p className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">Scanning DEX pairs</p>
          <div className="flex flex-wrap gap-1">
            {dexList.map(d => <DexTag key={d} dex={d} />)}
            {dexList.length >= 2 && (
              <span className="font-mono text-[9px] text-muted-foreground/50 self-center ml-1">
                → {dexList.length * (dexList.length - 1)} cross-pairs
              </span>
            )}
          </div>
        </div>

        {/* Config details */}
        <div className="flex flex-wrap gap-2 text-[10px] font-mono text-muted-foreground">
          <span>Scan: {cfg.scanIntervalMs / 1000}s</span>
          <span>·</span>
          <span>Slip: {cfg.slippageBps / 100}%</span>
          <span>·</span>
          <span>Jito: {cfg.jitoTipLamports.toLocaleString()} lam</span>
        </div>

        {/* Log toggle */}
        <Separator className="border-border/30" />
        <button
          className="w-full text-left font-mono text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          onClick={() => { setShowLogs(!showLogs); if (!showLogs) refetchLogs(); }}
        >
          <Activity className="w-3 h-3" />
          {showLogs ? "Hide" : "Show"} Live Feed
          {cfg.isRunning && showLogs && <span className="ml-auto text-green-400 animate-pulse">● LIVE</span>}
        </button>

        {showLogs && (
          <div className="bg-background/70 rounded-md border border-border/30 max-h-64 overflow-y-auto">
            {!logs || logs.length === 0 ? (
              <div className="p-4 text-center font-mono text-xs text-muted-foreground opacity-60">
                <Clock className="w-4 h-4 mx-auto mb-1" />
                Waiting for scan data...
              </div>
            ) : (
              logs.map((log) => <LogRow key={log.id} log={log} />)
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ArbPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: configs, isLoading, refetch } = useListArbConfigs({
    query: { refetchInterval: 5000 }
  });
  const { data: accounts } = useListAllAccounts();
  const createMutation = useCreateArbConfig();
  const { toast } = useToast();

  const createForm = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: "",
      accountId: 0,
      mintAddress: "",
      tokenSymbol: "",
      inputAmountSol: 0.1,
      minProfitSol: 0.001,
      jitoTipLamports: 10000,
      scanIntervalMs: 5000,
      slippageBps: 100,
      targetDexes: DEFAULT_DEXES,
    }
  });

  const handleCreate = (data: z.infer<typeof createSchema>) => {
    createMutation.mutate({ data: { ...data, tokenSymbol: data.tokenSymbol || undefined } }, {
      onSuccess: () => { setCreateOpen(false); createForm.reset(); refetch(); toast({ title: "Arb bot created" }); },
      onError: (e) => toast({ title: "Failed", description: e.message, variant: "destructive" })
    });
  };

  const totalProfit = configs?.reduce((s, c) => s + (c.totalProfitSol ?? 0), 0) ?? 0;
  const totalArbs = configs?.reduce((s, c) => s + c.totalArbs, 0) ?? 0;
  const runningCount = configs?.filter(c => c.isRunning).length ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-mono font-bold text-glow flex items-center gap-3">
            <Bot className="w-8 h-8 text-primary" /> Arb Engine
          </h1>
          <p className="text-muted-foreground font-mono text-sm mt-1">
            Cross-DEX SOL→TOKEN→SOL arbitrage via Jupiter + Jito
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="font-mono border-glow"><Plus className="w-4 h-4 mr-2" /> New Bot</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-mono flex items-center gap-2"><Bot className="w-4 h-4 text-primary" /> Configure Arb Bot</DialogTitle>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={createForm.control} name="name" render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel className="font-mono text-xs">Bot Name</FormLabel>
                      <FormControl><Input placeholder="e.g. BONK Cross-DEX #1" className="font-mono bg-background" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={createForm.control} name="accountId" render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel className="font-mono text-xs">Trading Account</FormLabel>
                      <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : ""}>
                        <FormControl>
                          <SelectTrigger className="font-mono text-xs bg-background"><SelectValue placeholder="Select account..." /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {accounts?.map((acc) => (
                            <SelectItem key={acc.id} value={String(acc.id)} className="font-mono text-xs">
                              {acc.walletName} › {acc.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={createForm.control} name="mintAddress" render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel className="font-mono text-xs">Token Mint Address</FormLabel>
                      <FormControl><Input placeholder="Token mint..." className="font-mono bg-background text-xs" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={createForm.control} name="tokenSymbol" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs">Symbol (optional)</FormLabel>
                      <FormControl><Input placeholder="e.g. BONK" className="font-mono bg-background" {...field} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={createForm.control} name="inputAmountSol" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs">Trade Size (SOL)</FormLabel>
                      <FormControl><Input type="number" step="0.001" className="font-mono bg-background" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={createForm.control} name="minProfitSol" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs">Min Profit (SOL)</FormLabel>
                      <FormControl><Input type="number" step="0.0001" className="font-mono bg-background" {...field} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={createForm.control} name="scanIntervalMs" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs">Scan Interval (ms)</FormLabel>
                      <FormControl><Input type="number" step="100" className="font-mono bg-background" {...field} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={createForm.control} name="slippageBps" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs">Slippage (BPS)</FormLabel>
                      <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                    </FormItem>
                  )} />

                  <FormField control={createForm.control} name="jitoTipLamports" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs">Jito Tip (Lamports)</FormLabel>
                      <FormControl><Input type="number" className="font-mono bg-background" {...field} /></FormControl>
                    </FormItem>
                  )} />
                </div>

                {/* DEX picker */}
                <Controller
                  control={createForm.control}
                  name="targetDexes"
                  render={({ field }) => (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="font-mono text-xs">DEXes to Scan</Label>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {(field.value ?? []).length} selected → {(field.value ?? []).length * ((field.value ?? []).length - 1)} cross-pairs
                        </span>
                      </div>
                      <div className="bg-background/50 rounded-md border border-border/40 p-3 space-y-2">
                        {ALL_DEXES.map((dex) => {
                          const val: string[] = field.value ?? [];
                          const checked = val.includes(dex.key);
                          return (
                            <div key={dex.key} className="flex items-center gap-2">
                              <Checkbox
                                id={`dex-${dex.key}`}
                                checked={checked}
                                onCheckedChange={(v) => {
                                  if (v) field.onChange([...val, dex.key]);
                                  else field.onChange(val.filter((k: string) => k !== dex.key));
                                }}
                              />
                              <label htmlFor={`dex-${dex.key}`} className="flex items-center gap-2 cursor-pointer flex-1">
                                <DexTag dex={dex.key} />
                                <span className="font-mono text-xs text-muted-foreground">{dex.label}</span>
                              </label>
                            </div>
                          );
                        })}
                      </div>
                      {createForm.formState.errors.targetDexes && (
                        <p className="text-xs text-red-400 font-mono">{createForm.formState.errors.targetDexes.message}</p>
                      )}
                    </div>
                  )}
                />

                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 text-[11px] font-mono text-yellow-400 space-y-1">
                  <p className="font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Real funds</p>
                  <p>Bot scans all (buy DEX × sell DEX) pairs each interval. Executes only when the best cross-pair profit ≥ your threshold.</p>
                  <p>If sell fails after a buy, tokens remain in the wallet.</p>
                </div>

                <Button type="submit" className="w-full font-mono border-glow" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating..." : "Create Arb Bot"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="glass-panel">
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${runningCount > 0 ? "bg-green-400 animate-pulse" : "bg-muted-foreground/30"}`} />
            <div>
              <p className="font-mono text-[10px] text-muted-foreground uppercase">Active Bots</p>
              <p className="font-mono text-xl font-bold">{runningCount} <span className="text-xs text-muted-foreground">/ {configs?.length ?? 0}</span></p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-panel">
          <CardContent className="p-4 flex items-center gap-3">
            <Target className="w-5 h-5 text-primary" />
            <div>
              <p className="font-mono text-[10px] text-muted-foreground uppercase">Total Arbs</p>
              <p className="font-mono text-xl font-bold">{totalArbs}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-panel">
          <CardContent className="p-4 flex items-center gap-3">
            {totalProfit >= 0
              ? <TrendingUp className="w-5 h-5 text-green-400" />
              : <TrendingDown className="w-5 h-5 text-red-400" />}
            <div>
              <p className="font-mono text-[10px] text-muted-foreground uppercase">Total P&L</p>
              <p className={`font-mono text-xl font-bold ${totalProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                {totalProfit >= 0 ? "+" : ""}{totalProfit.toFixed(5)} SOL
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bot list */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-40 rounded-lg bg-card/40 animate-pulse" />)}</div>
      ) : !configs || configs.length === 0 ? (
        <Card className="glass-panel border-dashed">
          <CardContent className="p-12 text-center space-y-3">
            <Bot className="w-10 h-10 mx-auto text-muted-foreground/30" />
            <p className="font-mono text-sm text-muted-foreground">No arb bots configured yet.</p>
            <p className="font-mono text-xs text-muted-foreground/60">
              Each bot scans all selected DEX pairs simultaneously and executes when buy-DEX price is lower than sell-DEX price (minus fees).
            </p>
            <Button variant="outline" className="font-mono" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Create Your First Bot
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {configs.map((cfg) => <ArbConfigCard key={cfg.id} cfg={cfg} onRefresh={refetch} />)}
        </div>
      )}
    </div>
  );
}
