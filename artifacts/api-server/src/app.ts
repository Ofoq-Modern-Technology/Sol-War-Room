import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import path from "path";
import { ZodError } from "zod";
import router from "./routes";
import { authGuard } from "./middleware/authGuard.js";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── In production: serve the built Vite frontend ──────────────────────────────
// public/ must sit next to server.cjs in the release folder.
// process.cwd() points to the directory where `node server.cjs` is invoked.
if (process.env.NODE_ENV === "production") {
  const publicDir = path.join(process.cwd(), "public");
  app.use(express.static(publicDir));
}

// ── Auth guard (only gates /api/* routes) ─────────────────────────────────────
app.use(authGuard);

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── SPA fallback (production) — serve index.html for any non-API route ────────
if (process.env.NODE_ENV === "production") {
  const publicDir = path.join(process.cwd(), "public");
  app.use((_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

// ── Global error handler ───────────────────────────────────────────────────────
// Catches thrown errors from route handlers (including async throws in Express 5)
// and returns clean JSON instead of Express's default HTML error page.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.issues });
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error("[error]", err);
  res.status(500).json({ error: message });
});

export default app;
