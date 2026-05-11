import { db, arbConfigsTable, arbLogsTable, accountsTable } from "@workspace/db";
import { eq, ne } from "drizzle-orm";
import { decrypt } from "./crypto.js";
import {
  buildSignedSwapTx, buildJitoTipTx, submitJitoBundle, waitForJitoBundle,
  JUPITER_BASE, jupiterFetch,
} from "./solana.js";
import { rateLimitedJupiterFetch } from "./rateQueue.js";
import { getSettings } from "./settingsStore.js";
import type { ArbConfig } from "@workspace/db";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export const activeArbJobs = new Map<number, NodeJS.Timeout>();

export const DEFAULT_DEXES = [
  "Raydium", "Raydium CLMM", "Orca", "Whirlpool", "Meteora DLMM", "Pump.fun AMM",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ArbOpportunity {
  buyDex: string;
  sellDex: string;
  tokenAmount: number;      // expected token output from buy
  minTokenAmount: number;   // worst-case (min) guaranteed tokens from buy (otherAmountThreshold)
  inputSol: number;
  quotedOutputSol: number;
  profitSol: number;
  isProfitable: boolean;
}

/** Single DEX quote — returns lamports out, or null if no pool / error */
async function getDexQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number,
  dex: string,
  jupiterApiKey: string | null,
): Promise<{ outAmount: number; minOutAmount: number } | null> {
  try {
    const url = `${JUPITER_BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&onlyDirectRoutes=true&dexes=${encodeURIComponent(dex)}`;
    const res = await rateLimitedJupiterFetch(url, undefined, jupiterApiKey);
    if (!res.ok) return null;
    const q = await res.json() as { outAmount?: string; otherAmountThreshold?: string; error?: string };
    if (q.error || !q.outAmount) return null;
    const outAmount = parseInt(q.outAmount);
    if (!outAmount) return null;
    return {
      outAmount,
      minOutAmount: parseInt(q.otherAmountThreshold ?? q.outAmount),
    };
  } catch {
    return null;
  }
}

/**
 * Multi-DEX cross-pair scan:
 * 1. Quote SOL→TOKEN on each DEX in parallel
 * 2. Cross-compare: for each (buyDex, sellDex) pair, quote TOKEN→SOL using
 *    the minOutAmount (worst-case tokens) from the buy leg — this guarantees
 *    the sell tx can execute even if slippage hit the buy
 * 3. Return the most profitable pair
 */
async function scanForOpportunity(
  config: ArbConfig,
  jupiterApiKey: string | null,
): Promise<ArbOpportunity | null> {
  let targetDexes: string[];
  try {
    targetDexes = JSON.parse(config.targetDexes ?? "null") ?? DEFAULT_DEXES;
  } catch {
    targetDexes = DEFAULT_DEXES;
  }
  if (targetDexes.length < 2) return null;

  const inputLamports = Math.floor(config.inputAmountSol * 1e9);
  // Jito tip cost: one tip tx paying jitoTipLamports total (covers both legs)
  const jitoCostSol = config.jitoTipLamports / 1e9;

  // Step 1: all buy quotes in parallel
  const buyResults = await Promise.all(
    targetDexes.map(async (dex) => {
      const q = await getDexQuote(SOL_MINT, config.mintAddress, inputLamports, config.slippageBps, dex, jupiterApiKey);
      return q ? { dex, outAmount: q.outAmount, minOutAmount: q.minOutAmount } : null;
    })
  );
  const validBuys = buyResults.filter(Boolean) as { dex: string; outAmount: number; minOutAmount: number }[];
  if (validBuys.length === 0) return null;

  // Step 2: all sell quotes in parallel — use minOutAmount (worst-case buy output)
  // as the sell input so the bundle is always valid regardless of buy slippage
  const crossPairs = validBuys.flatMap((buy) =>
    targetDexes
      .filter((sellDex) => sellDex !== buy.dex)
      .map((sellDex) => ({ buy, sellDex }))
  );

  const results = await Promise.all(
    crossPairs.map(async ({ buy, sellDex }) => {
      const sq = await getDexQuote(
        config.mintAddress, SOL_MINT,
        buy.minOutAmount, // worst-case tokens — sell tx will always have enough
        config.slippageBps,
        sellDex,
        jupiterApiKey,
      );
      if (!sq) return null;
      const quotedOutputSol = sq.outAmount / 1e9;
      const profitSol = quotedOutputSol - config.inputAmountSol - jitoCostSol;
      return {
        buyDex: buy.dex,
        sellDex,
        tokenAmount: buy.outAmount,
        minTokenAmount: buy.minOutAmount,
        inputSol: config.inputAmountSol,
        quotedOutputSol,
        profitSol,
        isProfitable: profitSol >= config.minProfitSol,
      } satisfies ArbOpportunity;
    })
  );

  const valid = results.filter(Boolean) as ArbOpportunity[];
  if (valid.length === 0) return null;

  // Best opportunity = highest profit
  valid.sort((a, b) => b.profitSol - a.profitSol);
  return valid[0]!;
}

