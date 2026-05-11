import { Router, type IRouter } from "express";
import { db, walletsTable, accountsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { deriveMultipleKeypairs, getSolBalance, jupiterSwap } from "../lib/solana.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { getSettings } from "../lib/settingsStore.js";
import {
  DeriveAccountsParams,
  DeriveAccountsBody,
  ListAccountsByWalletParams,
  RefreshBalancesBody,
} from "@workspace/api-zod";
import { z } from "zod";
import naclPkg from "tweetnacl";
import bs58 from "bs58";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const WSOL = "So11111111111111111111111111111111111111112";

interface RawTokenAccount {
  mint: string;
  rawAmount: string;
  decimals: number;
  uiAmount: number;
  owner: string;
}

async function fetchTokenAccounts(publicKey: string, rpcEndpoint: string): Promise<RawTokenAccount[]> {
  const results: RawTokenAccount[] = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const r = await fetch(rpcEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "getTokenAccountsByOwner",
          params: [publicKey, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }],
        }),
      });
      const data = await r.json() as {
        result?: { value?: Array<{ account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number; uiAmount: number | null }; owner: string } } } } }> };
      };
      for (const acc of data.result?.value ?? []) {
        const info = acc.account.data.parsed.info;
        const uiAmt = info.tokenAmount.uiAmount ?? 0;
        if (uiAmt > 0 && info.mint !== WSOL) {
          results.push({
            mint: info.mint,
            rawAmount: info.tokenAmount.amount,
            decimals: info.tokenAmount.decimals,
            uiAmount: uiAmt,
            owner: info.owner,
          });
        }
      }
    } catch { /* skip program */ }
  }
  return results;
}

async function fetchTokenMetadataBatch(mints: string[], heliusApiKey: string): Promise<Record<string, { name: string; symbol: string; logoUri?: string }>> {
  const result: Record<string, { name: string; symbol: string; logoUri?: string }> = {};
  try {
    const batchSize = 100;
    for (let i = 0; i < mints.length; i += batchSize) {
      const batch = mints.slice(i, i + batchSize);
      const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: "batch",
          method: "getAssetBatch",
          params: { ids: batch },
        }),
      });
      const data = await r.json() as { result?: Array<{ id: string; content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string } }; token_info?: { symbol?: string } }> };
      for (const asset of data.result ?? []) {
        result[asset.id] = {
          name: asset.content?.metadata?.name ?? asset.id.slice(0, 8),
          symbol: asset.content?.metadata?.symbol ?? asset.token_info?.symbol ?? "?",
          logoUri: asset.content?.links?.image,
        };
      }
    }
  } catch { /* no metadata */ }
  return result;
}

const router: IRouter = Router();

function enrichAccount(acc: typeof accountsTable.$inferSelect, walletName: string) {
  return {
    id: acc.id,
    walletId: acc.walletId,
    walletName,
    name: acc.name,
    publicKey: acc.publicKey,
    encryptedPrivateKey: acc.encryptedPrivateKey,
    hdPath: acc.hdPath,
    hdIndex: acc.hdIndex,
    solBalance: acc.solBalance ?? null,
    selected: acc.selected,
    createdAt: acc.createdAt,
  };
}

router.get("/wallets/:walletId/accounts", async (req, res) => {
  const { walletId } = ListAccountsByWalletParams.parse({ walletId: parseInt(req.params.walletId) });
  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
  if (!wallet) {
    res.status(404).json({ error: "Wallet not found" });
    return;
  }
  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.walletId, walletId));
  res.json(await Promise.all(accounts.map((a) => enrichAccount(a, wallet.name))));
});

