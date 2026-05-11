import { Router, type IRouter } from "express";
import { db, tasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

const CreateTaskBody = z.object({
  type: z.enum(["dca_buy", "exit_sell", "limit_buy"]),
  label: z.string().min(1),
  mintAddress: z.string().min(32),
  accountIds: z.array(z.number()).min(1),
  password: z.string().min(1),
  slippageBps: z.number().int().min(1).max(5000).default(1500),
  // DCA
  dcaAmountSol: z.number().positive().optional(),
  dcaIntervalSec: z.number().int().positive().optional(),
  dcaRoundsTotal: z.number().int().positive().optional(),
  // Exit / Limit
  triggerPriceUsd: z.number().positive().optional(),
  triggerCondition: z.enum(["above", "below"]).optional(),
  sellPct: z.number().min(1).max(100).optional(),
});

router.get("/tasks", async (_req, res) => {
  const tasks = await db.select().from(tasksTable).orderBy(tasksTable.createdAt);
  res.json(tasks.map(t => ({ ...t, password: undefined })));
});

router.post("/tasks", async (req, res) => {
  const body = CreateTaskBody.parse(req.body);

  if (body.type === "dca_buy") {
    if (!body.dcaAmountSol || !body.dcaIntervalSec || !body.dcaRoundsTotal) {
      res.status(400).json({ error: "DCA tasks require dcaAmountSol, dcaIntervalSec, dcaRoundsTotal" });
      return;
    }
  }
  if (body.type === "exit_sell" || body.type === "limit_buy") {
    if (!body.triggerPriceUsd || !body.triggerCondition) {
      res.status(400).json({ error: "Exit/limit tasks require triggerPriceUsd and triggerCondition" });
      return;
    }
    if (body.type === "exit_sell" && !body.sellPct) {
      res.status(400).json({ error: "exit_sell requires sellPct" });
      return;
    }
    if (body.type === "limit_buy" && !body.dcaAmountSol) {
      res.status(400).json({ error: "limit_buy requires dcaAmountSol (buy amount in SOL)" });
      return;
    }
  }

  const [task] = await db.insert(tasksTable).values({
    type: body.type,
    label: body.label,
    mintAddress: body.mintAddress,
    accountIds: JSON.stringify(body.accountIds),
    password: body.password,
    slippageBps: body.slippageBps,
    dcaAmountSol: body.dcaAmountSol ?? null,
    dcaIntervalSec: body.dcaIntervalSec ?? null,
    dcaRoundsTotal: body.dcaRoundsTotal ?? null,
    triggerPriceUsd: body.triggerPriceUsd ?? null,
    triggerCondition: body.triggerCondition ?? null,
    sellPct: body.sellPct ?? null,
    nextRunAt: null,
  }).returning();

  res.status(201).json({ ...task, password: undefined });
});

router.delete("/tasks/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  res.json({ success: true });
});

router.post("/tasks/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [t] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!t) { res.status(404).json({ error: "Task not found" }); return; }
  if (t.status === "completed" || t.status === "failed") {
    res.status(400).json({ error: "Task already finished" }); return;
  }
  await db.update(tasksTable).set({ status: "cancelled" }).where(eq(tasksTable.id, id));
  res.json({ success: true });
});

export default router;
