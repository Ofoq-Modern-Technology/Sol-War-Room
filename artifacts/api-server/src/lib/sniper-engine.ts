import { Connection, PublicKey, Transaction, VersionedTransaction, SystemProgram, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { db, sniperConfigsTable, sniperTradesTable, accountsTable } from "@workspace/db";
import { eq, inArray, ne } from "drizzle-orm";
import { PoolDetector, NewPoolEvent } from "./pool-detector.js";
import { decrypt } from "./crypto.js";
import { getSettings } from "./settingsStore.js";
import { getDexScreenerMonitor, DsTokenEvent } from "./dexscreener-monitor.js";
import { getSolBalance } from "./solana.js";

const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt13qaRDsR",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

const JUPITER_BASE = "https://api.jup.ag/swap/v1";
const WSOL = "So11111111111111111111111111111111111111112";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Global Jupiter rate limiter ────────────────────────────────────────────
// Jupiter rate limiter: 4 concurrent requests, 150ms cool-down between slots.
// drainJupQueue fills ALL available slots each time it's called so there's no
// artificial one-at-a-time bottleneck while staying under ~20 req/s.
const JUP_MAX_CONCURRENT = 4;
const JUP_GAP_MS = 150;
let jupInFlight = 0;
const jupQueue: Array<() => void> = [];

function drainJupQueue() {
  // Fill every available concurrent slot in one pass
  while (jupInFlight < JUP_MAX_CONCURRENT && jupQueue.length > 0) {
    const next = jupQueue.shift()!;
    jupInFlight++;
    Promise.resolve().then(next).finally(() => {
      jupInFlight--;
      setTimeout(drainJupQueue, JUP_GAP_MS);
    });
  }
}

function jupFetch(url: string, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    jupQueue.push(() => fetch(url, init).then(resolve).catch(reject));
    drainJupQueue();
  });
}
// ────────────────────────────────────────────────────────────────────────────

const addLog = (configId: number, msg: string) => {
  const entry = `[${new Date().toISOString()}] [sniper #${configId}] ${msg}`;
  console.log(entry);
  const lines = sniperLogs.get(configId) ?? [];
  lines.unshift(entry);
  if (lines.length > 200) lines.pop();
  sniperLogs.set(configId, lines);
};

export const sniperLogs = new Map<number, string[]>();

// Minimum SOL overhead required beyond the buy amount (ATA rent + fees).
// Mirrors the constant in solana.ts so we can pre-screen before calling Jupiter.
const SNIPER_OVERHEAD_LAMPORTS = 7_000_000; // 0.007 SOL

interface RunningSniper {
  configId: number;
  detector?: PoolDetector; // undefined when running in CTO-only mode (no targetDexes)
  password: string;
  snipedPools: Map<string, number>;
  /** Account IDs paused because SOL balance is too low to snipe. Cleared when balance recovers. */
  stalledAccounts: Set<number>;
  balanceCheckTimer?: ReturnType<typeof setInterval>;
}

const running = new Map<number, RunningSniper>();
const dsListeners = new Map<number, (ev: DsTokenEvent) => void>();

export function getSniperLogs(configId: number, limit = 100): string[] {
  return (sniperLogs.get(configId) ?? []).slice(0, limit);
}

/**
 * Fetch live SOL balances for all accounts in a running sniper and update the
 * stalledAccounts set.  An account is stalled when its balance is too low to
 * cover the configured buy amount + ATA rent/fee overhead.  It is un-stalled
 * automatically once the balance recovers (e.g. after a sell).
 */
async function refreshAccountBalances(sniper: RunningSniper, config: typeof sniperConfigsTable.$inferSelect, rpc: string) {
  const accountIds: number[] = JSON.parse(config.accountIds);
  if (accountIds.length === 0) return;

  const accounts = await db
    .select({ id: accountsTable.id, name: accountsTable.name, publicKey: accountsTable.publicKey })
    .from(accountsTable)
    .where(inArray(accountsTable.id, accountIds));

  const cfg = config as typeof config & { buyMode?: string; buyPercent?: number };
  const buyMode = cfg.buyMode ?? "fixed";
  const buyPercent = cfg.buyPercent ?? 90;
  const FEE_BUFFER_SOL = 0.005;

  for (const acc of accounts) {
    // getSolBalance returns SOL (already divided by 1e9)
    let liveSol: number;
    try {
      liveSol = await getSolBalance(acc.publicKey, rpc);
    } catch {
      continue; // RPC error — leave current stall state unchanged
    }

    // Determine required SOL: buy amount + overhead
    let requiredSol: number;
    if (buyMode === "percent") {
      requiredSol = FEE_BUFFER_SOL + 0.001; // need at least something to use
    } else {
      requiredSol = config.solPerAccount + (SNIPER_OVERHEAD_LAMPORTS / 1e9);
    }

    const wasStalled = sniper.stalledAccounts.has(acc.id);
    const isLow = liveSol < requiredSol;

    if (isLow && !wasStalled) {
      sniper.stalledAccounts.add(acc.id);
      addLog(sniper.configId, `[${acc.name}] ⏸ STALLED — balance ${liveSol.toFixed(4)} SOL < ${requiredSol.toFixed(4)} SOL needed. Will resume when balance recovers.`);
    } else if (!isLow && wasStalled) {
      sniper.stalledAccounts.delete(acc.id);
      addLog(sniper.configId, `[${acc.name}] ▶ RESUMED — balance recovered to ${liveSol.toFixed(4)} SOL`);
    }

    // Keep DB in sync too
    await db.update(accountsTable).set({ solBalance: liveSol }).where(eq(accountsTable.id, acc.id));
  }
}

