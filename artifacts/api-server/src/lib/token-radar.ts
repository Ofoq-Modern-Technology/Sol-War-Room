import { db, tokenRadarTable } from "@workspace/db";
import { desc, eq, or } from "drizzle-orm";
import { PoolDetector, NewPoolEvent } from "./pool-detector.js";
import { getSettings } from "./settingsStore.js";
import { getDexScreenerMonitor, DsTokenEvent } from "./dexscreener-monitor.js";

// ─── Global Token Radar Singleton ────────────────────────────────────────────

const JUP_TOKEN_API = "https://lite-api.jup.ag/tokens/v1";

let radarDetector: PoolDetector | null = null;
let radarRunning = false;
let radarWatchMode: WatchMode = "all";

const seen = new Set<string>();

export type WatchMode = "all" | "graduated" | "created";

// ─── Metadata fetch ────────────────────────────────────────────────────────

async function fetchFromHeliusDas(mint: string, apiKey: string): Promise<{ name?: string; symbol?: string; logoUri?: string } | null> {
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "get-asset", method: "getAsset", params: { id: mint } }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const j = await r.json() as { result?: { content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string } } } };
    const meta = j.result?.content?.metadata;
    const logo = j.result?.content?.links?.image;
    if (!meta?.name && !meta?.symbol) return null;
    return { name: meta.name, symbol: meta.symbol, logoUri: logo };
  } catch {
    return null;
  }
}

