import { Router } from "express";
import { db, sniperConfigsTable, sniperTradesTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { startSniperEngine, stopSniperEngine, getSniperLogs, sellTradeById, sellAllBoughtTrades, scanAndSellWalletTokens } from "../lib/sniper-engine.js";

const router = Router();

function serializeConfig(row: typeof sniperConfigsTable.$inferSelect) {
  return {
    ...row,
    accountIds: JSON.parse(row.accountIds) as number[],
    targetDexes: JSON.parse(row.targetDexes) as string[],
    startedAt: row.startedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeTrade(row: typeof sniperTradesTable.$inferSelect) {
  return {
    ...row,
    detectedAt: row.detectedAt.toISOString(),
    boughtAt: row.boughtAt?.toISOString() ?? null,
    soldAt: row.soldAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /sniper/configs
router.get("/sniper/configs", async (_req, res) => {
  const rows = await db.select().from(sniperConfigsTable).orderBy(desc(sniperConfigsTable.createdAt));
  res.json(rows.map(serializeConfig));
});

// POST /sniper/configs
router.post("/sniper/configs", async (req, res) => {
  const { name, accountIds, solPerAccount, maxBuySlippageBps, minLiquiditySol, exitStrategy, exitTimerSeconds, exitMultiplier, useJito, jitoTipLamports, targetDexes, maxSnipesPerPool, enableSocialGate, enableCtoBuy } = req.body as {
    name: string;
    accountIds: number[];
    solPerAccount?: number;
    maxBuySlippageBps?: number;
    minLiquiditySol?: number;
    exitStrategy?: string;
    exitTimerSeconds?: number;
    exitMultiplier?: number;
    useJito?: boolean;
    jitoTipLamports?: number;
    targetDexes?: string[];
    maxSnipesPerPool?: number;
    enableSocialGate?: boolean;
    enableCtoBuy?: boolean;
  };

  if (!name || !accountIds?.length) {
    res.status(400).json({ error: "name and accountIds required" });
    return;
  }

  const dexes = targetDexes ?? [];
  if (dexes.length === 0 && !enableCtoBuy) {
    res.status(400).json({ error: "At least one target DEX must be selected, or enable CTO mode" });
    return;
  }

  const [row] = await db.insert(sniperConfigsTable).values({
    name,
    accountIds: JSON.stringify(accountIds),
    solPerAccount: solPerAccount ?? 0.1,
    maxBuySlippageBps: maxBuySlippageBps ?? 1500,
    minLiquiditySol: minLiquiditySol ?? 1.0,
    exitStrategy: exitStrategy ?? "timer",
    exitTimerSeconds: exitTimerSeconds ?? 300,
    exitMultiplier: exitMultiplier ?? 2.0,
    useJito: useJito !== false,
    jitoTipLamports: jitoTipLamports ?? 100000,
    targetDexes: JSON.stringify(dexes),
    maxSnipesPerPool: maxSnipesPerPool ?? 1,
    enableSocialGate: enableSocialGate === true,
    enableCtoBuy: enableCtoBuy === true,
  }).returning();

  res.status(201).json(serializeConfig(row));
});

// DELETE /sniper/configs/:id
router.delete("/sniper/configs/:id", async (req, res) => {
  const id = Number(req.params.id);
  await stopSniperEngine(id).catch(() => {});
  await db.delete(sniperConfigsTable).where(eq(sniperConfigsTable.id, id));
  res.status(204).end();
});

// POST /sniper/configs/:id/start
router.post("/sniper/configs/:id/start", async (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body as { password: string };
  if (!password) { res.status(400).json({ error: "password required" }); return; }
  try {
    await startSniperEngine(id, password);
    const [row] = await db.select().from(sniperConfigsTable).where(eq(sniperConfigsTable.id, id));
    res.json(serializeConfig(row));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// POST /sniper/configs/:id/stop
router.post("/sniper/configs/:id/stop", async (req, res) => {
  const id = Number(req.params.id);
  await stopSniperEngine(id);
  const [row] = await db.select().from(sniperConfigsTable).where(eq(sniperConfigsTable.id, id));
  res.json(serializeConfig(row));
});

// GET /sniper/configs/:id/trades
router.get("/sniper/configs/:id/trades", async (req, res) => {
  const id = Number(req.params.id);
  const limit = Number(req.query.limit ?? 50);
  const rows = await db
    .select()
    .from(sniperTradesTable)
    .where(eq(sniperTradesTable.configId, id))
    .orderBy(desc(sniperTradesTable.detectedAt))
    .limit(limit);
  res.json(rows.map(serializeTrade));
});

// GET /sniper/trades
router.get("/sniper/trades", async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  const rows = await db
    .select()
    .from(sniperTradesTable)
    .orderBy(desc(sniperTradesTable.detectedAt))
    .limit(limit);
  res.json(rows.map(serializeTrade));
});

// GET /sniper/configs/:id/logs
router.get("/sniper/configs/:id/logs", (req, res) => {
  const id = Number(req.params.id);
  const limit = Number(req.query.limit ?? 100);
  res.json(getSniperLogs(id, limit));
});

// POST /sniper/sell-all  — sell every "bought" position across all configs
router.post("/sniper/sell-all", async (req, res) => {
  const { password } = req.body as { password?: string };
  if (!password) { res.status(400).json({ error: "password required" }); return; }

  // Fire in background so the HTTP response returns quickly with a count
  const trades = await db
    .select({ id: sniperTradesTable.id })
    .from(sniperTradesTable)
    .where(eq(sniperTradesTable.status, "bought"));

  if (trades.length === 0) { res.json({ queued: 0, message: "No bought positions found" }); return; }

  // Kick off async — client gets immediate response
  void sellAllBoughtTrades(password);
  res.json({ queued: trades.length, message: `Selling ${trades.length} position(s)` });
});

// POST /sniper/trades/:id/sell  — sell a single position (waits for result)
router.post("/sniper/trades/:id/sell", async (req, res) => {
  const tradeId = Number(req.params.id);
  const { password } = req.body as { password?: string };
  if (!password) { res.status(400).json({ error: "password required" }); return; }

  const result = await sellTradeById(tradeId, password);
  if (!result.ok) {
    res.status(400).json({ error: result.error ?? "sell failed" });
    return;
  }

  const [updated] = await db.select().from(sniperTradesTable).where(eq(sniperTradesTable.id, tradeId));
  res.json(updated ? serializeTrade(updated) : result);
});

// POST /sniper/kill-switch — stop all bots, clear pending, sell all bought positions
router.post("/sniper/kill-switch", async (req, res) => {
  const { password } = req.body as { password?: string };
  if (!password) { res.status(400).json({ error: "password required" }); return; }

  // 1. Stop all running configs
  const runningConfigs = await db
    .select({ id: sniperConfigsTable.id })
    .from(sniperConfigsTable)
    .where(eq(sniperConfigsTable.status, "running"));

  await Promise.allSettled(runningConfigs.map(c => stopSniperEngine(c.id)));

  // 2. Mark all pending trades as failed (can't sell in-flight txs — just remove from view)
  const pendingIds = await db
    .select({ id: sniperTradesTable.id })
    .from(sniperTradesTable)
    .where(eq(sniperTradesTable.status, "pending"));

  if (pendingIds.length > 0) {
    await db
      .update(sniperTradesTable)
      .set({ status: "failed", error: "killed by kill-switch" })
      .where(inArray(sniperTradesTable.id, pendingIds.map(t => t.id)));
  }

  // 3. Count bought positions and fire sells in background
  const boughtTrades = await db
    .select({ id: sniperTradesTable.id })
    .from(sniperTradesTable)
    .where(eq(sniperTradesTable.status, "bought"));

  void sellAllBoughtTrades(password);

  res.json({
    stopped: runningConfigs.length,
    pendingCleared: pendingIds.length,
    sellQueued: boughtTrades.length,
    message: `Stopped ${runningConfigs.length} bots · Cleared ${pendingIds.length} pending · Selling ${boughtTrades.length} positions`,
  });
});

// POST /sniper/scan-and-sell — scan all wallet token balances and sell them (recovery)
router.post("/sniper/scan-and-sell", async (req, res) => {
  const { password, accountIds, slippageBps } = req.body as {
    password?: string;
    accountIds?: number[];
    slippageBps?: number;
  };
  if (!password) { res.status(400).json({ error: "password required" }); return; }

  // If no accountIds specified, use all accounts
  let ids = accountIds;
  if (!ids || ids.length === 0) {
    const { accountsTable } = await import("@workspace/db");
    const all = await db.select({ id: accountsTable.id }).from(accountsTable);
    ids = all.map(a => a.id);
  }

  if (ids.length === 0) { res.status(400).json({ error: "No accounts found" }); return; }

  const logs: string[] = [];
  const log = (msg: string) => { console.log(`[scan-sell] ${msg}`); logs.push(msg); };

  const results = await scanAndSellWalletTokens(ids, password, slippageBps ?? 2000, log);
  res.json({ results, logs });
});

export { router as sniperRouter };
