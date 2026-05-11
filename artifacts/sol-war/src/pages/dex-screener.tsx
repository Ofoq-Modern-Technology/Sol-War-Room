import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ExternalLink, Zap, TrendingUp, User, Globe, Twitter, MessageCircle, Copy, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface DsToken {
  tokenAddress: string;
  url: string;
  icon?: string;
  header?: string;
  description?: string;
  amount?: number;
  totalAmount?: number;
  links?: Array<{ type?: string; label?: string; url: string }>;
  claimDate?: string;
}

type Tab = "cto" | "profiles" | "boosts_latest" | "boosts_top";

async function fetchDs(tab: Tab): Promise<DsToken[]> {
  const path =
    tab === "cto"
      ? "/dexscreener/cto"
      : tab === "profiles"
      ? "/dexscreener/profiles"
      : tab === "boosts_latest"
      ? "/dexscreener/boosts/latest"
      : "/dexscreener/boosts/top";

  const r = await fetch(`${BASE}/api${path}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<DsToken[]>;
}

function LinkIcon({ type }: { type?: string }) {
  if (type === "twitter" || type === "x") return <Twitter className="w-3 h-3" />;
  if (type === "telegram") return <MessageCircle className="w-3 h-3" />;
  if (type === "discord") return <User className="w-3 h-3" />;
  return <Globe className="w-3 h-3" />;
}

function formatClaimDate(iso: string) {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const rel =
    mins < 1  ? "just now" :
    mins < 60 ? `${mins}m ago` :
    hrs  < 24 ? `${hrs}h ago` :
                `${days}d ago`;
  return { rel, abs: d.toLocaleString() };
}

function TokenCard({ token, showBoost }: { token: DsToken; showBoost: boolean }) {
  const { toast } = useToast();
  const addr = token.tokenAddress;
  const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  function copyAddr() {
    void navigator.clipboard.writeText(addr);
    toast({ title: "Copied", description: addr });
  }

  const claimInfo = token.claimDate ? formatClaimDate(token.claimDate) : null;

  return (
    <div className="bg-card border border-border/50 rounded-lg p-4 flex gap-3 hover:border-primary/30 transition-colors">
      {token.icon ? (
        <img src={token.icon} alt="" className="w-10 h-10 rounded-full flex-shrink-0 object-cover bg-muted" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      ) : (
        <div className="w-10 h-10 rounded-full flex-shrink-0 bg-muted flex items-center justify-center">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <button
            onClick={copyAddr}
            className="font-mono text-xs text-primary hover:text-primary/80 flex items-center gap-1"
            title="Copy address"
          >
            {short}
            <Copy className="w-3 h-3" />
          </button>
          {claimInfo && (
            <span
              title={`Claimed: ${claimInfo.abs}`}
              className="inline-flex items-center gap-1 text-xs text-orange-400/80"
            >
              <Clock className="w-3 h-3" />
              {claimInfo.rel}
            </span>
          )}
          {showBoost && token.amount !== undefined && (
            <Badge variant="secondary" className="text-xs gap-1 bg-yellow-500/10 text-yellow-400 border-yellow-500/30">
              <Zap className="w-3 h-3" />
              {token.amount.toLocaleString()} pts
            </Badge>
          )}
          {showBoost && token.totalAmount !== undefined && (
            <span className="text-xs text-muted-foreground">
              total: {token.totalAmount.toLocaleString()}
            </span>
          )}
        </div>

        {token.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{token.description}</p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={token.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            DexScreener
          </a>
          {token.links?.map((link, i) => (
            <a
              key={i}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <LinkIcon type={link.type} />
              {link.label ?? link.type ?? "Link"}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

const TABS: Array<{ id: Tab; label: string; desc: string; highlight?: boolean }> = [
  { id: "cto", label: "Community Takeovers", desc: "Tokens officially marked as Community Takeover on DexScreener — sniper CTO buy triggers on these", highlight: true },
  { id: "profiles", label: "Latest Profiles", desc: "Tokens that recently updated their profile on DexScreener" },
  { id: "boosts_latest", label: "Latest Boosts", desc: "Tokens that were recently boosted on DexScreener" },
  { id: "boosts_top", label: "Top Boosts", desc: "Tokens with the highest total boost points" },
];

export default function DexScreenerPage() {
  const [tab, setTab] = useState<Tab>("cto");
  const { toast } = useToast();

  const { data, isLoading, isFetching, error, refetch } = useQuery<DsToken[], Error>({
    queryKey: ["dexscreener", tab],
    queryFn: () => fetchDs(tab),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const tokens = data ?? [];
  const showBoost = tab !== "profiles";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" />
            DexScreener
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live Solana token data — auto-refreshes every 60s
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="font-mono gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex gap-1 border-b border-border/50 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-mono border-b-2 transition-colors flex items-center gap-1.5 ${
              tab === t.id
                ? t.highlight ? "border-orange-400 text-orange-400" : "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.highlight && <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />}
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {TABS.find(t => t.id === tab)?.desc}
      </p>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-sm text-destructive">
          Failed to load: {error.message}
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-card border border-border/50 rounded-lg p-4 h-24 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && tokens.length === 0 && !error && (
        <div className="text-center py-16 text-muted-foreground font-mono">
          No tokens found
        </div>
      )}

      {!isLoading && tokens.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground font-mono">
            {tokens.length} token{tokens.length !== 1 ? "s" : ""} — Solana only
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {tokens.map((token) => (
              <TokenCard key={token.tokenAddress} token={token} showBoost={showBoost} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