async function fetchFromJupiter(mint: string): Promise<{ name?: string; symbol?: string; logoUri?: string } | null> {
  try {
    const r = await fetch(`${JUP_TOKEN_API}/${mint}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const d = await r.json() as { name?: string; symbol?: string; logoURI?: string };
    if (!d.name && !d.symbol) return null;
    return { name: d.name, symbol: d.symbol, logoUri: d.logoURI };
  } catch {
    return null;
  }
}

async function fetchTokenMeta(mint: string, heliusApiKey?: string): Promise<{ name?: string; symbol?: string; logoUri?: string } | null> {
  // Try Helius DAS first (fastest for brand-new tokens)
  if (heliusApiKey) {
    const heliusMeta = await fetchFromHeliusDas(mint, heliusApiKey);
    if (heliusMeta?.name || heliusMeta?.symbol) return heliusMeta;
  }
  // Fall back to Jupiter
  return fetchFromJupiter(mint);
}

// ─── Event handler ─────────────────────────────────────────────────────────

async function handleNewPool(event: NewPoolEvent, heliusApiKey?: string) {
  const { mintAddress, dex, signature, timestamp } = event;

  // In-memory dedup by signature
  if (seen.has(signature)) return;
  seen.add(signature);
  if (seen.size > 5000) {
    const first = seen.values().next().value;
    if (first) seen.delete(first);
  }

  const isGraduation = dex === "raydium" || dex === "raydium_cpmm";

  try {
    // DB dedup by mintAddress — same token can produce multiple pool-create txns
    const existing = await db
      .select({ id: tokenRadarTable.id })
      .from(tokenRadarTable)
      .where(eq(tokenRadarTable.mintAddress, mintAddress))
      .limit(1);
    if (existing.length > 0) {
      console.log(`[radar] skipped duplicate mint ${mintAddress.slice(0, 12)}…`);
      return;
    }

    const meta = await fetchTokenMeta(mintAddress, heliusApiKey);

    await db.insert(tokenRadarTable).values({
      mintAddress,
      dex,
      signature,
      tokenName: meta?.name ?? null,
      tokenSymbol: meta?.symbol ?? null,
      tokenUri: meta?.logoUri ?? null,
      isGraduation,
      detectedAt: new Date(timestamp),
    });

    console.log(`[radar] saved ${dex === "pumpfun" ? "🟣 PumpFun" : isGraduation ? "🎓 GRAD" : dex} ${mintAddress.slice(0, 12)}… ${meta?.symbol ?? "(no meta)"}`);
  } catch (err) {
    console.error("[radar] DB insert error:", err instanceof Error ? err.message : String(err));
  }
}

// ─── DexScreener feed ──────────────────────────────────────────────────────

const dsSeenTokens = new Set<string>();
let dsFeedActive = false;

async function handleDsToken(event: DsTokenEvent) {
  const key = `${event.source}:${event.tokenAddress}`;
  if (dsSeenTokens.has(key)) return;
  dsSeenTokens.add(key);
  if (dsSeenTokens.size > 5000) {
    const first = dsSeenTokens.values().next().value;
    if (first) dsSeenTokens.delete(first);
  }

  try {
    const existing = await db
      .select({ id: tokenRadarTable.id })
      .from(tokenRadarTable)
      .where(eq(tokenRadarTable.mintAddress, event.tokenAddress))
      .limit(1);

    if (existing.length > 0) return;

    const dex = event.source === "boost" ? "dexscreener_boost" : event.source === "cto" ? "dexscreener_cto" : "dexscreener";

    await db.insert(tokenRadarTable).values({
      mintAddress: event.tokenAddress,
      dex,
      signature: `ds_${event.source}_${event.tokenAddress}`,
      tokenName: event.description?.slice(0, 60) ?? null,
      tokenSymbol: null,
      tokenUri: event.icon ?? null,
      isGraduation: false,
      detectedAt: new Date(),
    });

    console.log(`[radar] 📡 DexScreener ${event.source} ${event.tokenAddress.slice(0, 12)}…`);
  } catch (err) {
    console.error("[radar] DS DB insert error:", err instanceof Error ? err.message : String(err));
  }
}

export function startDsRadarFeed() {
  if (dsFeedActive) return;
  dsFeedActive = true;
  const monitor = getDexScreenerMonitor();
  monitor.on("token", (ev: DsTokenEvent) => void handleDsToken(ev));
  if (!monitor.isRunning) monitor.start();
  console.log("[radar] DexScreener feed started");
}

export function stopDsRadarFeed() {
  if (!dsFeedActive) return;
  dsFeedActive = false;
  getDexScreenerMonitor().stop();
  console.log("[radar] DexScreener feed stopped");
}

// ─── Start / Stop ──────────────────────────────────────────────────────────

function dexesForWatchMode(mode: WatchMode): Array<"raydium" | "raydium_cpmm" | "pumpfun"> {
  if (mode === "graduated") return ["raydium", "raydium_cpmm"];
  if (mode === "created") return ["pumpfun"];
  return ["raydium", "raydium_cpmm", "pumpfun"];
}

export async function startGlobalRadar(watchMode: WatchMode = "all"): Promise<{ started: boolean; error?: string }> {
  if (radarRunning) return { started: true };

  const settings = await getSettings();
  if (!settings.heliusApiKey) {
    console.log("[radar] No Helius API key — radar disabled (set it in Settings)");
    return { started: false, error: "No Helius API key configured. Add your Helius API key in Settings." };
  }

  radarWatchMode = watchMode;
  radarRunning = true;
  console.log(`[radar] Starting global token radar (mode=${watchMode})...`);

  radarDetector = new PoolDetector(
    `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`,
    settings.heliusApiKey,
    dexesForWatchMode(watchMode),
  );

  radarDetector.on("newPool", (event: NewPoolEvent) => {
    void handleNewPool(event, settings.heliusApiKey ?? undefined);
  });

  radarDetector.connect();
  return { started: true };
}

export function stopGlobalRadar() {
  radarDetector?.disconnect();
  radarDetector = null;
  radarRunning = false;
  console.log("[radar] Stopped.");
}

export async function restartGlobalRadar(watchMode?: WatchMode): Promise<{ started: boolean; error?: string }> {
  stopGlobalRadar();
  return startGlobalRadar(watchMode ?? radarWatchMode);
}

export function getRadarRunningStatus(): { isRunning: boolean; watchMode: WatchMode } {
  return { isRunning: radarRunning, watchMode: radarWatchMode };
}

// ─── DB queries ────────────────────────────────────────────────────────────

export async function getRadarTokens(limit = 200, offset = 0, filter?: "all" | "graduation" | "pumpfun" | "raydium" | "dexscreener") {
  const base = db.select().from(tokenRadarTable);

  if (filter === "graduation" || filter === "raydium") {
    return base.where(eq(tokenRadarTable.isGraduation, true)).orderBy(desc(tokenRadarTable.detectedAt)).limit(limit).offset(offset);
  } else if (filter === "pumpfun") {
    return base.where(eq(tokenRadarTable.dex, "pumpfun")).orderBy(desc(tokenRadarTable.detectedAt)).limit(limit).offset(offset);
  } else if (filter === "dexscreener") {
    return base.where(
      or(
        eq(tokenRadarTable.dex, "dexscreener"),
        eq(tokenRadarTable.dex, "dexscreener_boost"),
        eq(tokenRadarTable.dex, "dexscreener_cto"),
      )!
    ).orderBy(desc(tokenRadarTable.detectedAt)).limit(limit).offset(offset);
  }

  return base.orderBy(desc(tokenRadarTable.detectedAt)).limit(limit).offset(offset);
}
