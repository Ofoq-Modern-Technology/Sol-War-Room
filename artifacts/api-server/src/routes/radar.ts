import { Router } from "express";
import { db, tokenRadarTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  getRadarTokens,
  startGlobalRadar,
  stopGlobalRadar,
  restartGlobalRadar,
  getRadarRunningStatus,
  type WatchMode,
} from "../lib/token-radar.js";

const router = Router();

// GET /radar/tokens?limit=200&offset=0&filter=all|graduation|pumpfun|raydium
router.get("/radar/tokens", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200), 500);
  const offset = Number(req.query.offset ?? 0);
  const filter = (req.query.filter as string) || "all";

  const tokens = await getRadarTokens(limit, offset, filter as "all" | "graduation" | "pumpfun" | "raydium" | "dexscreener");
  res.json(tokens.map(t => ({
    ...t,
    detectedAt: t.detectedAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
  })));
});

// DELETE /radar/tokens/:id
router.delete("/radar/tokens/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  await db.delete(tokenRadarTable).where(eq(tokenRadarTable.id, id));
  res.json({ ok: true });
});

// DELETE /radar/tokens — clear all
router.delete("/radar/tokens", async (_req, res) => {
  await db.delete(tokenRadarTable);
  res.json({ ok: true });
});

// POST /radar/start — start with optional watchMode
router.post("/radar/start", async (req, res) => {
  const watchMode = (req.body?.watchMode as WatchMode) || "all";
  const result = await startGlobalRadar(watchMode);
  if (!result.started) {
    res.status(400).json({ error: result.error ?? "Failed to start radar" });
    return;
  }
  const status = getRadarRunningStatus();
  res.json({ ok: true, message: `Radar started (mode=${status.watchMode})`, ...status });
});

// POST /radar/stop
router.post("/radar/stop", async (_req, res) => {
  stopGlobalRadar();
  res.json({ ok: true, message: "Radar stopped", isRunning: false, watchMode: getRadarRunningStatus().watchMode });
});

// POST /radar/restart — restart with optional watchMode
router.post("/radar/restart", async (req, res) => {
  const watchMode = (req.body?.watchMode as WatchMode) || undefined;
  const result = await restartGlobalRadar(watchMode);
  if (!result.started) {
    res.status(400).json({ error: result.error ?? "Failed to restart radar" });
    return;
  }
  const status = getRadarRunningStatus();
  res.json({ ok: true, message: `Radar restarted (mode=${status.watchMode})`, ...status });
});

// GET /radar/status
router.get("/radar/status", async (_req, res) => {
  const rows = await db.select({ id: tokenRadarTable.id }).from(tokenRadarTable);
  const status = getRadarRunningStatus();
  res.json({ totalTokens: rows.length, ...status });
});

export { router as radarRouter };