export async function startSniperEngine(configId: number, password: string) {
  if (running.has(configId)) throw new Error("Already running");

  const [config] = await db.select().from(sniperConfigsTable).where(eq(sniperConfigsTable.id, configId));
  if (!config) throw new Error("Config not found");

  const accountIds: number[] = JSON.parse(config.accountIds);
  if (accountIds.length === 0) throw new Error("No accounts selected");

  const targetDexes: string[] = JSON.parse(config.targetDexes);
  const settings = await getSettings();
  const heliusKey = settings.heliusApiKey ?? undefined;

  const rpc = heliusKey
    ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
    : "https://api.mainnet-beta.solana.com";

  // CTO-only mode: skip pool detector entirely when no DEXes are selected
  const ctoOnly = targetDexes.length === 0;
  if (!ctoOnly && !config.enableCtoBuy) {
    // Safety: don't start if nothing would happen
    throw new Error("At least one target DEX or CTO mode must be enabled");
  }

  let detector: PoolDetector | undefined;
  if (!ctoOnly) {
    detector = new PoolDetector(rpc, heliusKey, targetDexes);
  }

  const sniper: RunningSniper = { configId, detector, password, snipedPools: new Map(), stalledAccounts: new Set() };
  running.set(configId, sniper);

  if (detector) {
    detector.on("newPool", (event: NewPoolEvent) => {
      void handlePool(sniper, config, event);
    });
    detector.connect();
  }

  if (config.enableCtoBuy) {
    const dsListener = (ev: DsTokenEvent) => void handleCtoToken(configId, ev);
    dsListeners.set(configId, dsListener);
    const dsMonitor = getDexScreenerMonitor();
    dsMonitor.on("cto", dsListener);
    if (!dsMonitor.isRunning) dsMonitor.start();
    addLog(configId, "[CTO] DexScreener community takeover feed active — buying on new CTO listings (polling every 5s)");
  }

  // Periodic balance check every 60s: stall/unstall accounts based on live RPC balance
  const balanceCheckTimer = setInterval(() => {
    void (async () => {
      const s = running.get(configId);
      if (!s) return;
      const [cfg] = await db.select().from(sniperConfigsTable).where(eq(sniperConfigsTable.id, configId));
      if (cfg) await refreshAccountBalances(s, cfg, rpc);
    })();
  }, 60_000);
  sniper.balanceCheckTimer = balanceCheckTimer;

  // Run an immediate balance check so stalled accounts are flagged before the first buy
  void refreshAccountBalances(sniper, config, rpc);

  await db.update(sniperConfigsTable).set({ status: "running", startedAt: new Date() }).where(eq(sniperConfigsTable.id, configId));
  if (ctoOnly) {
    addLog(configId, `Started (CTO-only mode) — ${accountIds.length} account(s) | balance check every 60s`);
  } else {
    addLog(configId, `Started — watching ${targetDexes.join(", ")} with ${accountIds.length} account(s) | balance check every 60s`);
  }
}

export async function stopSniperEngine(configId: number) {
  const sniper = running.get(configId);
  if (sniper) {
    sniper.detector?.disconnect();
    if (sniper.balanceCheckTimer) clearInterval(sniper.balanceCheckTimer);
    running.delete(configId);
  }
  const dsListener = dsListeners.get(configId);
  if (dsListener) {
    getDexScreenerMonitor().off("cto", dsListener);
    dsListeners.delete(configId);
  }
  // Always reset DB status — handles stale "running" after server restart
  await db.update(sniperConfigsTable).set({ status: "idle", startedAt: null }).where(eq(sniperConfigsTable.id, configId));
  addLog(configId, "Stopped");
}

async function handleCtoToken(configId: number, ev: DsTokenEvent) {
  const sniper = running.get(configId);
  if (!sniper) return;

  const { password, snipedPools } = sniper;
  const [config] = await db.select().from(sniperConfigsTable).where(eq(sniperConfigsTable.id, configId));
  if (!config) return;

  const mintAddress = ev.tokenAddress;
  const existingSnipes = snipedPools.get(mintAddress) ?? 0;
  if (existingSnipes >= config.maxSnipesPerPool) return;

  addLog(configId, `[CTO] DexScreener ${ev.source}: ${mintAddress.slice(0, 14)}… ${ev.description?.slice(0, 40) ?? "(no desc)"}`);

  snipedPools.set(mintAddress, existingSnipes + 1);
  if (snipedPools.size > 5000) {
    const first = snipedPools.keys().next().value;
    if (first) snipedPools.delete(first);
  }

  const accountIds: number[] = JSON.parse(config.accountIds);
  const accounts = await db
    .select({ id: accountsTable.id, name: accountsTable.name, publicKey: accountsTable.publicKey, encryptedPrivateKey: accountsTable.encryptedPrivateKey, solBalance: accountsTable.solBalance })
    .from(accountsTable)
    .where(inArray(accountsTable.id, accountIds));

  const settings = await getSettings();
  const jupKey = settings.jupiterApiKey ?? undefined;
  const heliusKey = settings.heliusApiKey ?? undefined;
  const rpc = heliusKey
    ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
    : "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "confirmed");

  const cfg = config as typeof config & { buyMode?: string; buyPercent?: number };
  const buyMode = cfg.buyMode ?? "fixed";
  const buyPercent = cfg.buyPercent ?? 90;
  const FEE_BUFFER = 0.005;

  const syntheticEvent: NewPoolEvent = {
    mintAddress,
    dex: "raydium",
    signature: `cto_${mintAddress}`,
    timestamp: Date.now(),
  };

  let dispatchIdx = 0;
  for (const account of accounts) {
    // Skip accounts that are stalled due to low balance
    if (sniper.stalledAccounts.has(account.id)) {
      addLog(configId, `[CTO][${account.name}] SKIP — account stalled (insufficient balance)`);
      continue;
    }

    const balance = account.solBalance ?? 0;
    let overrideLamports: number | undefined;

    if (buyMode === "percent") {
      const usable = Math.max(0, balance - FEE_BUFFER);
      const amountSol = usable * (buyPercent / 100);
      if (amountSol < 0.001) {
        addLog(configId, `[CTO][${account.name}] SKIP — balance too low`);
        sniper.stalledAccounts.add(account.id);
        continue;
      }
      overrideLamports = Math.round(amountSol * 1e9);
    } else {
      if (balance < config.solPerAccount + FEE_BUFFER) {
        addLog(configId, `[CTO][${account.name}] SKIP — insufficient balance (${balance.toFixed(4)} SOL)`);
        sniper.stalledAccounts.add(account.id);
        continue;
      }
    }

    const delay = dispatchIdx++ * 150;
    setTimeout(() => {
      void singleSnipe({ config, account, event: syntheticEvent, password, connection, jupKey, overrideLamports, log: (msg) => addLog(configId, msg) });
    }, delay);
  }
}

