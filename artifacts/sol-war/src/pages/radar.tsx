import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { SolscanLink } from "@/components/solscan-link";
import { Input } from "@/components/ui/input";
import {
  Radio, RefreshCw, Trash2, Copy, ArrowRightLeft, GraduationCap,
  Rocket, Loader2, Filter, Square, Play, RotateCcw, Search, TrendingUp,
} from "lucide-react";

type WatchMode = "all" | "graduated" | "created";

interface RadarToken {
  id: number;
  mintAddress: string;
  dex: string;
  signature: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenUri: string | null;
  isGraduation: boolean;
  poolAddress: string | null;
  detectedAt: string;
  createdAt: string;
}

interface RadarStatus {
  isRunning: boolean;
  watchMode: WatchMode;
  totalTokens: number;
}

type FilterMode = "all" | "graduation" | "pumpfun" | "raydium" | "dexscreener";

const DEX_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  pumpfun:           { label: "Pump.fun",       color: "text-purple-400",  bg: "border-purple-700/50 bg-purple-950/20" },
  raydium:           { label: "Raydium AMM",    color: "text-teal-400",    bg: "border-teal-700/50 bg-teal-950/20" },
  raydium_cpmm:      { label: "Raydium CPMM",   color: "text-cyan-400",    bg: "border-cyan-700/50 bg-cyan-950/20" },
  dexscreener:       { label: "DexScreener",    color: "text-orange-400",  bg: "border-orange-700/50 bg-orange-950/20" },
  dexscreener_boost: { label: "DS Boost",       color: "text-yellow-400",  bg: "border-yellow-700/50 bg-yellow-950/20" },
  dexscreener_cto:   { label: "CTO",            color: "text-red-400",     bg: "border-red-700/50 bg-red-950/20" },
};

const WATCH_MODE_OPTIONS: { value: WatchMode; label: string; desc: string }[] = [
  { value: "all",      label: "All",           desc: "New launches + graduations" },
  { value: "created",  label: "New Only",      desc: "Pump.fun launches only" },
  { value: "graduated",label: "Graduated Only",desc: "Raydium migrations only" },
];

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function ExternalLogoLink({ href, logoSrc, fallback, title, className = "" }: {
  href: string; logoSrc: string; fallback: string; title: string; className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={`p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center ${className}`}
      onClick={e => e.stopPropagation()}
    >
      <img
        src={logoSrc}
        alt={fallback}
        className="w-3.5 h-3.5 rounded-sm"
        onError={e => {
          const el = e.target as HTMLImageElement;
          el.style.display = "none";
          const span = document.createElement("span");
          span.className = "font-mono text-[9px] font-bold";
          span.textContent = fallback;
          el.parentElement?.appendChild(span);
        }}
      />
    </a>
  );
}

