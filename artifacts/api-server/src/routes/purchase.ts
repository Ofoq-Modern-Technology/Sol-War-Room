import { Router } from "express";
import {
  LICENSE_PRODUCT_ID as BUILD_PRODUCT_ID,
  LICENSE_SERVER_URL as BUILD_SERVER_URL,
} from "../config.js";

const router = Router();

const LS_URL = (process.env.LICENSE_SERVER_URL ?? BUILD_SERVER_URL).replace(/\/$/, "");
const LICENSE_PRODUCT_ID = process.env.LICENSE_PRODUCT_ID ?? BUILD_PRODUCT_ID;

async function proxyToLS(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  try {
    const resp = await fetch(`${LS_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(10000),
    });
    const body = await resp.json();
    return { status: resp.status, body };
  } catch (e) {
    return { status: 502, body: { error: e instanceof Error ? e.message : "License server unavailable" } };
  }
}

// GET /api/purchase/products — list active products from license server
router.get("/products", async (_req, res) => {
  const { status, body } = await proxyToLS("/purchase/products");
  res.status(status).json(body);
});

// GET /api/purchase/pricing — inject productId from build config (or env override)
router.get("/pricing", async (_req, res) => {
  if (!LICENSE_PRODUCT_ID) {
    res.status(400).json({ error: "LICENSE_PRODUCT_ID not configured." });
    return;
  }
  const { status, body } = await proxyToLS(`/purchase/pricing?productId=${encodeURIComponent(LICENSE_PRODUCT_ID)}`);
  res.status(status).json(body);
});

// POST /api/purchase/init — inject productId from build config (or env override)
router.post("/init", async (req, res) => {
  if (!LICENSE_PRODUCT_ID) {
    res.status(400).json({ error: "LICENSE_PRODUCT_ID not configured." });
    return;
  }
  const { status, body } = await proxyToLS("/purchase/init", {
    method: "POST",
    body: JSON.stringify({ ...req.body, productId: LICENSE_PRODUCT_ID }),
  });
  res.status(status).json(body);
});

// GET /api/purchase/status/:id
router.get("/status/:id", async (req, res) => {
  const { status, body } = await proxyToLS(`/purchase/status/${req.params.id}`);
  res.status(status).json(body);
});

export default router;