router.post("/wallets/:walletId/accounts", async (req, res) => {
  const { walletId } = DeriveAccountsParams.parse({ walletId: parseInt(req.params.walletId) });
  const body = DeriveAccountsBody.parse(req.body);

  const [wallet] = await db.select().from(walletsTable).where(eq(walletsTable.id, walletId));
  if (!wallet) {
    res.status(404).json({ error: "Wallet not found" });
    return;
  }

  let mnemonic: string;
  try {
    mnemonic = decrypt(wallet.encryptedMnemonic, body.password);
  } catch {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  const existingAccounts = await db.select().from(accountsTable).where(eq(accountsTable.walletId, walletId));
  const startIndex = existingAccounts.length;

  const keypairs = deriveMultipleKeypairs(mnemonic, body.count, startIndex);

  const newAccounts = await Promise.all(
    keypairs.map(async (kp, i) => {
      const encryptedPrivateKey = encrypt(kp.privateKeyBase58, body.password);
      const accountIndex = startIndex + i + 1;
      const name = `${wallet.name}_account${accountIndex}`;
      const [acc] = await db
        .insert(accountsTable)
        .values({
          walletId,
          name,
          publicKey: kp.publicKey,
          encryptedPrivateKey,
          hdPath: kp.hdPath,
          hdIndex: kp.hdIndex,
          selected: false,
        })
        .returning();
      return enrichAccount(acc, wallet.name);
    })
  );

  res.status(201).json(newAccounts);
});

router.post("/accounts/import", async (req, res) => {
  const body = z.object({
    rows: z.array(z.object({ name: z.string().min(1), privateKey: z.string().min(1) })).min(1).max(500),
    password: z.string().min(1),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const { rows, password } = body.data;

  const nacl = naclPkg;

  // Find or create the "Imported Keys" wallet
  const existing = await db.select().from(walletsTable).where(eq(walletsTable.name, "Imported Keys"));
  let importedWallet = existing[0];
  if (!importedWallet) {
    const placeholderEnc = encrypt("imported-keys-no-mnemonic", password);
    const [w] = await db.insert(walletsTable).values({ name: "Imported Keys", encryptedMnemonic: placeholderEnc }).returning();
    importedWallet = w;
  }

  const added: string[] = [];
  const skipped: string[] = [];

  for (const row of rows) {
    let secretKey: Uint8Array;
    try {
      secretKey = bs58.decode(row.privateKey.trim());
      if (secretKey.length !== 64) throw new Error("bad length");
    } catch {
      res.status(400).json({ error: `Invalid private key for "${row.name}" — must be base58-encoded 64-byte Solana secret key` });
      return;
    }

    const kp = nacl.sign.keyPair.fromSecretKey(secretKey);
    const publicKey = bs58.encode(kp.publicKey);
    const encryptedPrivateKey = encrypt(row.privateKey.trim(), password);

    try {
      await db.insert(accountsTable).values({
        walletId: importedWallet.id,
        name: row.name,
        publicKey,
        encryptedPrivateKey,
        hdPath: "imported",
        hdIndex: 0,
        selected: false,
      });
      added.push(publicKey);
    } catch {
      skipped.push(publicKey);
    }
  }

  res.status(201).json({ added: added.length, skipped: skipped.length, walletId: importedWallet.id });
});

router.get("/accounts", async (_req, res) => {
  const accounts = await db.select().from(accountsTable);
  const wallets = await db.select().from(walletsTable);
  const walletMap = new Map(wallets.map((w) => [w.id, w.name]));
  res.json(accounts.map((a) => enrichAccount(a, walletMap.get(a.walletId) ?? "Unknown")));
});

router.post("/accounts/balances", async (req, res) => {
  const body = RefreshBalancesBody.parse(req.body);

  // Always re-read settings (don't use the cached version so a newly saved Helius key takes effect)
  const { invalidateSettingsCache } = await import("../lib/settingsStore.js");
  invalidateSettingsCache();
  const settings = await getSettings();

  const rpcEndpoint = settings.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
    : settings.rpcEndpoint;

  console.log(`[balances] refreshing ${body.accountIds.length} accounts via ${settings.heliusApiKey ? "Helius" : "public RPC"}`);

  const accounts = await db.select().from(accountsTable).where(inArray(accountsTable.id, body.accountIds));
  const wallets = await db.select().from(walletsTable);
  const walletMap = new Map(wallets.map((w) => [w.id, w.name]));

  const results: ReturnType<typeof enrichAccount>[] = [];

  // Fetch sequentially with a small delay to avoid rate limiting the public RPC
  for (const acc of accounts) {
    try {
      const balance = await getSolBalance(acc.publicKey, rpcEndpoint);
      const [updated] = await db
        .update(accountsTable)
        .set({ solBalance: balance })
        .where(eq(accountsTable.id, acc.id))
        .returning();
      console.log(`[balances] ${acc.publicKey.slice(0, 8)} = ${balance.toFixed(6)} SOL`);
      results.push(enrichAccount(updated, walletMap.get(updated.walletId) ?? "Unknown"));
    } catch (err) {
      console.error(`[balances] failed for ${acc.publicKey.slice(0, 8)}:`, err);
      // Keep the existing record but still return it (don't overwrite with 0)
      results.push(enrichAccount(acc, walletMap.get(acc.walletId) ?? "Unknown"));
    }
    // Small delay between calls to respect public RPC rate limits (not needed for Helius)
    if (!settings.heliusApiKey) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  res.json(results);
});

// GET /accounts/:id/tokens — all SPL token holdings for a specific account
router.get("/accounts/:id/tokens", async (req, res) => {
  const accountId = Number(req.params.id);
  const [acc] = await db.select().from(accountsTable).where(eq(accountsTable.id, accountId));
  if (!acc) { res.status(404).json({ error: "Account not found" }); return; }

  const settings = await getSettings();
  const rpc = settings.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
    : settings.rpcEndpoint ?? "https://api.mainnet-beta.solana.com";

  const tokenAccounts = await fetchTokenAccounts(acc.publicKey, rpc);

  // Enrich with metadata if Helius key is available
  let meta: Record<string, { name: string; symbol: string; logoUri?: string }> = {};
  if (settings.heliusApiKey && tokenAccounts.length > 0) {
    meta = await fetchTokenMetadataBatch(tokenAccounts.map(t => t.mint), settings.heliusApiKey);
  }

  const tokens = tokenAccounts.map(t => ({
    mint: t.mint,
    rawAmount: t.rawAmount,
    decimals: t.decimals,
    uiAmount: t.uiAmount,
    name: meta[t.mint]?.name ?? t.mint.slice(0, 8) + "…",
    symbol: meta[t.mint]?.symbol ?? "?",
    logoUri: meta[t.mint]?.logoUri ?? null,
  })).sort((a, b) => b.uiAmount - a.uiAmount);

  res.json(tokens);
});

// POST /accounts/tokens/sell — sell a token to SOL via Jupiter
router.post("/accounts/tokens/sell", async (req, res) => {
  const { accountId, mint, rawAmount, slippageBps, password } = req.body as {
    accountId: number;
    mint: string;
    rawAmount: string;
    slippageBps?: number;
    password: string;
  };

  if (!accountId || !mint || !rawAmount || !password) {
    res.status(400).json({ error: "accountId, mint, rawAmount, and password are required" });
    return;
  }

  const [acc] = await db.select().from(accountsTable).where(eq(accountsTable.id, accountId));
  if (!acc) { res.status(404).json({ error: "Account not found" }); return; }

  let privateKeyBase58: string;
  try {
    privateKeyBase58 = decrypt(acc.encryptedPrivateKey, password);
  } catch {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  const settings = await getSettings();
  const rpcEndpoint = settings.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
    : settings.rpcEndpoint ?? "https://api.mainnet-beta.solana.com";

  const result = await jupiterSwap({
    inputMint: mint,
    outputMint: WSOL,
    amount: Number(rawAmount),
    slippageBps: slippageBps ?? 1500,
    privateKeyBase58,
    rpcEndpoint,
    useJito: false,
    jitoEndpoint: "https://mainnet.block-engine.jito.labs.io",
    jitoTipLamports: 0,
    jupiterApiKey: settings.jupiterApiKey,
  });

  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ txSignature: result.txSignature, lamportsReceived: result.amountOut });
});

export default router;