function TokenRow({ token, onDelete, onUseInTrade }: {
  token: RadarToken;
  onDelete: (id: number) => void;
  onUseInTrade: (mint: string) => void;
}) {
  const { toast } = useToast();
  const dexInfo = DEX_LABELS[token.dex] ?? { label: token.dex, color: "text-muted-foreground", bg: "border-border/40 bg-card/30" };

  const copyMint = async () => {
    await navigator.clipboard.writeText(token.mintAddress);
    toast({ title: "Copied!", description: token.mintAddress.slice(0, 20) + "…" });
  };

  const symbol = token.tokenSymbol && token.tokenSymbol !== "???" ? token.tokenSymbol : null;
  const name = token.tokenName && token.tokenName !== "???" ? token.tokenName : null;
  const displaySymbol = symbol ?? token.mintAddress.slice(0, 6).toUpperCase();
  const isUnknown = !symbol;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/20 hover:bg-primary/3 transition-colors group">
      {/* Token logo */}
      <div className="w-8 h-8 rounded-full bg-card border border-border/40 flex items-center justify-center shrink-0 overflow-hidden">
        {token.tokenUri ? (
          <img
            src={token.tokenUri}
            alt=""
            className="w-full h-full object-cover"
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <span className={`font-mono text-[9px] uppercase ${isUnknown ? "text-muted-foreground/40" : "text-muted-foreground"}`}>
            {displaySymbol.slice(0, 3)}
          </span>
        )}
      </div>

      {/* Name + badges */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-mono text-sm font-semibold ${isUnknown ? "text-muted-foreground/50 italic" : "text-foreground"}`}>
            {symbol ?? "—"}
          </span>
          {name && (
            <span className="font-mono text-xs text-muted-foreground truncate max-w-[130px]">{name}</span>
          )}
          {isUnknown && (
            <span className="font-mono text-[9px] text-muted-foreground/40 italic">metadata pending</span>
          )}
          {token.isGraduation && (
            <Badge className="font-mono text-[9px] h-4 px-1.5 bg-yellow-900/40 border-yellow-600/50 text-yellow-400 gap-1">
              <GraduationCap className="w-2.5 h-2.5" />GRAD
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge variant="outline" className={`font-mono text-[9px] h-4 px-1.5 shrink-0 ${dexInfo.bg} ${dexInfo.color}`}>
            {dexInfo.label}
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground/60">{fmtTime(token.detectedAt)}</span>
        </div>
      </div>

      {/* Mint address (sm+) */}
      <div className="hidden sm:flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/70">
        <span>{token.mintAddress.slice(0, 8)}…{token.mintAddress.slice(-4)}</span>
        <button
          onClick={copyMint}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:text-primary"
          title="Copy mint address"
        >
          <Copy className="w-3 h-3" />
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={copyMint}
          className="sm:hidden p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
          title="Copy mint address"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>

        {/* Pump.fun link (for pumpfun tokens) */}
        {token.dex === "pumpfun" && (
          <ExternalLogoLink
            href={`https://pump.fun/coin/${token.mintAddress}`}
            logoSrc="https://pump.fun/favicon.ico"
            fallback="PF"
            title="View on Pump.fun"
          />
        )}

        {/* DexScreener link (for graduated tokens) */}
        {token.isGraduation && (
          <ExternalLogoLink
            href={`https://dexscreener.com/solana/${token.mintAddress}`}
            logoSrc="https://dexscreener.com/favicon.png"
            fallback="DS"
            title="View on DexScreener"
          />
        )}

        {/* Solscan */}
        <SolscanLink
          address={token.mintAddress}
          type="token"
          label=""
          className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors flex items-center"
        />

        {/* Trade */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onUseInTrade(token.mintAddress)}
          className="h-7 px-2 font-mono text-[10px] gap-1 text-blue-400/70 hover:text-blue-400 hover:bg-blue-950/30"
          title="Use in Trade tab"
        >
          <ArrowRightLeft className="w-3 h-3" />
          <span className="hidden sm:inline">Trade</span>
        </Button>

        {/* Delete */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDelete(token.id)}
          className="h-7 px-1.5 text-muted-foreground/40 hover:text-red-400 hover:bg-red-950/20 opacity-0 group-hover:opacity-100 transition-all"
          title="Remove from radar"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

