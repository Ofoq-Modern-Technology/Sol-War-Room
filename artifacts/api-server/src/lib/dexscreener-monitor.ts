import { EventEmitter } from "events";

const DS_BASE = "https://api.dexscreener.com";

export interface DsTokenEvent {
  tokenAddress: string;
  chainId: string;
  url: string;
  icon?: string;
  header?: string;
  description?: string;
  source: "profile" | "boost" | "cto";
  amount?: number;
  totalAmount?: number;
  links?: Array<{ type?: string; label?: string; url: string }>;
}

interface DsApiToken {
  chainId: string;
  tokenAddress: string;
  url?: string;
  icon?: string;
  header?: string;
  description?: string;
  amount?: number;
  totalAmount?: number;
  links?: Array<{ type?: string; label?: string; url: string }>;
}

async function dsGet(path: string): Promise<DsApiToken[]> {
  const r = await fetch(`${DS_BASE}${path}`, {
    signal: AbortSignal.timeout(10000),
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`DexScreener ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? (data as DsApiToken[]) : [];
}

export class DexScreenerMonitor extends EventEmitter {
  private ctoTimer: ReturnType<typeof setTimeout> | null = null;
  private fullTimer: ReturnType<typeof setTimeout> | null = null;
  private seenTokens = new Set<string>();
  private stopped = true;

  // CTO endpoint is polled fast (every 5s) for sniper responsiveness.
  // Profile/boost endpoints are polled slower (every 30s) for radar display.
  private readonly CTO_INTERVAL_MS = 5000;
  private readonly FULL_INTERVAL_MS = 30000;

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this._pollCto();
    void this._pollFull();
    console.log(`[dexscreener] Monitor started (cto=${this.CTO_INTERVAL_MS / 1000}s, full=${this.FULL_INTERVAL_MS / 1000}s)`);
  }

  stop() {
    this.stopped = true;
    if (this.ctoTimer) { clearTimeout(this.ctoTimer); this.ctoTimer = null; }
    if (this.fullTimer) { clearTimeout(this.fullTimer); this.fullTimer = null; }
    console.log("[dexscreener] Monitor stopped");
  }

  get isRunning() { return !this.stopped; }

  private _emit(item: DsApiToken, source: DsTokenEvent["source"]) {
    const key = `${source}:${item.tokenAddress}`;
    if (this.seenTokens.has(key)) return;
    this.seenTokens.add(key);
    if (this.seenTokens.size > 10000) {
      const first = this.seenTokens.values().next().value;
      if (first) this.seenTokens.delete(first);
    }
    const event: DsTokenEvent = {
      ...item,
      source,
      url: item.url ?? `https://dexscreener.com/solana/${item.tokenAddress}`,
    };
    this.emit("token", event);
    if (source === "cto") {
      this.emit("cto", event);
      console.log(`[dexscreener] 🏴 CTO detected: ${item.tokenAddress.slice(0, 14)}…`);
    }
  }

  private async _pollCto() {
    if (this.stopped) return;
    try {
      const data = await dsGet("/community-takeovers/latest/v1");
      for (const item of data) {
        if (item.chainId !== "solana") continue;
        this._emit(item, "cto");
      }
    } catch { /* ignore — endpoint may not always be available */ }
    if (!this.stopped) {
      this.ctoTimer = setTimeout(() => void this._pollCto(), this.CTO_INTERVAL_MS);
    }
  }

  private async _pollFull() {
    if (this.stopped) return;
    await Promise.allSettled([
      this._fetchProfiles(),
      this._fetchBoosts(),
    ]);
    if (!this.stopped) {
      this.fullTimer = setTimeout(() => void this._pollFull(), this.FULL_INTERVAL_MS);
    }
  }

  private async _fetchProfiles() {
    try {
      const data = await dsGet("/token-profiles/latest/v1");
      for (const item of data) {
        if (item.chainId !== "solana") continue;
        this._emit(item, "profile");
      }
    } catch { /* ignore */ }
  }

  private async _fetchBoosts() {
    try {
      const data = await dsGet("/token-boosts/latest/v1");
      for (const item of data) {
        if (item.chainId !== "solana") continue;
        this._emit(item, "boost");
      }
    } catch { /* ignore */ }
  }
}

let _monitor: DexScreenerMonitor | null = null;

export function getDexScreenerMonitor(): DexScreenerMonitor {
  if (!_monitor) _monitor = new DexScreenerMonitor();
  return _monitor;
}

export function startDexScreenerMonitor() {
  getDexScreenerMonitor().start();
}

export function stopDexScreenerMonitor() {
  getDexScreenerMonitor().stop();
}