export function isSniperRunning(configId: number): boolean {
  return running.has(configId);
}

/** Call once on server startup to clear any configs stuck in "running" from a previous process. */
export async function resetStaleSniperStatuses() {
  await db.update(sniperConfigsTable)
    .set({ status: "idle", startedAt: null })
    .where(ne(sniperConfigsTable.status, "idle"));
  console.log("[sniper] Stale running statuses reset to idle on startup");
}

// ─── xAI Social Gate ─────────────────────────────────────────────────────────

async function checkSocialGate(
  mintAddress: string,
  configId: number,
): Promise<{ pass: boolean; reason: string }> {
  const settings = await getSettings();
  const xaiKey = (settings as unknown as Record<string, unknown>).xaiApiKey as string | null;
  if (!xaiKey) return { pass: false, reason: "No xAI API key configured in Settings" };

  let accounts: string[] = [];
  try {
    accounts = JSON.parse((settings as unknown as Record<string, unknown>).socialGateAccounts as string ?? "[]");
  } catch { /* ignore */ }
  if (accounts.length === 0) return { pass: false, reason: "No monitored accounts configured" };

  // Fetch token metadata from Helius to get name + symbol
  let tokenName = mintAddress.slice(0, 8);
  let tokenSymbol = "";
  try {
    const heliusKey = settings.heliusApiKey;
    if (heliusKey) {
      const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: mintAddress } }),
      });
      const d = await r.json() as { result?: { content?: { metadata?: { name?: string; symbol?: string } } } };
      tokenName  = d.result?.content?.metadata?.name   ?? tokenName;
      tokenSymbol = d.result?.content?.metadata?.symbol ?? "";
    }
  } catch { /* proceed without metadata */ }

  const searchTerm = tokenSymbol ? `${tokenName} $${tokenSymbol}` : tokenName;
  const accountList = accounts.map(a => `@${a.replace(/^@/, "")}`).join(", ");

  try {
    const resp = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${xaiKey}` },
      body: JSON.stringify({
        model: "grok-3",
        messages: [{
          role: "user",
          content: `Search X (Twitter) for very recent posts (last 2 hours) mentioning "${searchTerm}" (Solana token, mint: ${mintAddress}). Check these accounts: ${accountList}. Did any of them post about this token? Respond ONLY with a JSON object: {"mentioned": true|false, "accounts": ["@account1"], "summary": "brief description or empty string"}`,
        }],
        search_parameters: { mode: "on", sources: [{ type: "x" }] },
        max_tokens: 300,
        temperature: 0,
      }),
    });

    if (!resp.ok) {
      addLog(configId, `[social-gate] xAI API error ${resp.status} — gate skipped`);
      return { pass: false, reason: `xAI API error: ${resp.status}` };
    }

    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";

    // Extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      addLog(configId, `[social-gate] Could not parse xAI response for ${searchTerm}`);
      return { pass: false, reason: "Could not parse xAI response" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as { mentioned?: boolean; accounts?: string[]; summary?: string };
    if (parsed.mentioned) {
      const who = (parsed.accounts ?? []).join(", ");
      return { pass: true, reason: `Mentioned by ${who}: ${parsed.summary ?? ""}` };
    }
    return { pass: false, reason: `Not mentioned by monitored accounts (${searchTerm})` };
  } catch (err) {
    addLog(configId, `[social-gate] Error: ${err instanceof Error ? err.message : String(err)}`);
    return { pass: false, reason: `Social gate error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function handlePool(sniper: RunningSniper, config: typeof sniperConfigsTable.$inferSelect, event: NewPoolEvent) {
  const { configId, password, snipedPools } = sniper;
  const maxSnipesPerPool: number = config.maxSnipesPerPool;

  const existingSnipes = snipedPools.get(event.mintAddress) ?? 0;
  if (existingSnipes >= maxSnipesPerPool) return;

  const targetDexes: string[] = JSON.parse(config.targetDexes);
  if (!targetDexes.includes(event.dex)) return;

  addLog(configId, `New pool! dex=${event.dex} mint=${event.mintAddress.slice(0, 12)}... sig=${event.signature.slice(0, 12)}...`);

  // xAI social gate — only applies to Raydium (graduated) pools when enabled
  if ((config as unknown as Record<string, unknown>).enableSocialGate && (event.dex === "raydium" || event.dex === "raydium_cpmm")) {
    addLog(configId, `[social-gate] Checking xAI for ${event.mintAddress.slice(0, 12)}...`);
    const gate = await checkSocialGate(event.mintAddress, configId);
    if (!gate.pass) {
      addLog(configId, `[social-gate] SKIP — ${gate.reason}`);
      return;
    }
    addLog(configId, `[social-gate] PASS — ${gate.reason}`);
  }

  snipedPools.set(event.mintAddress, existingSnipes + 1);
  if (snipedPools.size > 5000) {
    const first = snipedPools.keys().next().value;
    if (first) snipedPools.delete(first);
  }

  const accountIds: number[] = JSON.parse(config.accountIds);
  const accounts = await db
    .select({ id: accountsTable.id, name: accountsTable.name, publicKey: accountsTable.publicKey, encryptedPrivateKey: accountsTable.encryptedPrivateKey, solBalance: accountsTable.solBalance })
    .from(accountsTable)
    .where(inArray(accountsTable.id, accountIds));

  const settings = await getSettings();
  const jupKey = settings.jupiterApiKey ?? undefined;
  const heliusKey = settings.heliusApiKey ?? undefined;
  const rpc = heliusKey
    ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
    : "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "confirmed");

  // Buy-mode config
  const cfg = config as typeof config & { buyMode?: string; buyPercent?: number };
  const buyMode = cfg.buyMode ?? "fixed";
  const buyPercent = cfg.buyPercent ?? 90;
  const FEE_BUFFER = 0.005; // SOL reserved for tx fees

  let dispatchIdx = 0;
  for (const account of accounts) {
    // Skip accounts stalled due to low balance
    if (sniper.stalledAccounts.has(account.id)) {
      addLog(configId, `[${account.name}] SKIP — account stalled (insufficient balance)`);
      continue;
    }

    const balance = account.solBalance ?? 0;
    let overrideLamports: number | undefined;

    if (buyMode === "percent") {
      const usable = Math.max(0, balance - FEE_BUFFER);
      const amountSol = usable * (buyPercent / 100);
      if (amountSol < 0.001) {
        addLog(configId, `[${account.name}] SKIP — balance too low for ${buyPercent}% mode (${balance.toFixed(4)} SOL, need > ${(FEE_BUFFER + 0.001).toFixed(3)} SOL)`);
        sniper.stalledAccounts.add(account.id);
        continue;
      }
      overrideLamports = Math.round(amountSol * 1e9);
    } else {
      // Fixed mode: skip accounts with insufficient balance
      if (balance < config.solPerAccount + FEE_BUFFER) {
        addLog(configId, `[${account.name}] SKIP — insufficient balance (${balance.toFixed(4)} SOL, need ≥ ${(config.solPerAccount + FEE_BUFFER).toFixed(4)} SOL)`);
        sniper.stalledAccounts.add(account.id);
        continue;
      }
    }

    const delay = dispatchIdx++ * 150;
    setTimeout(() => {
      void singleSnipe({ config, account, event, password, connection, jupKey, overrideLamports, log: (msg) => addLog(configId, msg) });
    }, delay);
  }
}

interface AccountData {
  id: number;
  name: string | null;
  publicKey: string;
  encryptedPrivateKey: string;
}

interface SnipeArgs {
  config: typeof sniperConfigsTable.$inferSelect;
  account: AccountData;
  event: NewPoolEvent;
  password: string;
  connection: Connection;
  jupKey?: string;
  overrideLamports?: number;
  log: (msg: string) => void;
}

async function singleSnipe({ config, account, event, password, connection, jupKey, overrideLamports, log }: SnipeArgs) {
  const lamports = overrideLamports ?? Math.round(config.solPerAccount * 1e9);
  const solPerAccount = lamports / 1e9;

  let privateKeyBase58: string;
  try {
    privateKeyBase58 = decrypt(account.encryptedPrivateKey, password);
  } catch {
    log(`[${account.name}] Key decrypt failed — wrong password?`);
    return;
  }

  const keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
  log(`[${account.name}] Sniping ${event.mintAddress.slice(0, 12)}... (${solPerAccount} SOL)`);

  const [tradeRow] = await db.insert(sniperTradesTable).values({
    configId: config.id,
    mintAddress: event.mintAddress,
    dex: event.dex,
    accountId: account.id,
    solSpent: solPerAccount,
    status: "pending",
    detectedAt: new Date(event.timestamp),
  }).returning();

  const tradeId = tradeRow.id;

  // Pump.fun pools take a moment to become routable on Jupiter — wait before first attempt
  if (event.dex === "pumpfun") await sleep(1500);

  let _stage = "init";
  try {
    const QUOTE_URL = `${JUPITER_BASE}/quote?inputMint=${WSOL}&outputMint=${event.mintAddress}&amount=${lamports}&slippageBps=${config.maxBuySlippageBps}&swapMode=ExactIn`;
    const jupHeaders = { "Content-Type": "application/json", ...(jupKey ? { "x-api-key": jupKey } : {}) };

    // Retry loop: up to 5 attempts, backing off on TOKEN_NOT_TRADABLE / network errors
    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [0, 1500, 3000, 5000, 8000];
    let quote: Record<string, unknown> | null = null;
    let lastErr = "";

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const wait = RETRY_DELAYS[attempt] ?? 8000;
        log(`[${account.name}] Retry ${attempt}/${MAX_RETRIES - 1} in ${wait}ms — ${lastErr.slice(0, 60)}`);
        await sleep(wait);
      }
      let q: Record<string, unknown>;
      try {
        _stage = `quote-fetch-attempt-${attempt}`;
        const quoteRes = await jupFetch(QUOTE_URL, { headers: jupKey ? { "x-api-key": jupKey } : {} });
        _stage = `quote-json-attempt-${attempt}`;
        q = await quoteRes.json() as Record<string, unknown>;

        // Check for HTTP-level errors (401 Unauthorized, 403, 429, etc.)
        if (!quoteRes.ok) {
          const code = (q as { code?: number }).code;
          const msg = (q as { message?: string }).message ?? JSON.stringify(q);
          // 401 = no API key / unauthorized → abort, no point retrying
          if (code === 401 || quoteRes.status === 401) {
            throw new Error(`Jupiter API key required (401 Unauthorized). Set your Jupiter API key in Settings.`);
          }
          // 429 = rate limited → retry
          if (quoteRes.status === 429) {
            lastErr = `Rate limited (429): ${msg}`;
            if (attempt === MAX_RETRIES - 1) throw new Error(lastErr);
            continue;
          }
          throw new Error(`Jupiter HTTP ${quoteRes.status}: ${msg}`);
        }
      } catch (networkErr) {
        // Re-throw our intentional errors (401, etc.) without retrying
        if (networkErr instanceof Error && (networkErr.message.includes("401") || networkErr.message.includes("API key required"))) throw networkErr;
        // Pure network / fetch error — retry
        const cause = (networkErr as { cause?: { code?: string; message?: string } }).cause;
        lastErr = networkErr instanceof Error ? `${networkErr.message}${cause ? ` (${cause.code ?? cause.message})` : ""}` : String(networkErr);
        if (attempt === MAX_RETRIES - 1) throw new Error(`Quote network error after ${MAX_RETRIES} attempts: ${lastErr}`);
        continue;
      }

      const qErr = (q as { error?: string; errorCode?: string }).error ?? "";
      if (qErr) {
        lastErr = qErr;
        // TOKEN_NOT_TRADABLE or not-indexed yet → retry with backoff
        if (qErr.includes("not tradable") || qErr.includes("TOKEN_NOT_TRADABLE") || qErr.includes("not indexed")) continue;
        // Any other Jupiter error → abort immediately (bad token, wrong params, etc.)
        throw new Error(`Quote failed: ${JSON.stringify(q)}`);
      }
      quote = q;
      break;
    }

    if (!quote) throw new Error(`Quote not available after ${MAX_RETRIES} attempts: ${lastErr}`);

    _stage = "swap-fetch";
    const swapRes = await jupFetch(`${JUPITER_BASE}/swap`, {
      method: "POST",
      headers: jupHeaders,
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
      }),
    });
    _stage = "swap-json";
    const swapData = await swapRes.json() as { swapTransaction?: string; error?: string };
    if (!swapData.swapTransaction) throw new Error(`Swap failed: ${JSON.stringify(swapData)}`);

    _stage = "deserialize-tx";
    const txBuf = Buffer.from(swapData.swapTransaction, "base64");
    const buyTx = VersionedTransaction.deserialize(txBuf);
    buyTx.sign([keypair]);

    let signature = "";

    if (config.useJito) {
      _stage = "jito-blockhash";
      const tipLamports = config.jitoTipLamports;
      const tipAccount = new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]);
      const tipTx = new Transaction().add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: tipAccount, lamports: tipLamports }));
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tipTx.recentBlockhash = blockhash;
      tipTx.feePayer = keypair.publicKey;
      tipTx.sign(keypair);

      const jitoEndpoint = "https://mainnet.block-engine.jito.labs.io/api/v1/bundles";
      const bundle = [
        Buffer.from(buyTx.serialize()).toString("base64"),
        Buffer.from(tipTx.serialize()).toString("base64"),
      ];

      _stage = "jito-send";
      let jitoOk = false;
      try {
        const jitoRes = await fetch(jitoEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendBundle", params: [bundle] }),
        });
        const jitoData = await jitoRes.json() as { result?: string; error?: { message: string } };
        if (jitoData.error) throw new Error(`Jito error: ${jitoData.error.message}`);
        signature = jitoData.result ?? "bundle-submitted";
        log(`[${account.name}] Jito bundle submitted: ${signature.slice(0, 12)}...`);
        jitoOk = true;
      } catch (jitoErr) {
        const jitoMsg = jitoErr instanceof Error ? jitoErr.message : String(jitoErr);
        log(`[${account.name}] Jito unavailable (${jitoMsg}), falling back to RPC`);
      }

      if (!jitoOk) {
        _stage = "rpc-send-fallback";
        signature = await connection.sendRawTransaction(buyTx.serialize(), { skipPreflight: true });
        log(`[${account.name}] Tx sent via RPC (Jito fallback): ${signature.slice(0, 12)}...`);
      }
    } else {
      _stage = "rpc-send";
      signature = await connection.sendRawTransaction(buyTx.serialize(), { skipPreflight: true });
      log(`[${account.name}] Tx sent: ${signature.slice(0, 12)}...`);
    }

    const tokensReceived = Number((quote as { outAmount?: string }).outAmount ?? 0);

    await db.update(sniperTradesTable).set({
      status: "bought",
      buyTxSignature: signature,
      tokensReceived,
      boughtAt: new Date(),
    }).where(eq(sniperTradesTable.id, tradeId));

    const [cur] = await db.select({ totalSnipes: sniperConfigsTable.totalSnipes }).from(sniperConfigsTable).where(eq(sniperConfigsTable.id, config.id));
    await db.update(sniperConfigsTable).set({ totalSnipes: (cur?.totalSnipes ?? 0) + 1 }).where(eq(sniperConfigsTable.id, config.id));

    log(`[${account.name}] BUY OK — received ${tokensReceived.toFixed(2)} tokens`);
    scheduleExit({ config, account, tradeId, mintAddress: event.mintAddress, tokensReceived, keypair, connection, jupKey, log });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cause = (err as { cause?: { code?: string; message?: string; name?: string } }).cause;
    const causeStr = cause ? ` [cause: ${cause.code ?? cause.name ?? cause.message ?? JSON.stringify(cause)}]` : "";
    const ctor = err instanceof Error ? err.constructor?.name : typeof err;
    log(`[${account.name}] Snipe FAILED @${_stage} (${ctor}): ${msg}${causeStr}`);
    await db.update(sniperTradesTable).set({ status: "failed", error: msg }).where(eq(sniperTradesTable.id, tradeId));
  }
}

