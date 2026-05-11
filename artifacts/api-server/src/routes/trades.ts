import { Router, type IRouter } from "express";
import { db, accountsTable, transactionsTable, walletsTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";
import { z } from "zod";
import { decrypt } from "../lib/crypto.js";
import { jupiterSwap, getTokenBalance, JUPITER_BASE, jupiterFetch } from "../lib/solana.js";
import { getSettings } from "../lib/settingsStore.js";
import { ExecuteBuyBody, ExecuteSellBody } from "@workspace/api-zod";

const router: IRouter = Router();

const SOL_MINT = "So11111111111111111111111111111111111111112";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

router.post("/trades/buy", async (req, res) => {
  const body = ExecuteBuyBody.parse(req.body);
  const settings = await getSettings();

  const rpcEndpoint = body.password && settings.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
    : settings.rpcEndpoint;

  const accounts = await db
    .select()
    .from(accountsTable)
    .where(inArray(accountsTable.id, body.accountIds));

  const wallets = await db.select().from(walletsTable);
  const walletMap = new Map(wallets.map((w) => [w.id, w.name]));

  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    if (i > 0 && body.delayMs && body.delayMs > 0) {
      await sleep(body.delayMs);
    }

    // Determine amount: random range or fixed
    let amountSol: number;
    if (body.minAmountSol !== undefined && body.maxAmountSol !== undefined) {
      amountSol = randomBetween(body.minAmountSol, body.maxAmountSol);
    } else {
      amountSol = body.amountSol ?? 0;
    }

    if (amountSol <= 0) {
      results.push({
        accountId: acc.id,
        accountName: acc.name,
        publicKey: acc.publicKey,
        status: "failed" as const,
        error: "Amount must be > 0 (set amountSol or minAmountSol+maxAmountSol)",
        txSignature: null,
        amountIn: 0,
        amountOut: null,
      });
      continue;
    }

    let privateKey: string;
    try {
      privateKey = decrypt(acc.encryptedPrivateKey, body.password);
    } catch {
      await db.insert(transactionsTable).values({
        accountId: acc.id,
        type: "buy",
        mintAddress: body.mintAddress,
        status: "failed",
        error: "Invalid password",
        amountIn: amountSol,
      });
      results.push({
        accountId: acc.id,
        accountName: acc.name,
        publicKey: acc.publicKey,
        status: "failed" as const,
        error: "Invalid password",
        txSignature: null,
        amountIn: amountSol,
        amountOut: null,
      });
      continue;
    }

    const amountLamports = Math.floor(amountSol * 1e9);
    const swapResult = await jupiterSwap({
      inputMint: SOL_MINT,
      outputMint: body.mintAddress,
      amount: amountLamports,
      slippageBps: body.slippageBps ?? 500,
      privateKeyBase58: privateKey,
      rpcEndpoint,
      useJito: body.useJito ?? true,
      jitoEndpoint: settings.jitoEndpoint,
      jitoTipLamports: body.jitoTipLamports ?? 10000,
      jupiterApiKey: settings.jupiterApiKey,
    });

    const success = "txSignature" in swapResult;
    await db.insert(transactionsTable).values({
      accountId: acc.id,
      type: "buy",
      mintAddress: body.mintAddress,
      status: success ? "success" : "failed",
      txSignature: success ? swapResult.txSignature : null,
      amountIn: amountSol,
      amountOut: success ? swapResult.amountOut : null,
      error: success ? null : swapResult.error,
    });

    results.push({
      accountId: acc.id,
      accountName: acc.name,
      publicKey: acc.publicKey,
      status: success ? ("success" as const) : ("failed" as const),
      txSignature: success ? swapResult.txSignature : null,
      error: success ? null : swapResult.error,
      amountIn: amountSol,
      amountOut: success ? swapResult.amountOut : null,
    });
  }

  res.json(results);
});

