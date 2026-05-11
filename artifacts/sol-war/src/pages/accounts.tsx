import { useEffect, useRef, useState, useMemo, useCallback, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListAllAccounts, useRefreshBalances } from "@/hooks/use-accounts";
import { useListWallets } from "@workspace/api-client-react";
import { useAccountStore } from "@/store/use-account-store";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Coins, ArrowUpDown, ArrowUp, ArrowDown, Wallet,
  ChevronDown, ChevronUp, LogOut, Loader2, Package, ScanLine, CheckCircle, XCircle, SkipForward,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SolscanLink } from "@/components/solscan-link";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type SortKey = "name" | "balance" | "hdIndex";
type SortDir = "asc" | "desc";

interface TokenHolding {
  mint: string;
  rawAmount: string;
  decimals: number;
  uiAmount: number;
  name: string;
  symbol: string;
  logoUri: string | null;
}

function fmtAmount(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(n < 1 ? 4 : 2);
}

// ─── Token panel (per account) ───────────────────────────────────────────────

function TokenPanel({ accountId, accountName }: { accountId: number; accountName: string }) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selling, setSelling] = useState<Set<string>>(new Set());
  const [sellingAll, setSellingAll] = useState(false);

  const { data: tokens, isLoading, refetch } = useQuery<TokenHolding[]>({
    queryKey: ["accountTokens", accountId],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/accounts/${accountId}/tokens`, { signal });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<TokenHolding[]>;
    },
    staleTime: 30_000,
  });

  const toggleToken = (mint: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(mint) ? n.delete(mint) : n.add(mint);
      return n;
    });
  };

  const toggleAll = () => {
    if (!tokens) return;
    if (selected.size === tokens.length) setSelected(new Set());
    else setSelected(new Set(tokens.map(t => t.mint)));
  };

  const sellToken = useCallback(async (token: TokenHolding) => {
    if (!password) { toast({ title: "Enter wallet password first", variant: "destructive" }); return; }
    setSelling(prev => new Set(prev).add(token.mint));
    try {
      const r = await fetch("/api/accounts/tokens/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, mint: token.mint, rawAmount: token.rawAmount, password }),
      });
      const data = await r.json() as { error?: string; txSignature?: string };
      if (!r.ok) {
        toast({ title: `Sell failed: ${data.error ?? r.statusText}`, variant: "destructive" });
      } else {
        toast({ title: `${token.symbol} sold`, description: `tx: ${(data.txSignature ?? "").slice(0, 16)}…` });
        void refetch();
        setSelected(prev => { const n = new Set(prev); n.delete(token.mint); return n; });
      }
    } catch (e) {
      toast({ title: String(e), variant: "destructive" });
    } finally {
      setSelling(prev => { const n = new Set(prev); n.delete(token.mint); return n; });
    }
  }, [accountId, password, toast, refetch]);

  const sellSelected = async () => {
    if (!password) { toast({ title: "Enter wallet password first", variant: "destructive" }); return; }
    const targets = (tokens ?? []).filter(t => selected.has(t.mint));
    if (targets.length === 0) { toast({ title: "No tokens selected", variant: "destructive" }); return; }
    if (!window.confirm(`Sell ${targets.length} token(s) from ${accountName}?`)) return;
    setSellingAll(true);
    try {
      await Promise.allSettled(targets.map(t => sellToken(t)));
    } finally {
      setSellingAll(false);
    }
  };

  if (isLoading) {
    return (
      <div className="px-4 py-3 space-y-2">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full bg-accent/20" />)}
      </div>
    );
  }

  const list = tokens ?? [];

  return (
    <div className="border-t border-border/30 bg-background/40">
      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20 flex-wrap">
        <Package className="w-3.5 h-3.5 text-primary/60 shrink-0" />
        <span className="font-mono text-xs text-muted-foreground shrink-0">
          {list.length} token{list.length !== 1 ? "s" : ""}
          {selected.size > 0 && ` · ${selected.size} selected`}
        </span>
        <div className="flex items-center gap-1 ml-auto flex-wrap">
          <Input
            type="password"
            placeholder="wallet password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="font-mono text-xs h-6 w-32 border-border/40 bg-background/60"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={sellingAll || selected.size === 0 || !password}
            onClick={sellSelected}
            className="h-6 px-2 font-mono text-[10px] border-red-700/50 text-red-400 hover:bg-red-950/40"
          >
            {sellingAll
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <><LogOut className="w-3 h-3 mr-1" />Sell {selected.size > 0 ? `(${selected.size})` : "Selected"}</>
            }
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void refetch()} className="h-6 px-1.5">
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Token list */}
      {list.length === 0 ? (
        <div className="px-4 py-4 text-center font-mono text-xs text-muted-foreground/50">
          No SPL token holdings found
        </div>
      ) : (
        <div className="divide-y divide-border/10">
          {list.map(token => {
            const isSelling = selling.has(token.mint);
            const isSelected = selected.has(token.mint);
            return (
              <div
                key={token.mint}
                className={`flex items-center gap-3 px-3 py-2 hover:bg-primary/5 cursor-pointer transition-colors ${isSelected ? "bg-primary/5" : ""}`}
                onClick={() => toggleToken(token.mint)}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleToken(token.mint)}
                  onClick={e => e.stopPropagation()}
                  className="border-muted-foreground data-[state=checked]:bg-primary data-[state=checked]:border-primary shrink-0"
                />
                {/* Logo */}
                <div className="w-6 h-6 rounded-full bg-card border border-border/40 overflow-hidden flex items-center justify-center shrink-0">
                  {token.logoUri ? (
                    <img src={token.logoUri} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <span className="font-mono text-[8px] text-muted-foreground">{token.symbol.slice(0, 2)}</span>
                  )}
                </div>
                {/* Name + mint */}
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs font-medium text-foreground">{token.symbol}</div>
                  <div className="font-mono text-[10px] text-muted-foreground truncate">{token.name}</div>
                </div>
                {/* Amount */}
                <div className="text-right shrink-0">
                  <div className="font-mono text-xs text-foreground">{fmtAmount(token.uiAmount)}</div>
                  <div className="font-mono text-[10px] text-muted-foreground" onClick={e => e.stopPropagation()}>
                    <SolscanLink address={token.mint} type="token" label={token.mint.slice(0, 8) + "…"} className="text-muted-foreground/60" />
                  </div>
                </div>
                {/* Sell button */}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isSelling || !password}
                  onClick={async e => { e.stopPropagation(); await sellToken(token); }}
                  className="h-6 px-1.5 font-mono text-[10px] text-red-400/70 hover:text-red-400 hover:bg-red-950/30 shrink-0"
                  title={!password ? "Enter password above to sell" : `Sell ${token.symbol}`}
                >
                  {isSelling ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Multi-select toggle */}
      {list.length > 1 && (
        <div className="px-3 py-1.5 border-t border-border/10">
          <button
            onClick={toggleAll}
            className="font-mono text-[10px] text-muted-foreground/50 hover:text-muted-foreground"
          >
            {selected.size === list.length ? "Deselect all" : `Select all ${list.length}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Scan & sell types ────────────────────────────────────────────────────────

interface ScanTokenResult {
  mint: string;
  rawAmount: number;
  solReceived?: number;
  txSignature?: string;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
}
interface ScanWalletResult {
  accountId: number;
  accountName: string;
  tokens: ScanTokenResult[];
}

// ─── Main accounts page ───────────────────────────────────────────────────────

export default function AccountsPage() {
  const { data: accounts, isLoading } = useListAllAccounts();
  const { data: wallets } = useListWallets();
  const refreshMutation = useRefreshBalances();
  const { selectedIds, toggle, toggleAll } = useAccountStore();
  const { toast } = useToast();

  const [walletFilter, setWalletFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("hdIndex");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Scan & sell state
  const [scanPassword, setScanPassword] = useState("");
  const [scanSelling, setScanSelling] = useState(false);
  const [scanResults, setScanResults] = useState<ScanWalletResult[] | null>(null);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [showScanDialog, setShowScanDialog] = useState(false);

  // Auto-refresh ALL accounts once on mount
  const autoRefreshed = useRef(false);
  useEffect(() => {
    if (!accounts || accounts.length === 0 || autoRefreshed.current || refreshMutation.isPending) return;
    autoRefreshed.current = true;
    refreshMutation.mutate({ data: { accountIds: accounts.map((a) => a.id) } });
  }, [accounts?.length]);

  const visible = useMemo(() => {
    if (!accounts) return [];
    let list = walletFilter === "all"
      ? accounts
      : accounts.filter((a) => String(a.walletId) === walletFilter);
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "balance") cmp = (a.solBalance ?? -1) - (b.solBalance ?? -1);
      else cmp = (a.hdIndex ?? 0) - (b.hdIndex ?? 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [accounts, walletFilter, sortKey, sortDir]);

  const allSelected = visible.length > 0 && visible.every((a) => selectedIds.has(a.id));
  const someSelected = visible.some((a) => selectedIds.has(a.id)) && !allSelected;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="w-3 h-3 opacity-30 ml-1" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  const syncSelected = () => {
    const ids = visible.filter((a) => selectedIds.has(a.id)).map((a) => a.id);
    if (ids.length === 0) {
      toast({ title: "No selection", description: "Select accounts to refresh", variant: "destructive" });
      return;
    }
    refreshMutation.mutate({ data: { accountIds: ids } }, {
      onSuccess: () => toast({ title: "Balances updated", description: `${ids.length} accounts synced` }),
      onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    });
  };

  const syncAll = () => {
    const ids = visible.map((a) => a.id);
    if (ids.length === 0) return;
    refreshMutation.mutate({ data: { accountIds: ids } }, {
      onSuccess: () => toast({ title: "All balances updated", description: `${ids.length} accounts synced` }),
      onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    });
  };

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleScanAndSell = async () => {
    if (!scanPassword) { toast({ title: "Enter wallet password first", variant: "destructive" }); return; }
    const ids = visible.filter(a => selectedIds.has(a.id)).map(a => a.id);
    if (ids.length === 0) { toast({ title: "Select at least one account", variant: "destructive" }); return; }
    const names = visible.filter(a => selectedIds.has(a.id)).map(a => a.name).join(", ");
    if (!window.confirm(`Scan ${ids.length} account(s) on-chain and sell ALL tokens to SOL?\n\n${names}\n\nThis ignores your holdings list — use as recovery for orphaned tokens.`)) return;
    setScanSelling(true);
    setScanResults(null);
    setScanLogs([]);
    setShowScanDialog(true);
    try {
      const r = await fetch("/api/sniper/scan-and-sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: scanPassword, accountIds: ids }),
      });
      const data = await r.json() as { results?: ScanWalletResult[]; logs?: string[]; error?: string };
      if (!r.ok || data.error) {
        toast({ title: `Scan & Sell failed: ${data.error ?? r.statusText}`, variant: "destructive" });
        setShowScanDialog(false);
        return;
      }
      setScanResults(data.results ?? []);
      setScanLogs(data.logs ?? []);
      const sold = (data.results ?? []).flatMap(w => w.tokens).filter(t => t.txSignature).length;
      const totalSol = (data.results ?? []).flatMap(w => w.tokens).reduce((s, t) => s + (t.solReceived ?? 0), 0);
      toast({ title: `Scan complete — sold ${sold} token(s) for ~${totalSol.toFixed(4)} SOL` });
    } catch (err) {
      toast({ title: `Network error: ${err instanceof Error ? err.message : "unknown"}`, variant: "destructive" });
      setShowScanDialog(false);
    } finally {
      setScanSelling(false);
    }
  };

  const totalSol = visible.reduce((s, a) => s + (a.solBalance ?? 0), 0);
  const selectedCount = visible.filter((a) => selectedIds.has(a.id)).length;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-mono font-bold text-glow">Fleet Command</h1>
          <p className="text-muted-foreground font-mono text-sm mt-1">
            {accounts?.length ?? 0} accounts · {totalSol.toFixed(4)} SOL total
          </p>
        </div>

        <div className="flex items-center gap-2">
          {refreshMutation.isPending && (
            <Badge variant="outline" className="font-mono text-[10px] animate-pulse border-primary/40 text-primary">
              <RefreshCw className="w-2.5 h-2.5 mr-1 animate-spin" /> Syncing...
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs h-8 border-border/50 hover:border-primary/50"
            onClick={syncSelected}
            disabled={refreshMutation.isPending || selectedCount === 0}
          >
            <RefreshCw className="w-3 h-3 mr-1.5" />
            Sync {selectedCount > 0 ? `(${selectedCount})` : "Selected"}
          </Button>
          <Button
            size="sm"
            className="font-mono text-xs h-8 border-glow"
            onClick={syncAll}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className={`w-3 h-3 mr-1.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
            Sync All
          </Button>
        </div>
      </div>

      {/* Scan & Sell Recovery Panel — visible when accounts are selected */}
      {selectedCount > 0 && (
        <div className="border border-orange-700/40 rounded-lg p-3 bg-orange-950/10 flex items-center gap-3 flex-wrap">
          <ScanLine className="w-4 h-4 text-orange-400 shrink-0" />
          <div className="font-mono text-xs">
            <span className="text-orange-300 font-semibold">Recovery Scan</span>
            <span className="text-muted-foreground ml-2">— scan {selectedCount} selected wallet{selectedCount > 1 ? "s" : ""} on-chain and sell ALL tokens found</span>
          </div>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <Input
              type="password"
              placeholder="wallet password"
              value={scanPassword}
              onChange={e => setScanPassword(e.target.value)}
              className="font-mono text-xs h-7 w-36 border-orange-700/40 bg-background/50"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={scanSelling || !scanPassword}
              onClick={() => void handleScanAndSell()}
              className="h-7 px-3 font-mono text-xs border-orange-600 text-orange-400 hover:bg-orange-950/50 shrink-0"
            >
              {scanSelling
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Scanning...</>
                : <><ScanLine className="w-3.5 h-3.5 mr-1.5" />Scan & Sell ({selectedCount})</>
              }
            </Button>
            {scanResults && (
              <Button size="sm" variant="ghost" onClick={() => setShowScanDialog(true)} className="h-7 px-2 font-mono text-xs text-orange-400">
                View Results
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Scan results dialog */}
      <Dialog open={showScanDialog} onOpenChange={setShowScanDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm flex items-center gap-2">
              <ScanLine className="w-4 h-4 text-orange-400" />
              {scanSelling ? "Scanning wallets & selling tokens..." : "Scan & Sell Results"}
            </DialogTitle>
          </DialogHeader>
          {scanSelling && (
            <div className="flex items-center gap-2 py-4 text-muted-foreground font-mono text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
              Scanning selected wallets on-chain and selling tokens... this may take a minute.
            </div>
          )}
          {scanResults && (
            <div className="space-y-3 font-mono text-xs">
              {(() => {
                const allTokens = scanResults.flatMap(w => w.tokens);
                const sold = allTokens.filter(t => t.txSignature);
                const skipped = allTokens.filter(t => t.skipped);
                const failed = allTokens.filter(t => t.error);
                const totalSolRec = sold.reduce((s, t) => s + (t.solReceived ?? 0), 0);
                return (
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <div className="border border-border/40 rounded p-2 text-center">
                      <div className="text-green-400 font-bold text-lg">{sold.length}</div>
                      <div className="text-[9px] text-muted-foreground">SOLD</div>
                    </div>
                    <div className="border border-border/40 rounded p-2 text-center">
                      <div className="text-muted-foreground font-bold text-lg">{skipped.length}</div>
                      <div className="text-[9px] text-muted-foreground">SKIPPED</div>
                    </div>
                    <div className="border border-border/40 rounded p-2 text-center">
                      <div className="text-red-400 font-bold text-lg">{failed.length}</div>
                      <div className="text-[9px] text-muted-foreground">FAILED</div>
                    </div>
                    <div className="border border-green-800/40 rounded p-2 text-center bg-green-950/20">
                      <div className="text-green-400 font-bold text-lg">{totalSolRec.toFixed(4)}</div>
                      <div className="text-[9px] text-muted-foreground">SOL RECEIVED</div>
                    </div>
                  </div>
                );
              })()}
              {scanResults.map(wallet => (
                <div key={wallet.accountId} className="border border-border/40 rounded overflow-hidden">
                  <div className="px-3 py-1.5 bg-card/80 border-b border-border/40 flex items-center gap-2">
                    <Wallet className="w-3 h-3 text-muted-foreground" />
                    <span className="font-semibold">{wallet.accountName}</span>
                    <span className="text-muted-foreground text-[10px] ml-auto">{wallet.tokens.length} token(s)</span>
                  </div>
                  {wallet.tokens.length === 0 ? (
                    <div className="px-3 py-2 text-muted-foreground text-[10px]">No tokens found</div>
                  ) : (
                    <div className="divide-y divide-border/30">
                      {wallet.tokens.map(t => (
                        <div key={t.mint} className="px-3 py-1.5 flex items-center gap-2">
                          {t.txSignature ? (
                            <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />
                          ) : t.skipped ? (
                            <SkipForward className="w-3 h-3 text-muted-foreground shrink-0" />
                          ) : (
                            <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                          )}
                          <span className="text-[10px] text-muted-foreground">{t.mint.slice(0, 12)}...{t.mint.slice(-4)}</span>
                          {t.txSignature && <span className="text-green-400 text-[10px]">+{(t.solReceived ?? 0).toFixed(4)} SOL</span>}
                          {t.skipped && <span className="text-muted-foreground text-[10px] italic">{t.skipReason}</span>}
                          {t.error && <span className="text-red-400 text-[10px]">{t.error.slice(0, 60)}</span>}
                          {t.txSignature && (
                            <a href={`https://solscan.io/tx/${t.txSignature}`} target="_blank" rel="noopener noreferrer"
                              className="ml-auto text-[10px] text-blue-400 hover:underline">Solscan ↗</a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {scanLogs.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">Show debug logs ({scanLogs.length})</summary>
                  <div className="mt-1 p-2 bg-black/30 rounded border border-border/30 max-h-40 overflow-y-auto space-y-0.5">
                    {scanLogs.map((log, i) => <div key={i} className="text-[10px] text-muted-foreground">{log}</div>)}
                  </div>
                </details>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Filters + sort */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
          <Select value={walletFilter} onValueChange={setWalletFilter}>
            <SelectTrigger className="h-8 w-44 font-mono text-xs bg-background border-border/50">
              <SelectValue placeholder="All wallets" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="font-mono text-xs">All Wallets</SelectItem>
              {wallets?.map((w) => (
                <SelectItem key={w.id} value={String(w.id)} className="font-mono text-xs">{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <span className="font-mono text-[10px] text-muted-foreground mr-1">Sort:</span>
          {(["hdIndex", "name", "balance"] as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => handleSort(k)}
              className={`h-7 px-2.5 rounded font-mono text-[10px] flex items-center transition-colors border
                ${sortKey === k
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "bg-background border-border/40 text-muted-foreground hover:border-border"
                }`}
            >
              {k === "hdIndex" ? "Index" : k === "balance" ? "Fuel" : "Name"}
              <SortIcon k={k} />
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="border border-border/50 rounded-lg overflow-hidden glass-panel">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full bg-accent/20" />)}
          </div>
        ) : !visible.length ? (
          <div className="p-12 text-center text-muted-foreground font-mono text-sm">
            {accounts?.length === 0
              ? "No accounts found. Head to Wallets to derive accounts."
              : "No accounts match the current filter."}
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-background/80">
              <TableRow className="hover:bg-transparent border-border/50">
                <TableHead className="w-[36px]" />
                <TableHead className="w-[50px] text-center">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={() => toggleAll(visible.map((a) => a.id), !allSelected)}
                    className="border-muted-foreground data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground w-[80px]">
                  <button className="flex items-center" onClick={() => handleSort("hdIndex")}>
                    Idx <SortIcon k="hdIndex" />
                  </button>
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Wallet</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  <button className="flex items-center" onClick={() => handleSort("name")}>
                    Name <SortIcon k="name" />
                  </button>
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Address</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">HD Path</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-right text-muted-foreground">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("balance")}>
                    <SortIcon k="balance" /> Fuel (SOL)
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((acc) => {
                const isExpanded = expandedIds.has(acc.id);
                return (
                  <Fragment key={acc.id}>
                    <TableRow
                      className={`cursor-pointer transition-colors border-border/30 hover:bg-primary/5
                        ${selectedIds.has(acc.id) ? "bg-primary/5 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"}
                        ${isExpanded ? "border-b-0" : ""}`}
                      onClick={() => toggle(acc.id)}
                    >
                      {/* Expand toggle */}
                      <TableCell className="text-center px-1.5" onClick={e => { e.stopPropagation(); toggleExpand(acc.id); }}>
                        <button className="p-0.5 rounded text-muted-foreground/40 hover:text-primary transition-colors">
                          {isExpanded
                            ? <ChevronUp className="w-3.5 h-3.5" />
                            : <ChevronDown className="w-3.5 h-3.5" />
                          }
                        </button>
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          checked={selectedIds.has(acc.id)}
                          onCheckedChange={() => toggle(acc.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="border-muted-foreground data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground/60">{acc.hdIndex}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{acc.walletName}</TableCell>
                      <TableCell className="font-mono text-sm font-medium text-foreground">{acc.name}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <SolscanLink address={acc.publicKey} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground/60">{acc.hdPath}</TableCell>
                      <TableCell className="font-mono text-sm text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Coins className="w-3 h-3 text-primary/50" />
                          {acc.solBalance != null ? (
                            <span className={acc.solBalance > 0 ? "text-primary font-medium" : "text-muted-foreground"}>
                              {acc.solBalance.toFixed(4)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">---</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* Expanded token panel */}
                    {isExpanded && (
                      <tr className="border-b border-border/30">
                        <td colSpan={8} className="p-0">
                          <TokenPanel accountId={acc.id} accountName={acc.name} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Footer */}
      {visible.length > 0 && (
        <div className="flex items-center justify-between font-mono text-xs text-muted-foreground px-1">
          <span>{selectedCount > 0 ? `${selectedCount} selected` : `${visible.length} accounts`}</span>
          <span className="text-primary font-medium">
            Total: {totalSol.toFixed(4)} SOL
            {walletFilter !== "all" && <span className="text-muted-foreground ml-1">(filtered)</span>}
          </span>
        </div>
      )}
    </div>
  );
}
