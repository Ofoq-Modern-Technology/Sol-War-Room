import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSettings, invalidateSettingsCache } from "../lib/settingsStore.js";
import { UpdateSettingsBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/settings", async (_req, res) => {
  const settings = await getSettings();
  res.json({
    rpcEndpoint: settings.rpcEndpoint,
    heliusApiKey: settings.heliusApiKey ?? null,
    jupiterApiKey: settings.jupiterApiKey ?? null,
    jitoEndpoint: settings.jitoEndpoint,
    defaultSlippageBps: settings.defaultSlippageBps,
    defaultJitoTipLamports: settings.defaultJitoTipLamports,
    defaultDelayMs: settings.defaultDelayMs,
  });
});

router.put("/settings", async (req, res) => {
  const body = UpdateSettingsBody.parse(req.body);
  const existing = await getSettings();

  const [updated] = await db
    .update(settingsTable)
    .set({
      rpcEndpoint: body.rpcEndpoint ?? existing.rpcEndpoint,
      heliusApiKey: body.heliusApiKey !== undefined ? body.heliusApiKey : existing.heliusApiKey,
      jupiterApiKey: body.jupiterApiKey !== undefined ? body.jupiterApiKey : existing.jupiterApiKey,
      jitoEndpoint: body.jitoEndpoint ?? existing.jitoEndpoint,
      defaultSlippageBps: body.defaultSlippageBps ?? existing.defaultSlippageBps,
      defaultJitoTipLamports: body.defaultJitoTipLamports ?? existing.defaultJitoTipLamports,
      defaultDelayMs: body.defaultDelayMs ?? existing.defaultDelayMs,
    })
    .where(eq(settingsTable.id, existing.id))
    .returning();

  invalidateSettingsCache();

  res.json({
    rpcEndpoint: updated.rpcEndpoint,
    heliusApiKey: updated.heliusApiKey ?? null,
    jupiterApiKey: updated.jupiterApiKey ?? null,
    jitoEndpoint: updated.jitoEndpoint,
    defaultSlippageBps: updated.defaultSlippageBps,
    defaultJitoTipLamports: updated.defaultJitoTipLamports,
    defaultDelayMs: updated.defaultDelayMs,
    licenseProductId: updated.licenseProductId ?? null,
  });
});

export default router;