router.post("/trades/sell", async (req, res) => {
  const body = ExecuteSellBody.parse(req.body);
  const settings = await getSettings();

  const rpcEndpoint = settings.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
    : settings.rpcEndpoint;

  const accounts = await db
    .select()
    .from(accountsTable)
    .where(inArray(accountsTable.id, body.accountIds));

  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    if (i > 0 && body.delayMs && body.delayMs > 0) {
      await sleep(body.delayMs);
    }

    let privateKey: string;
    try {
      privateKey = decrypt(acc.encryptedPrivateKey, body.password);
    } catch {
      await db.insert(transactionsTable).values({
        accountId: acc.id,
        type: "sell",
        mintAddress: body.mintAddress,
        status: "failed",
        error: "Invalid password",
      });
      results.push({
        accountId: acc.id,
        accountName: acc.name,
        publicKey: acc.publicKey,
        status: "failed" as const,
        error: "Invalid password",
        txSignature: null,
        amountIn: null,
        amountOut: null,
      });
      continue;
    }

    const tokenBalance = await getTokenBalance(acc.publicKey, body.mintAddress, rpcEndpoint);
    if (tokenBalance <= 0) {
      results.push({
        accountId: acc.id,
        accountName: acc.name,
        publicKey: acc.publicKey,
        status: "failed" as const,
        error: "No token balance",
        txSignature: null,
        amountIn: 0,
        amountOut: null,
      });
      continue;
    }

    const percentToSell = body.percentToSell ?? 100;
    const amountToSell = Math.floor(tokenBalance * (percentToSell / 100) * 1e6); // assuming 6 decimals

    const swapResult = await jupiterSwap({
      inputMint: body.mintAddress,
      outputMint: SOL_MINT,
      amount: amountToSell,
      slippageBps: body.slippageBps ?? 500,
      privateKeyBase58: privateKey,
      rpcEndpoint,
      useJito: body.useJito ?? true,
      jitoEndpoint: settings.jitoEndpoint,
      jitoTipLamports: body.jitoTipLamports ?? 10000,
      jupiterApiKey: settings.jupiterApiKey,
    });

    const success = "txSignature" in swapResult;
    await db.insert(transactionsTable).values({
      accountId: acc.id,
      type: "sell",
      mintAddress: body.mintAddress,
      status: success ? "success" : "failed",
      txSignature: success ? swapResult.txSignature : null,
      amountIn: tokenBalance * (percentToSell / 100),
      amountOut: success ? swapResult.amountOut : null,
      error: success ? null : swapResult.error,
    });

    results.push({
      accountId: acc.id,
      accountName: acc.name,
      publicKey: acc.publicKey,
      status: success ? ("success" as const) : ("failed" as const),
      txSignature: success ? swapResult.txSignature : null,
      error: success ? null : swapResult.error,
      amountIn: tokenBalance * (percentToSell / 100),
      amountOut: success ? swapResult.amountOut : null,
    });
  }

  res.json(results);
});

router.get("/trades/positions", async (req, res) => {
  const query = z.object({
    mintAddress: z.string(),
    accountIds: z.string().transform((s) => s.split(",").map(Number).filter(Boolean)),
  }).parse(req.query);

  const settings = await getSettings();
  const rpcEndpoint = settings.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
    : settings.rpcEndpoint;

  const accounts = await db
    .select()
    .from(accountsTable)
    .where(inArray(accountsTable.id, query.accountIds));

  // Get all successful buy transactions for these accounts + this mint
  const buys = await db
    .select()
    .from(transactionsTable)
    .where(
      and(
        inArray(transactionsTable.accountId, query.accountIds),
        eq(transactionsTable.mintAddress, query.mintAddress),
        inArray(transactionsTable.type, ["buy", "volume"]),
        eq(transactionsTable.status, "success"),
      )
    );

  const buysByAccount = new Map<number, typeof buys>();
  for (const buy of buys) {
    if (!buysByAccount.has(buy.accountId)) buysByAccount.set(buy.accountId, []);
    buysByAccount.get(buy.accountId)!.push(buy);
  }

  const positions = await Promise.all(
    accounts.map(async (acc) => {
      const accBuys = buysByAccount.get(acc.id) ?? [];
      const totalSolIn = accBuys.reduce((sum, b) => sum + (b.amountIn ?? 0), 0);
      const buyCount = accBuys.length;

      const tokenBalance = await getTokenBalance(acc.publicKey, query.mintAddress, rpcEndpoint);

      let currentValueSol = 0;
      if (tokenBalance > 0 && settings.jupiterApiKey) {
        try {
          const tokenBaseLamports = Math.floor(tokenBalance * 1e6); // assume 6 decimals (pump.fun)
          const quoteRes = await jupiterFetch(
            `${JUPITER_BASE}/quote?inputMint=${query.mintAddress}&outputMint=${SOL_MINT}&amount=${tokenBaseLamports}&slippageBps=500&onlyDirectRoutes=false`,
            undefined,
            settings.jupiterApiKey,
          );
          if (quoteRes.ok) {
            const quoteData = await quoteRes.json() as { outAmount?: string };
            currentValueSol = parseInt(quoteData.outAmount ?? "0") / 1e9;
          }
        } catch {
          // Ignore quote errors — position still shown with 0 current value
        }
      }

      // Estimate: ~0.0005 SOL per swap (gas + protocol fee)
      const estimatedFees = buyCount * 0.0005;
      const pnlSol = currentValueSol - totalSolIn;
      const pnlPct = totalSolIn > 0 ? (pnlSol / totalSolIn) * 100 : 0;

      return {
        accountId: acc.id,
        accountName: acc.name,
        publicKey: acc.publicKey,
        totalSolIn,
        buyCount,
        tokenBalance,
        currentValueSol,
        estimatedFees,
        pnlSol,
        pnlPct,
      };
    })
  );

  res.json(positions);
});

export default router;