/**
 * Atomic Jito bundle execution:
 * 1. Build buy tx (SOL→TOKEN on buyDex, unsigned)
 * 2. Build sell tx (minTokens TOKEN→SOL on sellDex, unsigned)
 * 3. Build Jito tip tx
 * 4. Bundle all three → submit → poll until confirmed or timeout
 *
 * If bundle fails or times out: NO tokens are stranded (atomicity guarantee).
 * Both legs land in the same slot or neither does.
 */
async function executeAtomicBundle(
  config: ArbConfig,
  opportunity: ArbOpportunity,
  privateKeyBase58: string,
  accountPublicKey: string,
  rpcEndpoint: string,
  jupiterApiKey: string,
  jitoEndpoint: string,
) {
  const [logEntry] = await db.insert(arbLogsTable).values({
    configId: config.id,
    type: "execute",
    inputSol: opportunity.inputSol,
    outputSol: null,
    profitSol: null,
    status: "executing",
    buyDex: opportunity.buyDex,
    sellDex: opportunity.sellDex,
  }).returning();

  console.log(
    `[ARB #${config.id}] Bundle: buy on ${opportunity.buyDex} → sell on ${opportunity.sellDex}` +
    ` | Expected +${opportunity.profitSol.toFixed(6)} SOL`
  );

  // --- Step 1: Build buy tx (SOL → TOKEN) ---
  const buyTxResult = await buildSignedSwapTx({
    inputMint: SOL_MINT,
    outputMint: config.mintAddress,
    amount: Math.floor(opportunity.inputSol * 1e9),
    slippageBps: config.slippageBps,
    privateKeyBase58,
    jupiterApiKey,
    dex: opportunity.buyDex,
  });

  if ("error" in buyTxResult) {
    await db.update(arbLogsTable).set({
      status: "failed",
      error: `Build buy tx failed: ${buyTxResult.error}`,
    }).where(eq(arbLogsTable.id, logEntry.id));
    console.log(`[ARB #${config.id}] Build buy tx failed: ${buyTxResult.error}`);
    return;
  }

  // --- Step 2: Build sell tx (minTokens TOKEN → SOL) ---
  // Use minOutAmount from buy leg to guarantee sell tx is valid even under slippage
  const sellTxResult = await buildSignedSwapTx({
    inputMint: config.mintAddress,
    outputMint: SOL_MINT,
    amount: opportunity.minTokenAmount,
    slippageBps: config.slippageBps,
    privateKeyBase58,
    jupiterApiKey,
    dex: opportunity.sellDex,
  });

  if ("error" in sellTxResult) {
    await db.update(arbLogsTable).set({
      status: "failed",
      error: `Build sell tx failed: ${sellTxResult.error}`,
    }).where(eq(arbLogsTable.id, logEntry.id));
    console.log(`[ARB #${config.id}] Build sell tx failed: ${sellTxResult.error}`);
    return;
  }

  // --- Step 3: Build Jito tip tx ---
  const tipTxBase64 = await buildJitoTipTx({
    privateKeyBase58,
    tipLamports: config.jitoTipLamports,
    rpcEndpoint,
  });

  if (!tipTxBase64) {
    await db.update(arbLogsTable).set({
      status: "failed",
      error: "Failed to build Jito tip tx",
    }).where(eq(arbLogsTable.id, logEntry.id));
    console.log(`[ARB #${config.id}] Failed to build tip tx`);
    return;
  }

  // --- Step 4: Submit bundle [buy, sell, tip] ---
  const bundleResult = await submitJitoBundle({
    jitoEndpoint,
    txs: [buyTxResult.signedTxBase64, sellTxResult.signedTxBase64, tipTxBase64],
  });

  if ("error" in bundleResult) {
    await db.update(arbLogsTable).set({
      status: "failed",
      error: `Bundle submission failed: ${bundleResult.error}`,
    }).where(eq(arbLogsTable.id, logEntry.id));
    console.log(`[ARB #${config.id}] Bundle submit failed: ${bundleResult.error}`);
    return;
  }

  console.log(`[ARB #${config.id}] Bundle submitted: ${bundleResult.bundleId}`);

  // Store bundleId in buyTxSignature field temporarily while waiting
  await db.update(arbLogsTable).set({
    buyTxSignature: `bundle:${bundleResult.bundleId}`,
  }).where(eq(arbLogsTable.id, logEntry.id));

  // --- Step 5: Wait for bundle to land ---
  const bundleStatus = await waitForJitoBundle({
    jitoEndpoint,
    bundleId: bundleResult.bundleId,
    timeoutMs: 45000,
  });

  if (bundleStatus.status === "landed") {
    // txSignatures[0] = buy, [1] = sell, [2] = tip
    const [buyTxSig, sellTxSig] = bundleStatus.txSignatures ?? [];

    // Estimate profit from our quoted sell output (actual might differ slightly due to slippage)
    const estimatedOutSol = sellTxResult.outAmount / 1e9;
    const estimatedProfit = estimatedOutSol - opportunity.inputSol - (config.jitoTipLamports / 1e9);

    await db.update(arbLogsTable).set({
      status: estimatedProfit > 0 ? "executed" : "executed_loss",
      buyTxSignature: buyTxSig ?? null,
      sellTxSignature: sellTxSig ?? null,
      outputSol: estimatedOutSol,
      profitSol: estimatedProfit,
    }).where(eq(arbLogsTable.id, logEntry.id));

    await db.update(arbConfigsTable).set({
      totalArbs: config.totalArbs + 1,
      totalProfitSol: (config.totalProfitSol ?? 0) + estimatedProfit,
    }).where(eq(arbConfigsTable.id, config.id));

    console.log(
      `[ARB #${config.id}] Bundle landed! ${opportunity.buyDex}→${opportunity.sellDex}` +
      ` | Est. profit: ${estimatedProfit >= 0 ? "+" : ""}${estimatedProfit.toFixed(6)} SOL`
    );

  } else {
    // Timeout or failed — bundle dropped, no funds at risk (atomic!)
    await db.update(arbLogsTable).set({
      status: "failed",
      error: bundleStatus.status === "timeout"
        ? "Bundle timed out — dropped by validators (no funds lost, bundle is atomic)"
        : `Bundle failed: ${bundleStatus.error ?? "unknown"}`,
    }).where(eq(arbLogsTable.id, logEntry.id));

    console.log(`[ARB #${config.id}] Bundle ${bundleStatus.status}: ${bundleStatus.error ?? ""}`);
  }
}