interface ExitArgs {
  config: typeof sniperConfigsTable.$inferSelect;
  account: AccountData;
  tradeId: number;
  mintAddress: string;
  tokensReceived: number;
  keypair: Keypair;
  connection: Connection;
  jupKey?: string;
  log: (msg: string) => void;
}

function scheduleExit(args: ExitArgs) {
  const { config, log, account } = args;
  const cfg = config as typeof config & { stopLossPct?: number };

  if (config.exitStrategy === "manual") {
    log(`[${account.name}] Exit strategy=manual — sell manually`);
    return;
  }

  if (config.exitStrategy === "timer") {
    const delayMs = (config.exitTimerSeconds ?? 300) * 1000;
    log(`[${account.name}] Exit timer: ${config.exitTimerSeconds}s`);
    setTimeout(() => void executeSell(args), delayMs);
    return;
  }

  if (config.exitStrategy === "multiplier") {
    const targetMultiplier = config.exitMultiplier ?? 2.0;
    log(`[${account.name}] Exit multiplier: ${targetMultiplier}x — polling price...`);
    pollForMultiplier(args, targetMultiplier);
    return;
  }

  if (config.exitStrategy === "tpsl") {
    const tp = config.exitMultiplier ?? 1.5;
    const sl = cfg.stopLossPct ?? 20;
    log(`[${account.name}] Exit TP/SL: take-profit at ${tp}x, stop-loss at -${sl}%`);
    pollForTpSl(args, tp, sl);
    return;
  }
}

