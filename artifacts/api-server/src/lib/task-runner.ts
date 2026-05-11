import { db, tasksTable, accountsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { decrypt } from "./crypto.js";
import { getSettings } from "./settingsStore.js";
import type { Task } from "@workspace/db";

const WSOL = "So11111111111111111111111111111111111111112";
const POLL_MS = 5_000;

let runnerInterval: ReturnType<typeof setInterval> | null = null;

// ─── Price fetch (Jupiter Price API v2) ─────────────────────────────────────
async function getTokenPriceUsd(mint: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const data = await r.json() as { data?: Record<string, { price?: string }> };
    const price = data.data?.[mint]?.price;
    return price ? parseFloat(price) : null;
  } catch {
    return null;
  }
}

// ─── Token balance fetch ─────────────────────────────────────────────────────
async function getTokenBalance(publicKey: string, mint: string, rpc: string): Promise<number> {
  try {
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "getTokenAccountsByOwner",
        params: [publicKey, { mint }, { encoding: "jsonParsed" }],
      }),
    });
    const data = await r.json() as { result?: { value?: Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null; amount: string } } } } } }> } };
    const vals = data.result?.value ?? [];
    if (vals.length === 0) return 0;
    return vals[0].account.data.parsed.info.tokenAmount.uiAmount ?? 0;
  } catch {
    return 0;
  }
}

async function getTokenRawBalance(publicKey: string, mint: string, rpc: string): Promise<{ amount: string; decimals: number } | null> {
  try {
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "getTokenAccountsByOwner",
        params: [publicKey, { mint }, { encoding: "jsonParsed" }],
      }),
    });
    const data = await r.json() as { result?: { value?: Array<{ account: { data: { parsed: { info: { tokenAmount: { amount: string; decimals: number; uiAmount: number | null } } } } } }> } };
    const vals = data.result?.value ?? [];
    if (vals.length === 0) return null;
    const ta = vals[0].account.data.parsed.info.tokenAmount;
    return { amount: ta.amount, decimals: ta.decimals };
  } catch {
    return null;
  }
}

// ─── Jupiter swap helper ─────────────────────────────────────────────────────
async function doSwap(opts: {
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  slippageBps: number;
  privateKeyBase58: string;
  rpc: string;
  jupiterApiKey?: string;
}): Promise<{ txSignature: string } | { error: string }> {
  const { jupiterSwap } = await import("./solana.js");
  return jupiterSwap({
    inputMint: opts.inputMint,
    outputMint: opts.outputMint,
    amount: opts.amountLamports,
    slippageBps: opts.slippageBps,
    privateKeyBase58: opts.privateKeyBase58,
    rpcEndpoint: opts.rpc,
    useJito: false,
    jitoEndpoint: "https://mainnet.block-engine.jito.labs.io",
    jitoTipLamports: 0,
    jupiterApiKey: opts.jupiterApiKey,
  });
}

// ─── DCA buy task ─────────────────────────────────────────────────────────────
async function runDcaTask(task: Task): Promise<void> {
  if (!task.dcaAmountSol || !task.dcaIntervalSec || !task.dcaRoundsTotal) return;

  await db.update(tasksTable).set({ status: "running" }).where(eq(tasksTable.id, task.id));

  const settings = await getSettings();
  const rpc = settings.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
    : settings.rpcEndpoint ?? "https://api.mainnet-beta.solana.com";

  const accountIds: number[] = JSON.parse(task.accountIds);
  const accounts = await db.select().from(accountsTable).where(inArray(accountsTable.id, accountIds));

  const results: string[] = [];
  let anyOk = false;

  for (const acc of accounts) {
    let privateKeyBase58: string;
    try {
      privateKeyBase58 = decrypt(acc.encryptedPrivateKey, task.password);
    } catch {
      results.push(`${acc.publicKey.slice(0, 8)}: bad password`);
      continue;
    }

    const lamports = Math.round(task.dcaAmountSol * 1e9);
    const result = await doSwap({
      inputMint: WSOL,
      outputMint: task.mintAddress,
      amountLamports: lamports,
      slippageBps: task.slippageBps,
      privateKeyBase58,
      rpc,
      jupiterApiKey: settings.jupiterApiKey ?? undefined,
    });

    if ("txSignature" in result) {
      results.push(`${acc.publicKey.slice(0, 8)}: ✓ ${result.txSignature.slice(0, 12)}…`);
      anyOk = true;
    } else {
      results.push(`${acc.publicKey.slice(0, 8)}: ✗ ${result.error}`);
    }
  }

  const roundsDone = (task.dcaRoundsDone ?? 0) + 1;
  const isDone = roundsDone >= task.dcaRoundsTotal;
  const nextRunAt = isDone ? null : Date.now() + task.dcaIntervalSec * 1000;

  await db.update(tasksTable).set({
    status: isDone ? "completed" : "pending",
    dcaRoundsDone: roundsDone,
    nextRunAt,
    lastRunAt: Date.now(),
    lastResult: JSON.stringify({ round: roundsDone, results, anyOk }),
    completedAt: isDone ? new Date() : null,
    errorMessage: anyOk ? null : "All accounts failed",
  }).where(eq(tasksTable.id, task.id));

  console.log(`[tasks] DCA #${task.id} round ${roundsDone}/${task.dcaRoundsTotal} — ${results.join(", ")}`);
}

