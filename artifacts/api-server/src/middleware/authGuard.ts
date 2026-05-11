import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../lib/jwtSecret.js";

const PUBLIC = new Set([
  "/api/auth/check-setup",
  "/api/auth/setup",
  "/api/auth/login",
  "/api/health",
  "/api/license/status",
  "/api/license/activate",
]);

// Only gate /api routes — static files and SPA routes pass through
const isApiRoute = (path: string) => path.startsWith("/api/");

// Prefix-based public routes (e.g. /api/purchase/*)
const PUBLIC_PREFIXES = ["/api/purchase/"];

export async function authGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!isApiRoute(req.path)) { next(); return; }
  if (PUBLIC.has(req.path)) { next(); return; }
  if (PUBLIC_PREFIXES.some((p) => req.path.startsWith(p))) { next(); return; }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const secret = await getJwtSecret();
    jwt.verify(token, secret);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