export default function RadarPage() {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [watchMode, setWatchMode] = useState<WatchMode>("all");
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, refetch: refetchStatus } = useQuery<RadarStatus>({
    queryKey: ["radarStatus"],
    queryFn: async () => {
      const r = await fetch("/api/radar/status");
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<RadarStatus>;
    },
    refetchInterval: 5000,
  });

  // Sync watchMode from server status when data arrives
  useEffect(() => {
    if (status?.watchMode) setWatchMode(status.watchMode);
  }, [status?.watchMode]);

  const { data: tokens, isLoading, refetch: refetchTokens, isFetching } = useQuery<RadarToken[]>({
    queryKey: ["radarTokens", filter],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/radar/tokens?limit=200&filter=${filter}`, { signal });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<RadarToken[]>;
    },
    refetchInterval: 5000,
  });

  const refetch = () => { void refetchTokens(); void refetchStatus(); };

  const startMut = useMutation({
    mutationFn: async (mode: WatchMode) => {
      const r = await fetch("/api/radar/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ watchMode: mode }),
      });
      const data = await r.json() as RadarStatus & { message?: string; error?: string };
      if (!r.ok) throw new Error(data.error ?? "Failed to start radar");
      return data;
    },
    onSuccess: (d) => {
      toast({ title: d.message ?? "Radar started" });
      void queryClient.invalidateQueries({ queryKey: ["radarStatus"] });
    },
    onError: (e) => toast({ title: "Radar error", description: String(e instanceof Error ? e.message : e), variant: "destructive" }),
  });

  const stopMut = useMutation({
    mutationFn: async () => {
      await fetch("/api/radar/stop", { method: "POST" });
    },
    onSuccess: () => {
      toast({ title: "Radar stopped" });
      void queryClient.invalidateQueries({ queryKey: ["radarStatus"] });
    },
  });

  const restartMut = useMutation({
    mutationFn: async (mode: WatchMode) => {
      const r = await fetch("/api/radar/restart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ watchMode: mode }),
      });
      const data = await r.json() as RadarStatus & { message?: string; error?: string };
      if (!r.ok) throw new Error(data.error ?? "Failed to restart radar");
      return data;
    },
    onSuccess: (d) => {
      toast({ title: d.message ?? "Radar restarted" });
      void queryClient.invalidateQueries({ queryKey: ["radarStatus"] });
    },
    onError: (e) => toast({ title: "Radar error", description: String(e instanceof Error ? e.message : e), variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/radar/tokens/${id}`, { method: "DELETE" });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["radarTokens"] }),
  });

  const clearAllMut = useMutation({
    mutationFn: async () => {
      await fetch("/api/radar/tokens", { method: "DELETE" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["radarTokens"] });
      toast({ title: "Radar cleared" });
    },
  });

  const handleUseInTrade = useCallback((mint: string) => {
    sessionStorage.setItem("tradeInputMint", mint);
    navigate("/trade");
    toast({ title: "Navigated to Trade", description: "Mint address pre-filled" });
  }, [navigate, toast]);

  const isRunning = status?.isRunning ?? false;
  const isBusy = startMut.isPending || stopMut.isPending || restartMut.isPending;

  const graduated = (tokens ?? []).filter(t => t.isGraduation).length;
  const pumpfunNew = (tokens ?? []).filter(t => t.dex === "pumpfun").length;

  const filteredTokens = (tokens ?? []).filter(t => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      t.mintAddress.toLowerCase().includes(q) ||
      (t.tokenSymbol ?? "").toLowerCase().includes(q) ||
      (t.tokenName ?? "").toLowerCase().includes(q)
    );
  });

  const dexscreenerCount = (tokens ?? []).filter(t => t.dex === "dexscreener" || t.dex === "dexscreener_boost" || t.dex === "dexscreener_cto").length;

  const FILTER_TABS: { key: FilterMode; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: "all",          label: "All",          icon: <Radio className="w-3 h-3" /> },
    { key: "graduation",   label: "Graduated",    icon: <GraduationCap className="w-3 h-3" /> },
    { key: "pumpfun",      label: "Pump.fun",     icon: <Rocket className="w-3 h-3" /> },
    { key: "raydium",      label: "Raydium",      icon: <Filter className="w-3 h-3" /> },
    { key: "dexscreener",  label: "DexScreener",  icon: <TrendingUp className="w-3 h-3" />, count: dexscreenerCount },
  ];

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-3xl font-mono font-bold text-glow flex items-center gap-2">
            <Radio className={`w-7 h-7 text-primary ${isRunning ? "animate-pulse" : "opacity-40"}`} />
            Token Radar
          </h1>
          <p className="text-muted-foreground font-mono text-sm mt-1 flex items-center gap-2">
            {isRunning ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-green-400">LIVE</span>
                <span className="text-muted-foreground/50">·</span>
                <span className="capitalize">{status?.watchMode ?? "all"} mode</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                <span className="text-muted-foreground/60">STOPPED</span>
              </span>
            )}
            <span className="text-muted-foreground/50">·</span>
            {tokens?.length ?? 0} captured
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs h-8 gap-1.5"
            onClick={refetch}
            disabled={isFetching}
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs h-8 gap-1.5 border-red-700/50 text-red-400 hover:bg-red-950/20"
            onClick={() => { if (window.confirm("Clear all radar tokens?")) clearAllMut.mutate(); }}
            disabled={clearAllMut.isPending}
          >
            <Trash2 className="w-3 h-3" />
            Clear All
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="border border-border/40 rounded p-3 bg-card/30 text-center">
          <div className="font-mono text-xl font-bold text-primary">{tokens?.length ?? 0}</div>
          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">TOTAL DETECTED</div>
        </div>
        <div className="border border-yellow-700/40 rounded p-3 bg-yellow-950/10 text-center">
          <div className="font-mono text-xl font-bold text-yellow-400">{graduated}</div>
          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">GRADUATIONS</div>
        </div>
        <div className="border border-purple-700/40 rounded p-3 bg-purple-950/10 text-center">
          <div className="font-mono text-xl font-bold text-purple-400">{pumpfunNew}</div>
          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">PUMP.FUN NEW</div>
        </div>
        <div className="border border-teal-700/40 rounded p-3 bg-teal-950/10 text-center">
          <div className="font-mono text-xl font-bold text-teal-400">{(tokens ?? []).length - graduated - pumpfunNew}</div>
          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">OTHER POOLS</div>
        </div>
      </div>

      {/* Radar control panel */}
      <div className="border border-border/40 rounded-lg p-4 bg-card/20 space-y-3">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-1">Radar Controls</div>

        {/* Watch mode selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-muted-foreground shrink-0">Watch Mode:</span>
          {WATCH_MODE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setWatchMode(opt.value)}
              title={opt.desc}
              className={`h-7 px-3 rounded font-mono text-xs border transition-colors ${
                watchMode === opt.value
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "bg-background border-border/40 text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Start / Stop / Restart */}
        <div className="flex items-center gap-2 flex-wrap">
          {!isRunning ? (
            <Button
              size="sm"
              className="font-mono text-xs h-8 gap-1.5 bg-green-900/40 border border-green-700/50 text-green-400 hover:bg-green-900/60"
              onClick={() => startMut.mutate(watchMode)}
              disabled={isBusy}
            >
              {startMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Start Radar
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                className="font-mono text-xs h-8 gap-1.5 bg-red-900/40 border border-red-700/50 text-red-400 hover:bg-red-900/60"
                onClick={() => stopMut.mutate()}
                disabled={isBusy}
              >
                {stopMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
                Stop Radar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="font-mono text-xs h-8 gap-1.5 border-blue-700/50 text-blue-400 hover:bg-blue-950/30"
                onClick={() => restartMut.mutate(watchMode)}
                disabled={isBusy}
              >
                {restartMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                Restart
              </Button>
            </>
          )}
          {isRunning && watchMode !== (status?.watchMode ?? "all") && (
            <span className="font-mono text-[10px] text-yellow-400/70">
              ↑ Restart to apply new watch mode
            </span>
          )}
        </div>

        <p className="font-mono text-[10px] text-muted-foreground/50">
          Requires a Helius API key in Settings. Radar does not start automatically.
        </p>
      </div>

      {/* Filter tabs + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex items-center gap-1.5 h-7 px-3 rounded font-mono text-xs border transition-colors ${
                filter === tab.key
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "bg-background border-border/40 text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-0.5 text-[10px] opacity-70">({tab.count})</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, symbol, mint…"
            className="h-7 pl-8 font-mono text-xs bg-background border-border/40"
          />
        </div>
      </div>

      {/* Legend */}
      <div className="border border-yellow-700/30 rounded p-2.5 bg-yellow-950/10 font-mono text-[10px] text-yellow-300/70">
        <span className="text-yellow-400 font-semibold">🎓 Graduated</span> = Raydium pool created (bonding curve completed).{" "}
        <span className="text-purple-400 font-semibold">🟣 Pump.fun</span> = Fresh token launch on bonding curve.{" "}
        Click <span className="text-foreground">PF</span> icon to open on Pump.fun · <span className="text-foreground">DS</span> for DexScreener (graduated).
      </div>

      {/* Token list */}
      <div className="border border-border/50 rounded-lg overflow-hidden glass-panel">
        <div className="grid grid-cols-[32px_1fr_auto] gap-3 px-4 py-2 bg-background/80 border-b border-border/50">
          <div />
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Token</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground text-right">Actions</div>
        </div>

        {isLoading ? (
          <div className="py-12 text-center font-mono text-sm text-muted-foreground animate-pulse flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading radar...
          </div>
        ) : !tokens || tokens.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Radio className="w-8 h-8 text-muted-foreground/30 mx-auto" />
            <div className="font-mono text-sm text-muted-foreground">
              {filter !== "all" ? "No tokens match this filter." : isRunning ? "Listening for new pools…" : "Radar is stopped."}
            </div>
            {!isRunning && (
              <div className="font-mono text-xs text-muted-foreground/50">
                Press <span className="text-green-400">Start Radar</span> above to begin capturing.
              </div>
            )}
          </div>
        ) : filteredTokens.length === 0 ? (
          <div className="py-10 text-center font-mono text-sm text-muted-foreground">
            No tokens match <span className="text-primary">&quot;{search}&quot;</span>
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            {search && (
              <div className="px-4 py-1.5 bg-primary/5 border-b border-border/20 font-mono text-[10px] text-muted-foreground">
                {filteredTokens.length} result{filteredTokens.length !== 1 ? "s" : ""} for &quot;{search}&quot;
              </div>
            )}
            {filteredTokens.map(token => (
              <TokenRow
                key={token.id}
                token={token}
                onDelete={(id) => deleteMut.mutate(id)}
                onUseInTrade={handleUseInTrade}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