// ─── Exit sell / limit buy task ───────────────────────────────────────────────
async function runExitTask(task: Task): Promise<void> {
  if (!task.triggerPriceUsd || !task.triggerCondition) return;

  const price = await getTokenPriceUsd(task.mintAddress);
  if (price === null) {
    console.log(`[tasks] exit #${task.id}: couldn't fetch price`);
    return;
  }

  const triggered =
    task.triggerCondition === "above" ? price >= task.triggerPriceUsd :
    task.triggerCondition === "below" ? price <= task.triggerPriceUsd :
    false;

  if (!triggered) {
    await db.update(tasksTable).set({
      lastRunAt: Date.now(),
      lastResult: JSON.stringify({ priceUsd: price, triggered: false }),
    }).where(eq(tasksTable.id, task.id));
    return;
  }

  await db.update(tasksTable).set({ status: "running" }).where(eq(tasksTable.id, task.id));

  const settings = await getSettings();
  const rpc = settings.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
    : settings.rpcEndpoint ?? "https://api.mainnet-beta.solana.com";

  const accountIds: number[] = JSON.parse(task.accountIds);
  const accounts = await db.select().from(accountsTable).where(inArray(accountsTable.id, accountIds));

  const sellPct = task.sellPct ?? 100;
  const results: string[] = [];
  let anyOk = false;

  for (const acc of accounts) {
    let privateKeyBase58: string;
    try {
      privateKeyBase58 = decrypt(acc.encryptedPrivateKey, task.password);
    } catch {
      results.push(`${acc.publicKey.slice(0, 8)}: bad password`);
      continue;
    }

    if (task.type === "exit_sell") {
      const bal = await getTokenRawBalance(acc.publicKey, task.mintAddress, rpc);
      if (!bal || bal.amount === "0") {
        results.push(`${acc.publicKey.slice(0, 8)}: no balance`);
        continue;
      }
      const rawAmount = Math.floor(Number(bal.amount) * sellPct / 100).toString();
      const result = await doSwap({
        inputMint: task.mintAddress,
        outputMint: WSOL,
        amountLamports: Number(rawAmount),
        slippageBps: task.slippageBps,
        privateKeyBase58,
        rpc,
        jupiterApiKey: settings.jupiterApiKey ?? undefined,
      });
      if ("txSignature" in result) {
        results.push(`${acc.publicKey.slice(0, 8)}: ✓ sold ${sellPct}%`);
        anyOk = true;
      } else {
        results.push(`${acc.publicKey.slice(0, 8)}: ✗ ${result.error}`);
      }
    } else if (task.type === "limit_buy") {
      const lamports = Math.round((task.dcaAmountSol ?? 0.1) * 1e9);
      const result = await doSwap({
        inputMint: WSOL,
        outputMint: task.mintAddress,
        amountLamports: lamports,
        slippageBps: task.slippageBps,
        privateKeyBase58,
        rpc,
        jupiterApiKey: settings.jupiterApiKey ?? undefined,
      });
      if ("txSignature" in result) {
        results.push(`${acc.publicKey.slice(0, 8)}: ✓ bought`);
        anyOk = true;
      } else {
        results.push(`${acc.publicKey.slice(0, 8)}: ✗ ${result.error}`);
      }
    }
  }

  await db.update(tasksTable).set({
    status: "completed",
    lastRunAt: Date.now(),
    lastResult: JSON.stringify({ priceUsd: price, triggered: true, results, anyOk }),
    completedAt: new Date(),
    errorMessage: anyOk ? null : "Triggered but all accounts failed",
  }).where(eq(tasksTable.id, task.id));

  console.log(`[tasks] exit #${task.id} triggered @ $${price.toFixed(6)} — ${results.join(", ")}`);
}

// ─── Main poll loop ───────────────────────────────────────────────────────────
async function tick(): Promise<void> {
  try {
    const tasks = await db.select().from(tasksTable);
    const now = Date.now();

    for (const task of tasks) {
      if (task.status === "completed" || task.status === "cancelled" || task.status === "failed") continue;
      if (task.status === "running") continue; // already executing

      if (task.type === "dca_buy") {
        const nextRun = task.nextRunAt ?? now; // first run immediately
        if (now >= nextRun) {
          void runDcaTask(task).catch(e => {
            console.error(`[tasks] DCA #${task.id} error:`, e);
            void db.update(tasksTable).set({ status: "failed", errorMessage: String(e) }).where(eq(tasksTable.id, task.id));
          });
        }
      } else if (task.type === "exit_sell" || task.type === "limit_buy") {
        void runExitTask(task).catch(e => {
          console.error(`[tasks] exit/limit #${task.id} error:`, e);
        });
      }
    }
  } catch (e) {
    console.error("[tasks] tick error:", e);
  }
}

export function startTaskRunner(): void {
  if (runnerInterval) return;
  runnerInterval = setInterval(() => { void tick(); }, POLL_MS);
  void tick(); // run immediately on start
  console.log("[tasks] Task runner started (5s poll)");
}

export function stopTaskRunner(): void {
  if (runnerInterval) {
    clearInterval(runnerInterval);
    runnerInterval = null;
  }
}