function pollForMultiplier(args: ExitArgs, targetMultiplier: number) {
  const { mintAddress, tokensReceived, log, account, config } = args;
  const tokenAmount = Math.round(tokensReceived);
  const initialSolSpent = config.solPerAccount;
  const jupKey = args.jupKey;

  let attempts = 0;
  const maxAttempts = 360;
  const interval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(interval);
      log(`[${account.name}] Multiplier poll timed out (1h), selling`);
      void executeSell(args);
      return;
    }
    if (!isSniperRunning(config.id)) {
      clearInterval(interval);
      return;
    }

    try {
      const quoteRes = await jupFetch(`${JUPITER_BASE}/quote?inputMint=${mintAddress}&outputMint=${WSOL}&amount=${tokenAmount}&swapMode=ExactIn`, {
        headers: jupKey ? { "x-api-key": jupKey } : {},
      });
      const q = await quoteRes.json() as { outAmount?: string };
      const currentSol = Number(q.outAmount ?? 0) / 1e9;
      const multiplier = currentSol / initialSolSpent;
      if (multiplier >= targetMultiplier) {
        clearInterval(interval);
        log(`[${account.name}] Hit ${multiplier.toFixed(2)}x target, selling!`);
        void executeSell(args);
      }
    } catch { /* continue polling */ }
  }, 10000);
}