export async function runArbIteration(configId: number, password: string) {
  const [config] = await db.select().from(arbConfigsTable).where(eq(arbConfigsTable.id, configId));
  if (!config || config.status !== "running") return;

  const settings = await getSettings();
  if (!settings.jupiterApiKey) {
    console.log(`[ARB #${configId}] No Jupiter API key configured`);
    return;
  }

  const rpcEndpoint = settings.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
    : settings.rpcEndpoint;

  // Scan for best cross-DEX opportunity
  const opportunity = await scanForOpportunity(config, settings.jupiterApiKey);
  if (!opportunity) return;

  // Log the best scan result found
  await db.insert(arbLogsTable).values({
    configId: config.id,
    type: "scan",
    inputSol: opportunity.inputSol,
    outputSol: opportunity.quotedOutputSol,
    profitSol: opportunity.profitSol,
    status: opportunity.isProfitable ? "opportunity" : "no_opportunity",
    buyDex: opportunity.buyDex,
    sellDex: opportunity.sellDex,
  });

  if (!opportunity.isProfitable) {
    console.log(
      `[ARB #${configId}] Best: ${opportunity.buyDex}→${opportunity.sellDex}` +
      ` profit ${opportunity.profitSol.toFixed(6)} SOL — below threshold (${config.minProfitSol})`
    );
    return;
  }

  console.log(
    `[ARB #${configId}] OPPORTUNITY: ${opportunity.buyDex}→${opportunity.sellDex}` +
    ` +${opportunity.profitSol.toFixed(6)} SOL — building atomic bundle`
  );

  const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, config.accountId));
  if (!account) return;

  let privateKey: string;
  try {
    privateKey = decrypt(account.encryptedPrivateKey, password);
  } catch {
    console.log(`[ARB #${configId}] Invalid password`);
    return;
  }

  await executeAtomicBundle(
    config,
    opportunity,
    privateKey,
    account.publicKey,
    rpcEndpoint,
    settings.jupiterApiKey,
    settings.jitoEndpoint,
  );
}

export function scheduleArbJob(configId: number, password: string, intervalMs: number) {
  const tick = async () => {
    try {
      await runArbIteration(configId, password);
    } catch (err) {
      console.error(`[ARB #${configId}] Error:`, err);
    }
    const [config] = await db.select().from(arbConfigsTable).where(eq(arbConfigsTable.id, configId));
    if (config?.status === "running") {
      const t = setTimeout(tick, intervalMs);
      activeArbJobs.set(configId, t);
    }
  };
  const t = setTimeout(tick, 0);
  activeArbJobs.set(configId, t);
}

export function stopArbJob(configId: number) {
  const t = activeArbJobs.get(configId);
  if (t) {
    clearTimeout(t);
    activeArbJobs.delete(configId);
  }
}

export async function resetStaleArbStatuses() {
  const stale = await db
    .select({ id: arbConfigsTable.id })
    .from(arbConfigsTable)
    .where(ne(arbConfigsTable.status, "idle"));
  if (stale.length > 0) {
    await db
      .update(arbConfigsTable)
      .set({ status: "idle", stoppedAt: new Date() })
      .where(ne(arbConfigsTable.status, "idle"));
    console.log(`[arb] ${stale.length} stale running status(es) reset to idle on startup`);
  }
}
