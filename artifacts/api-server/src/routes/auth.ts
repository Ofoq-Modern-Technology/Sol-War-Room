import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, authTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getJwtSecret } from "../lib/jwtSecret.js";
import { z } from "zod";

const router: IRouter = Router();

const TOKEN_TTL = "24h";

router.get("/auth/check-setup", async (_req, res) => {
  const [row] = await db.select({ id: authTable.id }).from(authTable);
  res.json({ configured: !!row });
});

router.post("/auth/setup", async (req, res) => {
  const [existing] = await db.select({ id: authTable.id }).from(authTable);
  if (existing) {
    res.status(400).json({ error: "Already configured. Use login instead." });
    return;
  }

  const body = z.object({
    username: z.string().min(3).max(32),
    password: z.string().min(8),
  }).parse(req.body);

  const passwordHash = await bcrypt.hash(body.password, 12);
  await db.insert(authTable).values({ username: body.username, passwordHash });

  const secret = await getJwtSecret();
  const token = jwt.sign({ username: body.username }, secret, { expiresIn: TOKEN_TTL });

  res.status(201).json({ token, username: body.username });
});

router.post("/auth/login", async (req, res) => {
  const body = z.object({
    username: z.string(),
    password: z.string(),
  }).parse(req.body);

  const [row] = await db.select().from(authTable).where(eq(authTable.username, body.username));
  if (!row) {
    await bcrypt.compare("dummy", "$2a$12$dummy.hash.to.prevent.timing.attacks.xxxxx"); // timing-safe
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(body.password, row.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const secret = await getJwtSecret();
  const token = jwt.sign({ username: row.username }, secret, { expiresIn: TOKEN_TTL });

  res.json({ token, username: row.username });
});

router.post("/auth/change-password", async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }

  let username: string;
  try {
    const secret = await getJwtSecret();
    const payload = jwt.verify(token, secret) as { username: string };
    username = payload.username;
  } catch {
    res.status(401).json({ error: "Invalid token" }); return;
  }

  const body = z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(8),
  }).parse(req.body);

  const [row] = await db.select().from(authTable).where(eq(authTable.username, username));
  if (!row) { res.status(404).json({ error: "User not found" }); return; }

  const valid = await bcrypt.compare(body.currentPassword, row.passwordHash);
  if (!valid) { res.status(401).json({ error: "Current password incorrect" }); return; }

  const passwordHash = await bcrypt.hash(body.newPassword, 12);
  await db.update(authTable).set({ passwordHash }).where(eq(authTable.username, username));

  res.json({ success: true });
});

export default router;
