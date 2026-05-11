import { Router, type IRouter } from "express";
import { getTokenInfo } from "../lib/solana.js";
import { getSettings } from "../lib/settingsStore.js";
import { GetTokenInfoBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/tokens/info", async (req, res) => {
  const body = GetTokenInfoBody.parse(req.body);
  const settings = await getSettings();
  const info = await getTokenInfo(body.mintAddress, settings.heliusApiKey);
  res.json({ mintAddress: body.mintAddress, ...info });
});

export default router;
