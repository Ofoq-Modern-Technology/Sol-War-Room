import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, XCircle, CheckCircle2, Clock, AlertTriangle, Lock, TrendingUp, TrendingDown, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────
interface Task {
  id: number;
  type: "dca_buy" | "exit_sell" | "limit_buy";
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  mintAddress: string;
  accountIds: string; // JSON
  slippageBps: number;
  dcaAmountSol?: number | null;
  dcaIntervalSec?: number | null;
  dcaRoundsTotal?: number | null;
  dcaRoundsDone: number;
  triggerPriceUsd?: number | null;
  triggerCondition?: string | null;
  sellPct?: number | null;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastResult?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

interface Account {
  id: number;
  name: string;
  publicKey: string;
  walletName: string;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api${path}`, init);
  if (!r.ok) {
    const e = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(e.error ?? `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS = {
  pending:   { label: "Pending",   color: "text-yellow-400",  bg: "border-yellow-700/40 bg-yellow-950/20", icon: <Clock className="w-3 h-3" /> },
  running:   { label: "Running",   color: "text-blue-400",    bg: "border-blue-700/40 bg-blue-950/20",    icon: <RefreshCw className="w-3 h-3 animate-spin" /> },
  completed: { label: "Completed", color: "text-green-400",   bg: "border-green-700/40 bg-green-950/20", icon: <CheckCircle2 className="w-3 h-3" /> },
  failed:    { label: "Failed",    color: "text-red-400",     bg: "border-red-700/40 bg-red-950/20",     icon: <XCircle className="w-3 h-3" /> },
  cancelled: { label: "Cancelled", color: "text-muted-foreground", bg: "border-border/40 bg-muted/10",   icon: <XCircle className="w-3 h-3" /> },
};

const TYPE_LABELS = {
  dca_buy:   { label: "DCA Buy",      color: "text-cyan-400",   icon: <TrendingUp className="w-3 h-3" /> },
  exit_sell: { label: "Exit Sell",    color: "text-orange-400", icon: <TrendingDown className="w-3 h-3" /> },
  limit_buy: { label: "Limit Buy",    color: "text-purple-400", icon: <TrendingUp className="w-3 h-3" /> },
};

function fmtTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

function fmtCountdown(ms: number | null | undefined): string {
  if (!ms) return "";
  const diff = ms - Date.now();
  if (diff <= 0) return "now";
  const secs = Math.ceil(diff / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.ceil(secs / 60)}m`;
}

// ─── Task card ────────────────────────────────────────────────────────────────
function TaskCard({ task, onCancel, onDelete }: { task: Task; onCancel: (id: number) => void; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const st = STATUS[task.status];
  const ty = TYPE_LABELS[task.type];
  const accountIds: number[] = JSON.parse(task.accountIds);
  const lastResult = task.lastResult ? (() => { try { return JSON.parse(task.lastResult!) as { round?: number; priceUsd?: number; results?: string[]; anyOk?: boolean } } catch { return null } })() : null;

  const canCancel = task.status === "pending" || task.status === "running";
  const isDone = task.status === "completed" || task.status === "cancelled" || task.status === "failed";

  return (
    <div className={`bg-card border rounded-lg p-4 space-y-3 ${st.bg}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-xs font-mono font-medium ${ty.color}`}>
              {ty.icon}{ty.label}
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border ${st.color} ${st.bg}`}>
              {st.icon}{st.label}
            </span>
          </div>
          <p className="font-mono font-semibold text-sm text-foreground truncate">{task.label}</p>
          <p className="font-mono text-xs text-muted-foreground truncate">{task.mintAddress}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {canCancel && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-yellow-400" title="Cancel" onClick={() => onCancel(task.id)}>
              <XCircle className="w-4 h-4" />
            </Button>
          )}
          {isDone && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Delete" onClick={() => onDelete(task.id)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => setExpanded(e => !e)}>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* DCA progress bar */}
      {task.type === "dca_buy" && task.dcaRoundsTotal && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
            <span>Round {task.dcaRoundsDone}/{task.dcaRoundsTotal}</span>
            {task.nextRunAt && task.status === "pending" && (
              <span className="text-cyan-400">next in {fmtCountdown(task.nextRunAt)}</span>
            )}
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, (task.dcaRoundsDone / task.dcaRoundsTotal) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Exit / Limit trigger info */}
      {(task.type === "exit_sell" || task.type === "limit_buy") && task.triggerPriceUsd && (
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-muted-foreground">Trigger:</span>
          <span className={task.type === "exit_sell" ? "text-orange-400" : "text-purple-400"}>
            price {task.triggerCondition} ${task.triggerPriceUsd.toFixed(6)}
          </span>
          {task.type === "exit_sell" && task.sellPct && (
            <span className="text-muted-foreground">· sell {task.sellPct}%</span>
          )}
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="pt-2 border-t border-border/30 space-y-2 text-xs font-mono">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>Accounts: {accountIds.length}</span>
            <span>·</span>
            <span>Slippage: {(task.slippageBps / 100).toFixed(1)}%</span>
            {task.dcaAmountSol && <><span>·</span><span>{task.dcaAmountSol} SOL/cycle</span></>}
            {task.dcaIntervalSec && <><span>·</span><span>every {task.dcaIntervalSec}s</span></>}
          </div>
          {task.lastRunAt && (
            <div className="text-muted-foreground">Last run: {fmtTime(task.lastRunAt)}</div>
          )}
          {lastResult?.results && (
            <div className="space-y-0.5">
              {lastResult.results.map((r, i) => (
                <div key={i} className={r.includes("✓") ? "text-green-400" : "text-red-400"}>{r}</div>
              ))}
            </div>
          )}
          {task.errorMessage && (
            <div className="flex items-start gap-1 text-red-400">
              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              {task.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Create task form ─────────────────────────────────────────────────────────
function CreateTaskDialog({ accounts }: { accounts: Account[] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"dca_buy" | "exit_sell" | "limit_buy">("dca_buy");
  const [label, setLabel] = useState("");
  const [mint, setMint] = useState("");
  const [password, setPassword] = useState("");
  const [slippage, setSlippage] = useState("15");
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>([]);
  // DCA
  const [dcaAmount, setDcaAmount] = useState("0.05");
  const [dcaInterval, setDcaInterval] = useState("600");
  const [dcaRounds, setDcaRounds] = useState("10");
  // Exit / Limit
  const [triggerPrice, setTriggerPrice] = useState("");
  const [triggerCond, setTriggerCond] = useState<"above" | "below">("above");
  const [sellPct, setSellPct] = useState("100");

  const { toast } = useToast();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);

  function toggleAccount(id: number) {
    setSelectedAccounts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function submit() {
    if (!label || !mint || !password || selectedAccounts.length === 0) {
      toast({ title: "Missing fields", description: "Fill in all required fields and select at least one account.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        type, label, mintAddress: mint, password,
        accountIds: selectedAccounts,
        slippageBps: Math.round(parseFloat(slippage) * 100),
      };
      if (type === "dca_buy") {
        body.dcaAmountSol = parseFloat(dcaAmount);
        body.dcaIntervalSec = parseInt(dcaInterval);
        body.dcaRoundsTotal = parseInt(dcaRounds);
      } else {
        body.triggerPriceUsd = parseFloat(triggerPrice);
        body.triggerCondition = triggerCond;
        if (type === "exit_sell") body.sellPct = parseFloat(sellPct);
        if (type === "limit_buy") body.dcaAmountSol = parseFloat(dcaAmount);
      }
      await apiFetch("/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      setOpen(false);
      toast({ title: "Task created", description: `${label} is now queued.` });
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="font-mono">
          <Plus className="w-4 h-4 mr-2" /> New Task
        </Button>
      </DialogTrigger>
      <DialogContent className="border-primary/20 bg-card/95 backdrop-blur-lg max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-primary flex items-center gap-2">
            <Plus className="w-5 h-5" /> Create Task
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Type selector */}
          <div className="flex gap-1 border-b border-border/50 pb-1">
            {(["dca_buy", "exit_sell", "limit_buy"] as const).map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`px-3 py-1.5 text-xs font-mono border-b-2 transition-colors ${type === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {TYPE_LABELS[t].label}
              </button>
            ))}
          </div>

          {/* Description */}
          <p className="text-xs text-muted-foreground font-mono">
            {type === "dca_buy" && "Buys a fixed SOL amount of the token on a recurring schedule until all rounds are done."}
            {type === "exit_sell" && "Watches the token price and sells a percentage of holdings when the price threshold is crossed."}
            {type === "limit_buy" && "Watches the token price and buys once when the price drops to your target."}
          </p>

          {/* Common fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-xs font-mono text-muted-foreground">Label</label>
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="My DCA strategy" className="font-mono text-sm bg-background" />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-xs font-mono text-muted-foreground">Token Mint Address</label>
              <Input value={mint} onChange={e => setMint(e.target.value)} placeholder="So11…" className="font-mono text-sm bg-background" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-mono text-muted-foreground">Slippage %</label>
              <Input value={slippage} onChange={e => setSlippage(e.target.value)} type="number" step="0.1" className="font-mono text-sm bg-background" />
            </div>
          </div>

          {/* DCA fields */}
          {type === "dca_buy" && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-mono text-muted-foreground">SOL / cycle</label>
                <Input value={dcaAmount} onChange={e => setDcaAmount(e.target.value)} type="number" step="0.01" className="font-mono text-sm bg-background" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-mono text-muted-foreground">Interval (sec)</label>
                <Input value={dcaInterval} onChange={e => setDcaInterval(e.target.value)} type="number" className="font-mono text-sm bg-background" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-mono text-muted-foreground">Rounds</label>
                <Input value={dcaRounds} onChange={e => setDcaRounds(e.target.value)} type="number" className="font-mono text-sm bg-background" />
              </div>
            </div>
          )}

          {/* Exit / Limit fields */}
          {(type === "exit_sell" || type === "limit_buy") && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-mono text-muted-foreground">Trigger price (USD)</label>
                <Input value={triggerPrice} onChange={e => setTriggerPrice(e.target.value)} type="number" step="0.000001" placeholder="0.001234" className="font-mono text-sm bg-background" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-mono text-muted-foreground">Condition</label>
                <select value={triggerCond} onChange={e => setTriggerCond(e.target.value as "above" | "below")}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background font-mono text-sm">
                  <option value="above">Price rises above</option>
                  <option value="below">Price drops below</option>
                </select>
              </div>
              {type === "exit_sell" && (
                <div className="space-y-1">
                  <label className="text-xs font-mono text-muted-foreground">Sell % of balance</label>
                  <Input value={sellPct} onChange={e => setSellPct(e.target.value)} type="number" min="1" max="100" className="font-mono text-sm bg-background" />
                </div>
              )}
              {type === "limit_buy" && (
                <div className="space-y-1">
                  <label className="text-xs font-mono text-muted-foreground">Buy amount (SOL)</label>
                  <Input value={dcaAmount} onChange={e => setDcaAmount(e.target.value)} type="number" step="0.01" className="font-mono text-sm bg-background" />
                </div>
              )}
            </div>
          )}

          {/* Password */}
          <div className="space-y-1">
            <label className="text-xs font-mono text-muted-foreground">Wallet Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="font-mono pl-9 bg-background" />
            </div>
            <p className="text-xs text-yellow-400/80 font-mono">Stored to execute this task automatically while the server runs.</p>
          </div>

          {/* Account selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono text-muted-foreground">Accounts ({selectedAccounts.length} selected)</label>
              <button onClick={() => setSelectedAccounts(selectedAccounts.length === accounts.length ? [] : accounts.map(a => a.id))}
                className="text-xs font-mono text-primary hover:underline">
                {selectedAccounts.length === accounts.length ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="max-h-36 overflow-y-auto space-y-1 border border-border/50 rounded-md p-2 bg-background/30">
              {accounts.length === 0 && <p className="text-xs font-mono text-muted-foreground p-2">No accounts found.</p>}
              {accounts.map(acc => (
                <label key={acc.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-accent cursor-pointer">
                  <input type="checkbox" checked={selectedAccounts.includes(acc.id)} onChange={() => toggleAccount(acc.id)} className="accent-primary" />
                  <span className="font-mono text-xs truncate">{acc.name}</span>
                  <span className="font-mono text-xs text-muted-foreground ml-auto">{acc.publicKey.slice(0, 6)}…</span>
                </label>
              ))}
            </div>
          </div>

          <Button onClick={submit} className="w-full font-mono" disabled={loading}>
            {loading ? "Creating…" : "Create Task"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
const FILTERS = ["all", "pending", "running", "completed", "failed", "cancelled"] as const;

export default function TasksPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<typeof FILTERS[number]>("all");

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: () => apiFetch<Task[]>("/tasks"),
    refetchInterval: 5000,
  });

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: () => apiFetch<Account[]>("/accounts"),
  });

  // Auto-refresh countdown timers
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/tasks/${id}/cancel`, { method: "POST" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["tasks"] }); },
    onError: (e) => toast({ title: "Cancel failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["tasks"] }); },
    onError: (e) => toast({ title: "Delete failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });

  const filtered = tasks.filter(t => filter === "all" || t.status === filter);
  const counts = {
    all: tasks.length,
    pending: tasks.filter(t => t.status === "pending").length,
    running: tasks.filter(t => t.status === "running").length,
    completed: tasks.filter(t => t.status === "completed").length,
    failed: tasks.filter(t => t.status === "failed").length,
    cancelled: tasks.filter(t => t.status === "cancelled").length,
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-mono font-bold tracking-tight text-glow">Task Queue</h1>
          <p className="text-muted-foreground font-mono text-sm mt-1">
            Automated DCA buys, exit strategies, and limit orders — checked every 5s.
          </p>
        </div>
        <CreateTaskDialog accounts={accounts} />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border/50 flex-wrap">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-2 text-xs font-mono border-b-2 transition-colors capitalize flex items-center gap-1.5 ${filter === f ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            {counts[f] > 0 && <span className="px-1.5 py-0.5 rounded-full bg-muted text-xs">{counts[f]}</span>}
          </button>
        ))}
      </div>

      {/* Task list */}
      {tasksLoading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 rounded-lg bg-card/50 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 border border-dashed border-border/50 rounded-xl bg-card/30 text-center">
          <Clock className="w-10 h-10 text-muted-foreground mb-3 opacity-40" />
          <h3 className="font-mono text-base font-medium">No tasks yet</h3>
          <p className="font-mono text-sm text-muted-foreground mt-1 max-w-sm">
            {filter === "all"
              ? "Create your first task — DCA into a token, set an exit target, or place a limit buy."
              : `No ${filter} tasks.`}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map(t => (
            <TaskCard key={t.id} task={t}
              onCancel={id => cancelMutation.mutate(id)}
              onDelete={id => deleteMutation.mutate(id)} />
          ))}
        </div>
      )}
    </div>
  );
}
