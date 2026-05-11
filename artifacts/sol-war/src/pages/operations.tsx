import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Crosshair, Bot, ListTodo, Activity, TrendingUp, Zap, Clock, CheckCircle2, XCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}/api${path}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface SniperConfig {
  id: number;
  name: string;
  status: string;
  totalSnipes: number;
  totalPnlSol: number;
  accountIds: string;
  solPerAccount: number;
  enableCtoBuy: boolean;
  startedAt?: string | null;
}

interface ArbConfig {
  id: number;
  name: string;
  status: string;
  mintAddress: string;
  tokenSymbol?: string;
  totalArbs: number;
  totalProfitSol: number;
  startedAt?: string | null;
}

interface Task {
  id: number;
  type: "dca_buy" | "exit_sell" | "limit_buy";
  label: string;
  status: string;
  mintAddress: string;
  dcaRoundsDone: number;
  dcaRoundsTotal?: number | null;
  triggerPriceUsd?: number | null;
  triggerCondition?: string | null;
  nextRunAt?: number | null;
  lastResult?: string | null;
}

interface VolumeJob {
  id: number;
  mintAddress: string;
  tokenSymbol?: string;
  status: string;
  totalBuys: number;
  totalSells: number;
  totalVolumeSol: number;
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg =
    status === "running" ? { color: "text-blue-400 border-blue-700/40 bg-blue-950/20", icon: <RefreshCw className="w-3 h-3 animate-spin" />, label: "Running" } :
    status === "idle"    ? { color: "text-muted-foreground border-border/40 bg-muted/10", icon: <Clock className="w-3 h-3" />, label: "Idle" } :
    status === "pending" ? { color: "text-yellow-400 border-yellow-700/40 bg-yellow-950/20", icon: <Clock className="w-3 h-3" />, label: "Pending" } :
    status === "completed" ? { color: "text-green-400 border-green-700/40 bg-green-950/20", icon: <CheckCircle2 className="w-3 h-3" />, label: "Done" } :
    status === "failed" ? { color: "text-red-400 border-red-700/40 bg-red-950/20", icon: <XCircle className="w-3 h-3" />, label: "Failed" } :
    { color: "text-muted-foreground border-border/40 bg-muted/10", icon: <XCircle className="w-3 h-3" />, label: status };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-mono ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function Pnl({ sol }: { sol: number }) {
  const pos = sol >= 0;
  return (
    <span className={`font-mono text-xs font-medium ${pos ? "text-green-400" : "text-red-400"}`}>
      {pos ? "+" : ""}{sol.toFixed(4)} SOL
    </span>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ icon, title, count, linkTo, linkLabel, children }: {
  icon: React.ReactNode; title: string; count?: number; linkTo: string; linkLabel: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <h2 className="text-base font-mono font-bold text-foreground flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          {title}
          {count !== undefined && (
            <span className="px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground">{count}</span>
          )}
        </h2>
        <Link href={linkTo} className="inline-flex items-center gap-1 text-xs font-mono text-primary hover:underline">
          {linkLabel} <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
      {children}
    </div>
  );
}

// ─── Stat pill ────────────────────────────────────────────────────────────────
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 rounded bg-muted/20 border border-border/30">
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs font-medium">{value}</span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function OperationsPage() {
  const { data: snipers = [], isLoading: sniperLoading } = useQuery<SniperConfig[]>({
    queryKey: ["sniper-configs"],
    queryFn: () => apiFetch<SniperConfig[]>("/sniper/configs"),
    refetchInterval: 5000,
  });

