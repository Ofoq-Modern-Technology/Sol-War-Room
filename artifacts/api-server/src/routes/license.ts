import { Router, type IRouter } from "express";
import { getLicenseStatus, activateLicense, deactivateLicense } from "../lib/licenseCheck.js";
import { z } from "zod";

const router: IRouter = Router();

router.get("/license/status", async (_req, res) => {
  const status = await getLicenseStatus();
  res.json(status);
});

router.post("/license/activate", async (req, res) => {
  const { licenseKey } = z.object({ licenseKey: z.string().min(10) }).parse(req.body);
  const result = await activateLicense(licenseKey);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true });
});

router.post("/license/deactivate", async (_req, res) => {
  await deactivateLicense();
  res.json({ success: true });
});

export default router;
