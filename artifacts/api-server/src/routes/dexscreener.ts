import { Router } from "express";

const router = Router();
const DS_BASE = "https://api.dexscreener.com";

async function proxyDs(path: string) {
  const r = await fetch(`${DS_BASE}${path}`, {
    signal: AbortSignal.timeout(10000),
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`DexScreener ${r.status}`);
  return r.json();
}

// GET /dexscreener/profiles — latest token profiles (Solana filtered)
router.get("/dexscreener/profiles", async (_req, res) => {
  try {
    const data = await proxyDs("/token-profiles/latest/v1") as Array<{ chainId: string }>;
    res.json(Array.isArray(data) ? data.filter(t => t.chainId === "solana") : []);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// GET /dexscreener/boosts/latest — latest boosted tokens (Solana filtered)
router.get("/dexscreener/boosts/latest", async (_req, res) => {
  try {
    const data = await proxyDs("/token-boosts/latest/v1") as Array<{ chainId: string }>;
    res.json(Array.isArray(data) ? data.filter(t => t.chainId === "solana") : []);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// GET /dexscreener/boosts/top — top boosted tokens (Solana filtered)
router.get("/dexscreener/boosts/top", async (_req, res) => {
  try {
    const data = await proxyDs("/token-boosts/top/v1") as Array<{ chainId: string }>;
    res.json(Array.isArray(data) ? data.filter(t => t.chainId === "solana") : []);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// GET /dexscreener/cto — community takeovers (Solana filtered)
router.get("/dexscreener/cto", async (_req, res) => {
  try {
    const data = await proxyDs("/community-takeovers/latest/v1") as Array<{ chainId: string }>;
    res.json(Array.isArray(data) ? data.filter(t => t.chainId === "solana") : []);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// GET /dexscreener/pairs/:tokenAddress — pair data for a token
router.get("/dexscreener/pairs/:tokenAddress", async (req, res) => {
  try {
    const data = await proxyDs(`/latest/dex/tokens/${req.params.tokenAddress}`);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

export { router as dexscreenerRouter };