function pollForTpSl(args: ExitArgs, tpMultiplier: number, slPct: number) {
  const { mintAddress, tokensReceived, log, account, config } = args;
  const tokenAmount = Math.round(tokensReceived);
  const initialSolSpent = config.solPerAccount;
  const jupKey = args.jupKey;
  const slMultiplier = 1 - slPct / 100; // e.g. -20% → 0.80

  let attempts = 0;
  const maxAttempts = 720; // 2h at 10s poll
  const interval = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(interval);
      log(`[${account.name}] TP/SL poll timed out (2h), selling`);
      void executeSell(args);
      return;
    }
    if (!isSniperRunning(config.id)) {
      clearInterval(interval);
      return;
    }

    try {
      const quoteRes = await jupFetch(`${JUPITER_BASE}/quote?inputMint=${mintAddress}&outputMint=${WSOL}&amount=${tokenAmount}&swapMode=ExactIn`, {
        headers: jupKey ? { "x-api-key": jupKey } : {},
      });
      const q = await quoteRes.json() as { outAmount?: string };
      const currentSol = Number(q.outAmount ?? 0) / 1e9;
      const multiplier = currentSol / initialSolSpent;

      if (multiplier >= tpMultiplier) {
        clearInterval(interval);
        log(`[${account.name}] TP hit at ${multiplier.toFixed(2)}x (target ${tpMultiplier}x) — selling!`);
        void executeSell(args);
      } else if (multiplier <= slMultiplier) {
        clearInterval(interval);
        log(`[${account.name}] SL hit at ${multiplier.toFixed(2)}x (stop-loss -${slPct}%) — selling!`);
        void executeSell(args);
      }
    } catch { /* continue polling */ }
  }, 10000);
}

async function executeSell(args: ExitArgs, keepBoughtOnFailure = false) {
  const { config, account, tradeId, mintAddress, tokensReceived, keypair, connection, jupKey, log } = args;
  const tokenAmount = Math.round(tokensReceived);

  if (tokenAmount <= 0) {
    log(`[${account.name}] No tokens to sell`);
    return;
  }

  log(`[${account.name}] Executing sell of ${tokenAmount} tokens...`);

  try {
    const quoteRes = await jupFetch(`${JUPITER_BASE}/quote?inputMint=${mintAddress}&outputMint=${WSOL}&amount=${tokenAmount}&slippageBps=${config.maxBuySlippageBps}&swapMode=ExactIn`, {
      headers: jupKey ? { "x-api-key": jupKey } : {},
    });
    const quote = await quoteRes.json() as Record<string, unknown>;
    if ((quote as { error?: string }).error) throw new Error(`Sell quote error: ${JSON.stringify(quote)}`);

    const swapRes = await jupFetch(`${JUPITER_BASE}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(jupKey ? { "x-api-key": jupKey } : {}) },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
      }),
    });
    const swapData = await swapRes.json() as { swapTransaction?: string };
    if (!swapData.swapTransaction) throw new Error("No sell swapTransaction");

    const sellTx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, "base64"));
    sellTx.sign([keypair]);

    let sellSig = "";
    if (config.useJito) {
      const tipLamports = Math.round(config.jitoTipLamports / 2);
      const tipAccount = new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]);
      const tipTx = new Transaction().add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: tipAccount, lamports: tipLamports }));
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tipTx.recentBlockhash = blockhash;
      tipTx.feePayer = keypair.publicKey;
      tipTx.sign(keypair);
      const jitoEndpoint = "https://mainnet.block-engine.jito.labs.io/api/v1/bundles";
      const bundle = [
        Buffer.from(sellTx.serialize()).toString("base64"),
        Buffer.from(tipTx.serialize()).toString("base64"),
      ];
      let jitoSellOk = false;
      try {
        const jitoRes = await fetch(jitoEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendBundle", params: [bundle] }),
        });
        const jitoData = await jitoRes.json() as { result?: string };
        sellSig = jitoData.result ?? "sell-bundle-submitted";
        jitoSellOk = true;
      } catch (jitoErr) {
        const jitoMsg = jitoErr instanceof Error ? jitoErr.message : String(jitoErr);
        log(`[${account.name}] Sell: Jito unavailable (${jitoMsg}), falling back to RPC`);
      }
      if (!jitoSellOk) {
        sellSig = await connection.sendRawTransaction(sellTx.serialize(), { skipPreflight: true });
        log(`[${account.name}] Sell tx sent via RPC (Jito fallback)`);
      }
    } else {
      sellSig = await connection.sendRawTransaction(sellTx.serialize(), { skipPreflight: true });
    }

    const solReceived = Number((quote as { outAmount?: string }).outAmount ?? 0) / 1e9;
    const pnlSol = solReceived - config.solPerAccount;

    await db.update(sniperTradesTable).set({
      status: "sold",
      sellTxSignature: sellSig,
      solReceived,
      pnlSol,
      soldAt: new Date(),
    }).where(eq(sniperTradesTable.id, tradeId));

    const [cur] = await db.select({ totalPnlSol: sniperConfigsTable.totalPnlSol }).from(sniperConfigsTable).where(eq(sniperConfigsTable.id, config.id));
    await db.update(sniperConfigsTable).set({ totalPnlSol: (cur?.totalPnlSol ?? 0) + pnlSol }).where(eq(sniperConfigsTable.id, config.id));

    log(`[${account.name}] SOLD! received=${solReceived.toFixed(4)} SOL PnL=${pnlSol >= 0 ? "+" : ""}${pnlSol.toFixed(4)} SOL`);

    // After a sell, re-check this account's balance so it can be un-stalled if it recovered
    const sniperRef = running.get(config.id);
    if (sniperRef) {
      const postSellSettings = await getSettings();
      const heliusKey: string | undefined = (postSellSettings as { heliusApiKey?: string | null }).heliusApiKey ?? undefined;
      const rpcForCheck = heliusKey
        ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
        : "https://api.mainnet-beta.solana.com";
      void refreshAccountBalances(sniperRef, config, rpcForCheck);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[${account.name}] SELL FAILED: ${msg}`);
    if (keepBoughtOnFailure) {
      // Keep as "bought" so the position remains visible in Holdings — user can retry manually
      await db.update(sniperTradesTable).set({ error: `sell: ${msg}` }).where(eq(sniperTradesTable.id, tradeId));
    } else {
      await db.update(sniperTradesTable).set({ status: "failed", error: `sell: ${msg}` }).where(eq(sniperTradesTable.id, tradeId));
    }
  }
}

