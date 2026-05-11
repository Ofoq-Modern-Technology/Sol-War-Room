import { Router, type IRouter } from "express";
import { db, accountsTable, volumeJobsTable, transactionsTable, walletsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { decrypt } from "../lib/crypto.js";
import { jupiterSwap, getTokenInfo } from "../lib/solana.js";
import { getSettings } from "../lib/settingsStore.js";
import { StartVolumeJobBody, StopVolumeJobParams } from "@workspace/api-zod";

const router: IRouter = Router();

const SOL_MINT = "So11111111111111111111111111111111111111112";

// In-memory registry of running job timers
const activeJobs = new Map<number, NodeJS.Timeout>();

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runVolumeIteration(jobId: number, password: string) {
  const [job] = await db.select().from(volumeJobsTable).where(eq(volumeJobsTable.id, jobId));
  if (!job || job.status !== "running") return;

  const now = new Date();
  if (job.endsAt && now >= job.endsAt) {
    await db.update(volumeJobsTable).set({ status: "completed", stoppedAt: new Date() }).where(eq(volumeJobsTable.id, jobId));
    activeJobs.delete(jobId);
    return;
  }

  const settings = await getSettings();
  const rpcEndpoint = settings.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
    : settings.rpcEndpoint;

  const accountIds = JSON.parse(job.accountIds) as number[];
  if (accountIds.length === 0) return;

  const accounts = await db.select().from(accountsTable).where(inArray(accountsTable.id, accountIds));
  if (accounts.length === 0) return;

  const pattern = job.pattern;
  let buyerAccount = accounts[Math.floor(Math.random() * accounts.length)];
  let sellerAccount = accounts[Math.floor(Math.random() * accounts.length)];

  if (pattern === "wash") {
    buyerAccount = accounts[Math.floor(Math.random() * accounts.length)];
    sellerAccount = buyerAccount;
  } else if (pattern === "ladder") {
    // Pick accounts in order
    const idx = job.totalTrades % accounts.length;
    buyerAccount = accounts[idx];
    sellerAccount = accounts[(idx + 1) % accounts.length];
  }

  const amountSol = randomBetween(job.minAmountSol, job.maxAmountSol);
  const amountLamports = Math.floor(amountSol * 1e9);

  let successCount = 0;
  let failCount = 0;
  let volumeAdded = 0;

  // Buy
  let buyPrivKey: string;
  try {
    buyPrivKey = decrypt(buyerAccount.encryptedPrivateKey, password);
  } catch {
    failCount++;
    await updateJobStats(jobId, 0, failCount, 0);
    return;
  }

  const buyResult = await jupiterSwap({
    inputMint: SOL_MINT,
    outputMint: job.mintAddress,
    amount: amountLamports,
    slippageBps: job.slippageBps,
    privateKeyBase58: buyPrivKey,
    rpcEndpoint,
    useJito: job.useJito,
    jitoEndpoint: settings.jitoEndpoint,
    jitoTipLamports: job.jitoTipLamports,
    jupiterApiKey: settings.jupiterApiKey,
  });

  const buySuccess = "txSignature" in buyResult;
  await db.insert(transactionsTable).values({
    accountId: buyerAccount.id,
    type: "volume",
    mintAddress: job.mintAddress,
    tokenSymbol: job.tokenSymbol,
    status: buySuccess ? "success" : "failed",
    txSignature: buySuccess ? buyResult.txSignature : null,
    amountIn: amountSol,
    amountOut: buySuccess ? buyResult.amountOut : null,
    error: buySuccess ? null : buyResult.error,
  });

  if (buySuccess) {
    successCount++;
    volumeAdded += amountSol;

    // For wash/random patterns, also sell after short delay
    if (pattern === "wash" || (pattern === "random" && Math.random() > 0.5)) {
      await sleep(randomBetween(1000, 5000));

      let sellPrivKey: string;
      try {
        sellPrivKey = decrypt(sellerAccount.encryptedPrivateKey, password);
      } catch {
        failCount++;
        await updateJobStats(jobId, successCount, failCount, volumeAdded);
        return;
      }

      // Sell ~half the tokens we just bought (rough estimate)
      const tokensToSell = Math.floor((buyResult.amountOut ?? 0) * 0.5 * 1e6);
      if (tokensToSell > 0) {
        const sellResult = await jupiterSwap({
          inputMint: job.mintAddress,
          outputMint: SOL_MINT,
          amount: tokensToSell,
          slippageBps: job.slippageBps,
          privateKeyBase58: sellPrivKey,
          rpcEndpoint,
          useJito: job.useJito,
          jitoEndpoint: settings.jitoEndpoint,
          jitoTipLamports: job.jitoTipLamports,
          jupiterApiKey: settings.jupiterApiKey,
        });

        const sellSuccess = "txSignature" in sellResult;
        await db.insert(transactionsTable).values({
          accountId: sellerAccount.id,
          type: "volume",
          mintAddress: job.mintAddress,
          tokenSymbol: job.tokenSymbol,
          status: sellSuccess ? "success" : "failed",
          txSignature: sellSuccess ? sellResult.txSignature : null,
          amountIn: tokensToSell / 1e6,
          amountOut: sellSuccess ? sellResult.amountOut : null,
          error: sellSuccess ? null : sellResult.error,
        });

        if (sellSuccess) successCount++;
        else failCount++;
      }
    }
  } else {
    failCount++;
  }

  await updateJobStats(jobId, successCount, failCount, volumeAdded);
}

async function updateJobStats(jobId: number, successDelta: number, failDelta: number, volumeDelta: number) {
  const [job] = await db.select().from(volumeJobsTable).where(eq(volumeJobsTable.id, jobId));
  if (!job) return;
  await db.update(volumeJobsTable).set({
    totalTrades: job.totalTrades + successDelta + failDelta,
    successfulTrades: job.successfulTrades + successDelta,
    failedTrades: job.failedTrades + failDelta,
    totalVolumeSol: job.totalVolumeSol + volumeDelta,
  }).where(eq(volumeJobsTable.id, jobId));
}

function scheduleNext(jobId: number, password: string, minDelayMs: number, maxDelayMs: number) {
  const delay = randomBetween(minDelayMs, maxDelayMs);
  const timer = setTimeout(async () => {
    const [job] = await db.select().from(volumeJobsTable).where(eq(volumeJobsTable.id, jobId));
    if (!job || job.status !== "running") {
      activeJobs.delete(jobId);
      return;
    }
    await runVolumeIteration(jobId, password);
    scheduleNext(jobId, password, minDelayMs, maxDelayMs);
  }, delay);
  activeJobs.set(jobId, timer);
}

function formatJob(job: typeof volumeJobsTable.$inferSelect) {
  return {
    id: job.id,
    mintAddress: job.mintAddress,
    tokenSymbol: job.tokenSymbol ?? null,
    status: job.status as "running" | "stopped" | "completed" | "failed",
    pattern: job.pattern,
    totalTrades: job.totalTrades,
    successfulTrades: job.successfulTrades,
    failedTrades: job.failedTrades,
    totalVolumeSol: job.totalVolumeSol,
    startedAt: job.startedAt,
    stoppedAt: job.stoppedAt ?? null,
    endsAt: job.endsAt ?? null,
  };
}

router.post("/volume/start", async (req, res) => {
  const body = StartVolumeJobBody.parse(req.body);

  // Get token symbol
  const settings = await getSettings();
  let tokenSymbol: string | undefined;
  try {
    const info = await getTokenInfo(body.mintAddress, settings.heliusApiKey);
    tokenSymbol = info.symbol;
  } catch {}

  const endsAt = new Date(Date.now() + body.totalDurationMinutes * 60 * 1000);

  const [job] = await db.insert(volumeJobsTable).values({
    mintAddress: body.mintAddress,
    tokenSymbol,
    accountIds: JSON.stringify(body.accountIds),
    status: "running",
    pattern: body.pattern ?? "random",
    minAmountSol: body.minAmountSol,
    maxAmountSol: body.maxAmountSol,
    minDelayMs: body.minDelayMs,
    maxDelayMs: body.maxDelayMs,
    totalDurationMinutes: body.totalDurationMinutes,
    slippageBps: body.slippageBps ?? 500,
    useJito: body.useJito ?? true,
    jitoTipLamports: body.jitoTipLamports ?? 10000,
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    totalVolumeSol: 0,
    endsAt,
  }).returning();

  scheduleNext(job.id, body.password, body.minDelayMs, body.maxDelayMs);

  res.status(201).json(formatJob(job));
});

router.get("/volume/jobs", async (_req, res) => {
  const jobs = await db.select().from(volumeJobsTable).orderBy(volumeJobsTable.startedAt);
  res.json(jobs.map(formatJob));
});

router.post("/volume/jobs/:jobId/stop", async (req, res) => {
  const { jobId } = StopVolumeJobParams.parse({ jobId: parseInt(req.params.jobId) });

  const timer = activeJobs.get(jobId);
  if (timer) {
    clearTimeout(timer);
    activeJobs.delete(jobId);
  }

  const [job] = await db
    .update(volumeJobsTable)
    .set({ status: "stopped", stoppedAt: new Date() })
    .where(eq(volumeJobsTable.id, jobId))
    .returning();

  res.json(formatJob(job));
});

export default router;
