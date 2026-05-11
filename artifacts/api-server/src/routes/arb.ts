import { Router, type IRouter } from "express";
import { db, arbConfigsTable, arbLogsTable, accountsTable, walletsTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { scheduleArbJob, stopArbJob, activeArbJobs } from "../lib/arb-engine.js";

const router: IRouter = Router();

const DEFAULT_TARGET_DEXES = ["Raydium", "Raydium CLMM", "Orca", "Whirlpool", "Meteora DLMM", "Pump.fun AMM"];

const CreateArbConfigBody = z.object({
  name: z.string().min(1),
  accountId: z.number().int().positive(),
  mintAddress: z.string().min(32),
  tokenSymbol: z.string().optional(),
  inputAmountSol: z.number().positive(),
  minProfitSol: z.number().min(0).default(0.001),
  jitoTipLamports: z.number().int().min(0).default(10000),
  scanIntervalMs: z.number().int().min(1000).default(5000),
  slippageBps: z.number().int().min(1).default(100),
  targetDexes: z.array(z.string()).optional(),
});

const StartArbBody = z.object({
  password: z.string().min(1),
});

function parseTargetDexes(raw: string | null | undefined): string[] {
  try { return JSON.parse(raw ?? "null") ?? DEFAULT_TARGET_DEXES; }
  catch { return DEFAULT_TARGET_DEXES; }
}

async function enrichConfig(cfg: typeof arbConfigsTable.$inferSelect) {
  const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, cfg.accountId));
  const wallets = await db.select().from(walletsTable);
  const walletMap = new Map(wallets.map((w) => [w.id, w.name]));
  return {
    ...cfg,
    targetDexes: parseTargetDexes(cfg.targetDexes) as unknown as string,
    accountName: account?.name ?? null,
    publicKey: account?.publicKey ?? null,
    walletName: account ? (walletMap.get(account.walletId) ?? null) : null,
    isRunning: activeArbJobs.has(cfg.id),
  };
}

// GET /arb/configs
router.get("/arb/configs", async (_req, res) => {
  const configs = await db.select().from(arbConfigsTable).orderBy(desc(arbConfigsTable.createdAt));
  const enriched = await Promise.all(configs.map(enrichConfig));
  res.json(enriched);
});

// POST /arb/configs
router.post("/arb/configs", async (req, res) => {
  const body = CreateArbConfigBody.parse(req.body);
  const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, body.accountId));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const [cfg] = await db.insert(arbConfigsTable).values({
    ...body,
    targetDexes: JSON.stringify(body.targetDexes ?? DEFAULT_TARGET_DEXES),
    status: "idle",
    totalArbs: 0,
    totalProfitSol: 0,
  }).returning();
  res.status(201).json(await enrichConfig(cfg));
});

// DELETE /arb/configs/:id
router.delete("/arb/configs/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  stopArbJob(id);
  await db.delete(arbLogsTable).where(eq(arbLogsTable.configId, id));
  await db.delete(arbConfigsTable).where(eq(arbConfigsTable.id, id));
  res.json({ success: true });
});

// POST /arb/configs/:id/start
router.post("/arb/configs/:id/start", async (req, res) => {
  const id = parseInt(req.params.id);
  const { password } = StartArbBody.parse(req.body);

  const [cfg] = await db.select().from(arbConfigsTable).where(eq(arbConfigsTable.id, id));
  if (!cfg) { res.status(404).json({ error: "Config not found" }); return; }

  if (activeArbJobs.has(id)) {
    res.json(await enrichConfig(cfg));
    return;
  }

  await db.update(arbConfigsTable).set({
    status: "running",
    startedAt: new Date(),
    stoppedAt: null,
  }).where(eq(arbConfigsTable.id, id));

  scheduleArbJob(id, password, cfg.scanIntervalMs);

  const [updated] = await db.select().from(arbConfigsTable).where(eq(arbConfigsTable.id, id));
  res.json(await enrichConfig(updated));
});

// POST /arb/configs/:id/stop
router.post("/arb/configs/:id/stop", async (req, res) => {
  const id = parseInt(req.params.id);
  stopArbJob(id);
  await db.update(arbConfigsTable).set({
    status: "idle",
    stoppedAt: new Date(),
  }).where(eq(arbConfigsTable.id, id));
  const [cfg] = await db.select().from(arbConfigsTable).where(eq(arbConfigsTable.id, id));
  res.json(await enrichConfig(cfg));
});

// GET /arb/configs/:id/logs
router.get("/arb/configs/:id/logs", async (req, res) => {
  const id = parseInt(req.params.id);
  const limit = parseInt(req.query.limit as string ?? "100");
  const logs = await db
    .select()
    .from(arbLogsTable)
    .where(eq(arbLogsTable.configId, id))
    .orderBy(desc(arbLogsTable.createdAt))
    .limit(Math.min(limit, 200));
  res.json(logs);
});

export default router;