// ─── Manual sell (outside engine lifecycle) ──────────────────────────────────

export interface ManualSellResult {
  tradeId: number;
  ok: boolean;
  error?: string;
  solReceived?: number;
  pnlSol?: number;
}

async function buildSellArgs(tradeId: number, password: string, log: (msg: string) => void): Promise<ExitArgs> {
  const [trade] = await db.select().from(sniperTradesTable).where(eq(sniperTradesTable.id, tradeId));
  if (!trade) throw new Error(`Trade ${tradeId} not found`);
  if (trade.status !== "bought" && trade.status !== "pending") {
    throw new Error(`Trade ${tradeId} has status '${trade.status}', cannot sell`);
  }

  const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, trade.accountId));
  if (!account) throw new Error(`Account ${trade.accountId} not found`);

  const [config] = await db.select().from(sniperConfigsTable).where(eq(sniperConfigsTable.id, trade.configId));
  if (!config) throw new Error(`Config ${trade.configId} not found`);

  const privateKeyBase58 = decrypt(account.encryptedPrivateKey, password);
  const keypair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));

  const settings = getSettings();
  const rpcUrl = settings.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
    : "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  return {
    config,
    account: { id: account.id, name: account.name ?? null, publicKey: account.publicKey, encryptedPrivateKey: account.encryptedPrivateKey },
    tradeId,
    mintAddress: trade.mintAddress,
    tokensReceived: trade.tokensReceived ?? 0,
    keypair,
    connection,
    jupKey: settings.jupiterApiKey ?? undefined,
    log,
  };
}