  const { data: arbs = [], isLoading: arbLoading } = useQuery<ArbConfig[]>({
    queryKey: ["arb-configs"],
    queryFn: () => apiFetch<ArbConfig[]>("/arb/configs"),
    refetchInterval: 5000,
  });

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["tasks"],
    queryFn: () => apiFetch<Task[]>("/tasks"),
    refetchInterval: 5000,
  });

  const { data: volumes = [], isLoading: volLoading } = useQuery<VolumeJob[]>({
    queryKey: ["volume-jobs"],
    queryFn: () => apiFetch<VolumeJob[]>("/volume/jobs"),
    refetchInterval: 5000,
  });

  const activeSnipers = snipers.filter(s => s.status === "running");
  const activeArbs = arbs.filter(a => a.status === "running");
  const activeTasks = tasks.filter(t => t.status === "pending" || t.status === "running");
  const activeVolumes = volumes.filter(v => v.status === "running");

  const totalActiveOps = activeSnipers.length + activeArbs.length + activeTasks.length + activeVolumes.length;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-mono font-bold tracking-tight text-glow flex items-center gap-3">
          <Activity className="w-8 h-8 text-primary" />
          Operations
        </h1>
        <p className="text-muted-foreground font-mono text-sm mt-1">
          Live view of all active bots, engines, and queued tasks.
        </p>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Snipers", value: activeSnipers.length, icon: <Crosshair className="w-4 h-4 text-primary" />, total: snipers.length },
          { label: "Arb Engines", value: activeArbs.length, icon: <Bot className="w-4 h-4 text-cyan-400" />, total: arbs.length },
          { label: "Queued Tasks", value: activeTasks.length, icon: <ListTodo className="w-4 h-4 text-yellow-400" />, total: tasks.length },
          { label: "Volume Bots", value: activeVolumes.length, icon: <Zap className="w-4 h-4 text-purple-400" />, total: volumes.length },
        ].map(s => (
          <div key={s.label} className={`bg-card border rounded-lg p-4 flex items-center gap-3 ${s.value > 0 ? "border-primary/30" : "border-border/50"}`}>
            {s.icon}
            <div>
              <div className="font-mono text-2xl font-bold">{s.value}<span className="text-muted-foreground text-sm font-normal">/{s.total}</span></div>
              <div className="font-mono text-xs text-muted-foreground">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {totalActiveOps === 0 && !sniperLoading && !arbLoading && !tasksLoading && !volLoading && (
        <div className="flex flex-col items-center justify-center p-10 border border-dashed border-border/50 rounded-xl bg-card/30 text-center">
          <Activity className="w-10 h-10 text-muted-foreground mb-3 opacity-40" />
          <h3 className="font-mono text-base font-medium">No active operations</h3>
          <p className="font-mono text-sm text-muted-foreground mt-1">
            Start the Sniper, Arb Engine, Volume Bot, or create a Task to see live activity here.
          </p>
        </div>
      )}

      {/* Sniper section */}
      <Section icon={<Crosshair className="w-4 h-4" />} title="Sniper" count={activeSnipers.length} linkTo="/sniper" linkLabel="Manage Snipers">
        {sniperLoading ? <div className="h-12 rounded-lg bg-card/50 animate-pulse" /> :
        activeSnipers.length === 0 ? (
          <p className="text-xs font-mono text-muted-foreground">No snipers currently running.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {activeSnipers.map(s => {
              const accountIds: number[] = (() => { try { return JSON.parse(s.accountIds) } catch { return [] } })();
              return (
                <div key={s.id} className="bg-card border border-primary/20 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold truncate">{s.name}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <Stat label="Snipes" value={s.totalSnipes} />
                    <Stat label="P&L" value={<Pnl sol={s.totalPnlSol} />} />
                    <Stat label="Accounts" value={accountIds.length} />
                    <Stat label="SOL/snipe" value={`${s.solPerAccount} SOL`} />
                  </div>
                  {s.enableCtoBuy && (
                    <div className="flex items-center gap-1 text-xs font-mono text-orange-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                      CTO Auto-Buy active
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Arb section */}
      <Section icon={<Bot className="w-4 h-4" />} title="Arb Engine" count={activeArbs.length} linkTo="/arb" linkLabel="Manage Arb">
        {arbLoading ? <div className="h-12 rounded-lg bg-card/50 animate-pulse" /> :
        activeArbs.length === 0 ? (
          <p className="text-xs font-mono text-muted-foreground">No arb engines currently running.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {activeArbs.map(a => (
              <div key={a.id} className="bg-card border border-cyan-400/20 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold truncate">{a.name}</span>
                  <StatusBadge status={a.status} />
                </div>
                <div className="font-mono text-xs text-muted-foreground truncate">{a.tokenSymbol ?? a.mintAddress.slice(0, 12)}…</div>
                <div className="grid grid-cols-2 gap-1">
                  <Stat label="Arbs" value={a.totalArbs} />
                  <Stat label="Profit" value={<Pnl sol={a.totalProfitSol} />} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Volume section */}
      <Section icon={<Zap className="w-4 h-4" />} title="Volume Bot" count={activeVolumes.length} linkTo="/volume" linkLabel="Manage Volume">
        {volLoading ? <div className="h-12 rounded-lg bg-card/50 animate-pulse" /> :
        activeVolumes.length === 0 ? (
          <p className="text-xs font-mono text-muted-foreground">No volume bots currently running.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {activeVolumes.map(v => (
              <div key={v.id} className="bg-card border border-purple-400/20 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold truncate">{v.tokenSymbol ?? v.mintAddress.slice(0, 12) + "…"}</span>
                  <StatusBadge status={v.status} />
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <Stat label="Buys" value={v.totalBuys} />
                  <Stat label="Sells" value={v.totalSells} />
                  <Stat label="Volume" value={`${v.totalVolumeSol.toFixed(2)} SOL`} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Task Queue section */}
      <Section icon={<ListTodo className="w-4 h-4" />} title="Task Queue" count={activeTasks.length} linkTo="/tasks" linkLabel="Manage Tasks">
        {tasksLoading ? <div className="h-12 rounded-lg bg-card/50 animate-pulse" /> :
        activeTasks.length === 0 ? (
          <p className="text-xs font-mono text-muted-foreground">No pending or running tasks.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {activeTasks.map(t => (
              <div key={t.id} className="bg-card border border-yellow-400/20 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-mono text-sm font-semibold truncate">{t.label}</div>
                    <div className="font-mono text-xs text-muted-foreground capitalize">{t.type.replace("_", " ")}</div>
                  </div>
                  <StatusBadge status={t.status} />
                </div>
                {t.type === "dca_buy" && t.dcaRoundsTotal && (
                  <div className="space-y-1">
                    <div className="text-xs font-mono text-muted-foreground">{t.dcaRoundsDone}/{t.dcaRoundsTotal} rounds</div>
                    <div className="h-1 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${(t.dcaRoundsDone / t.dcaRoundsTotal) * 100}%` }} />
                    </div>
                  </div>
                )}
                {(t.type === "exit_sell" || t.type === "limit_buy") && t.triggerPriceUsd && (
                  <div className="text-xs font-mono text-muted-foreground">
                    Watching: price {t.triggerCondition} ${t.triggerPriceUsd.toFixed(6)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