export async function sellTradeById(
  tradeId: number,
  password: string,
  log?: (msg: string) => void,
): Promise<ManualSellResult> {
  const logger = log ?? ((msg: string) => console.log(`[manual-sell] ${msg}`));
  try {
    const args = await buildSellArgs(tradeId, password, logger);
    await executeSell(args);
    const [updated] = await db.select().from(sniperTradesTable).where(eq(sniperTradesTable.id, tradeId));
    return {
      tradeId,
      ok: updated?.status === "sold",
      solReceived: updated?.solReceived ?? undefined,
      pnlSol: updated?.pnlSol ?? undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger(`[trade ${tradeId}] build failed: ${msg}`);
    return { tradeId, ok: false, error: msg };
  }
}

export async function sellAllBoughtTrades(
  password: string,
  log?: (msg: string) => void,
): Promise<ManualSellResult[]> {
  const logger = log ?? ((msg: string) => console.log(`[sell-all] ${msg}`));
  const trades = await db
    .select({ id: sniperTradesTable.id })
    .from(sniperTradesTable)
    .where(eq(sniperTradesTable.status, "bought"));

  if (trades.length === 0) return [];
  logger(`Selling ${trades.length} position(s) sequentially (rate-limited)...`);

  const results: ManualSellResult[] = [];
  for (const t of trades) {
    try {
      const args = await buildSellArgs(t.id, password, logger);
      await executeSell(args, true /* keepBoughtOnFailure */);
      const [updated] = await db.select().from(sniperTradesTable).where(eq(sniperTradesTable.id, t.id));
      results.push({
        tradeId: t.id,
        ok: updated?.status === "sold",
        solReceived: updated?.solReceived ?? undefined,
        pnlSol: updated?.pnlSol ?? undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger(`[trade ${t.id}] sell-all failed: ${msg}`);
      results.push({ tradeId: t.id, ok: false, error: msg });
    }
    // Brief gap between sells to avoid Jupiter rate limits
    await sleep(400);
  }
  return results;
}

// ─── Scan wallets & sell all tokens (recovery mode) ──────────────────────────

export interface WalletTokenSellResult {
  accountId: number;
  accountName: string;
  tokens: Array<{
    mint: string;
    rawAmount: number;
    solReceived?: number;
    txSignature?: string;
    skipped?: boolean;
    skipReason?: string;
    error?: string;
  }>;
}

const TOKEN_PROGRAM_ID_STR = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MIN_SELL_SOL = 0.0001; // dust threshold

export async function scanAndSellWalletTokens(
  accountIds: number[],
  password: string,
  slippageBps = 2000,
  log: (msg: string) => void = (m) => console.log(`[scan-sell] ${m}`),
): Promise<WalletTokenSellResult[]> {
  const settings = await getSettings();
  const jupKey = settings.jupiterApiKey ?? undefined;
  const rpc = settings.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
    : "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "confirmed");

  const accounts = await db
    .select()
    .from(accountsTable)
    .where(inArray(accountsTable.id, accountIds));

  const results: WalletTokenSellResult[] = [];

  for (const account of accounts) {
    log(`Scanning ${account.name} (${account.publicKey.slice(0, 8)}...)`);
    const walletResult: WalletTokenSellResult = {
      accountId: account.id,
      accountName: account.name ?? `Wallet ${account.id}`,
      tokens: [],
    };

    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecretKey(bs58.decode(decrypt(account.encryptedPrivateKey, password)));
    } catch {
      log(`[${account.name}] Key decrypt failed — wrong password?`);
      results.push(walletResult);
      continue;
    }

    const pubkey = new PublicKey(account.publicKey);
    const jupHeaders = jupKey ? { "x-api-key": jupKey } : {};

    // Fetch all SPL token accounts (standard SPL token program)
    let tokenAccounts: Array<{ mint: string; amount: number; decimals: number }> = [];
    try {
      const resp = await connection.getParsedTokenAccountsByOwner(pubkey, { programId: new PublicKey(TOKEN_PROGRAM_ID_STR) });
      for (const item of resp.value) {
        const info = (item.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number; amount?: string; decimals?: number } } } }).parsed?.info;
        if (!info) continue;
        const uiAmount = info.tokenAmount?.uiAmount ?? 0;
        const rawAmount = Number(info.tokenAmount?.amount ?? 0);
        if (rawAmount <= 0 || uiAmount <= 0) continue;
        tokenAccounts.push({
          mint: info.mint ?? "",
          amount: rawAmount,
          decimals: info.tokenAmount?.decimals ?? 0,
        });
      }
    } catch (err) {
      log(`[${account.name}] Token scan error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Filter out empty/invalid mints
    tokenAccounts = tokenAccounts.filter(t => t.mint && t.amount > 0);
    log(`[${account.name}] Found ${tokenAccounts.length} token(s)`);

    for (const token of tokenAccounts) {
      const tokenResult: WalletTokenSellResult["tokens"][number] = {
        mint: token.mint,
        rawAmount: token.amount,
      };

      try {
        // Check if Jupiter can quote this token → SOL
        const quoteUrl = `${JUPITER_BASE}/quote?inputMint=${token.mint}&outputMint=${WSOL}&amount=${token.amount}&slippageBps=${slippageBps}&swapMode=ExactIn`;
        const quoteRes = await jupFetch(quoteUrl, { headers: jupHeaders });
        const quote = await quoteRes.json() as Record<string, unknown>;

        if ((quote as { error?: string }).error) {
          tokenResult.skipped = true;
          tokenResult.skipReason = `Not tradable on Jupiter: ${(quote as { error?: string }).error}`;
          log(`[${account.name}] ${token.mint.slice(0, 8)}... skipped: ${tokenResult.skipReason}`);
          walletResult.tokens.push(tokenResult);
          await sleep(300);
          continue;
        }

        const estimatedSol = Number((quote as { outAmount?: string }).outAmount ?? 0) / 1e9;
        if (estimatedSol < MIN_SELL_SOL) {
          tokenResult.skipped = true;
          tokenResult.skipReason = `Dust (<${MIN_SELL_SOL} SOL estimated)`;
          log(`[${account.name}] ${token.mint.slice(0, 8)}... skipped: dust`);
          walletResult.tokens.push(tokenResult);
          await sleep(300);
          continue;
        }

        // Execute swap
        const swapRes = await jupFetch(`${JUPITER_BASE}/swap`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...jupHeaders },
          body: JSON.stringify({
            quoteResponse: quote,
            userPublicKey: keypair.publicKey.toBase58(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            dynamicSlippage: true,
          }),
        });
        const swapData = await swapRes.json() as { swapTransaction?: string; error?: string };
        if (!swapData.swapTransaction) throw new Error(swapData.error ?? "No swapTransaction returned");

        const tx = VersionedTransaction.deserialize(Buffer.from(swapData.swapTransaction, "base64"));
        tx.sign([keypair]);

        let sig = "";
        // Try Jito first, fall back to RPC
        try {
          const jitoRes = await fetch("https://mainnet.block-engine.jito.labs.io/api/v1/bundles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[Buffer.from(tx.serialize()).toString("base64")]] }),
          });
          const jitoData = await jitoRes.json() as { result?: string; error?: unknown };
          if (jitoData.result) sig = jitoData.result;
        } catch { /* fall through to RPC */ }

        if (!sig) {
          sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
        }

        tokenResult.txSignature = sig;
        tokenResult.solReceived = estimatedSol;
        log(`[${account.name}] Sold ${token.mint.slice(0, 8)}... → ~${estimatedSol.toFixed(4)} SOL | tx: ${sig.slice(0, 12)}...`);
      } catch (err) {
        tokenResult.error = err instanceof Error ? err.message : String(err);
        log(`[${account.name}] ${token.mint.slice(0, 8)}... SELL FAILED: ${tokenResult.error}`);
      }

      walletResult.tokens.push(tokenResult);
      await sleep(500); // Space out sells
    }

    results.push(walletResult);
    await sleep(300);
  }

  return results;
}
