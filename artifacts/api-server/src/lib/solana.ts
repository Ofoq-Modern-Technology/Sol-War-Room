import { mnemonicToSeedSync, generateMnemonic } from "bip39";
import { derivePath } from "ed25519-hd-key";
import naclPkg from "tweetnacl";
import bs58 from "bs58";
import { Connection, Keypair, VersionedTransaction, Transaction, SystemProgram, PublicKey } from "@solana/web3.js";

const nacl = naclPkg;

export interface DerivedKeypair {
  publicKey: string;
  privateKeyBase58: string;
  hdPath: string;
  hdIndex: number;
}

export function generateNewMnemonic(): string {
  return generateMnemonic(256); // 24 words
}

export function deriveKeypair(mnemonic: string, index: number): DerivedKeypair {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdPath = `m/44'/501'/${index}'/0'`;
  const { key } = derivePath(hdPath, seed.toString("hex"));
  const keypair = nacl.sign.keyPair.fromSeed(key);
  const publicKey = bs58.encode(keypair.publicKey);
  const privateKeyBase58 = bs58.encode(keypair.secretKey);
  return { publicKey, privateKeyBase58, hdPath, hdIndex: index };
}

export function deriveMultipleKeypairs(mnemonic: string, count: number, startIndex = 0): DerivedKeypair[] {
  const keypairs: DerivedKeypair[] = [];
  for (let i = startIndex; i < startIndex + count; i++) {
    keypairs.push(deriveKeypair(mnemonic, i));
  }
  return keypairs;
}

/** Returns the account balance in **SOL** (already divided by 1e9). */
export async function getSolBalance(publicKey: string, rpcEndpoint: string): Promise<number> {
  const response = await fetch(rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [publicKey, { commitment: "confirmed" }],
    }),
  });
  const data = await response.json() as { result?: { value?: number }; error?: { message?: string; code?: number } };
  if (data.error) {
    throw new Error(`RPC error for ${publicKey.slice(0, 8)}: ${data.error.message ?? JSON.stringify(data.error)}`);
  }
  if (data.result?.value == null) {
    throw new Error(`RPC returned no balance for ${publicKey.slice(0, 8)}: ${JSON.stringify(data)}`);
  }
  return data.result.value / 1e9; // SOL
}

export const JUPITER_BASE = "https://api.jup.ag/swap/v1";

// Retry-aware fetch for Jupiter API (handles 429 rate limits)
export async function jupiterFetch(url: string, init?: RequestInit, apiKey?: string | null, maxRetries = 6): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (apiKey) headers["x-api-key"] = apiKey;

  const finalInit: RequestInit = { ...init, headers };
  let delay = 600;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, finalInit);
    if (res.status !== 429) return res;
    if (attempt === maxRetries) return res; // return the 429 after final attempt
    console.warn(`Jupiter 429, retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 8000);
  }
  // unreachable but satisfies TS
  return fetch(url, finalInit);
}

export async function getTokenInfo(mintAddress: string, heliusApiKey?: string | null): Promise<{
  name: string;
  symbol: string;
  decimals: number;
  price?: number;
  marketCap?: number;
  liquidity?: number;
  volume24h?: number;
  dex: string;
  graduated?: boolean;
  logoUri?: string;
}> {
  // Try Helius DAS API first
  if (heliusApiKey) {
    try {
      const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
      const assetRes = await fetch(heliusUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "get-asset",
          method: "getAsset",
          params: { id: mintAddress },
        }),
      });
      const assetData = await assetRes.json() as {
        result?: {
          content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string } };
          token_info?: { decimals?: number; price_info?: { price_per_token?: number }; symbol?: string };
        }
      };

      if (assetData.result) {
        const asset = assetData.result;
        const name = asset.content?.metadata?.name ?? "Unknown";
        const symbol = asset.content?.metadata?.symbol ?? asset.token_info?.symbol ?? "?";
        const decimals = asset.token_info?.decimals ?? 6;
        const price = asset.token_info?.price_info?.price_per_token;
        const logoUri = asset.content?.links?.image;

        let dex = "unknown";
        let graduated: boolean | undefined;
        let marketCap: number | undefined;

        try {
          const pumpRes = await fetch(`https://frontend-api.pump.fun/coins/${mintAddress}`);
          if (pumpRes.ok) {
            const pumpData = await pumpRes.json() as { complete?: boolean; usd_market_cap?: number };
            graduated = pumpData.complete ?? false;
            marketCap = pumpData.usd_market_cap;
            dex = graduated ? "raydium" : "pump_fun";
          }
        } catch {}

        return { name, symbol, decimals, price, marketCap, dex, graduated, logoUri };
      }
    } catch (err) {
      console.error("Helius error:", err);
    }
  }

  // Fallback: try pump.fun API
  try {
    const pumpRes = await fetch(`https://frontend-api.pump.fun/coins/${mintAddress}`);
    if (pumpRes.ok) {
      const pumpData = await pumpRes.json() as {
        name?: string;
        symbol?: string;
        complete?: boolean;
        usd_market_cap?: number;
        image_uri?: string;
      };
      return {
        name: pumpData.name ?? "Unknown",
        symbol: pumpData.symbol ?? "?",
        decimals: 6,
        marketCap: pumpData.usd_market_cap,
        dex: pumpData.complete ? "raydium" : "pump_fun",
        graduated: pumpData.complete ?? false,
        logoUri: pumpData.image_uri,
      };
    }
  } catch {}

  return { name: "Unknown Token", symbol: "?", decimals: 6, dex: "unknown" };
}

export async function jupiterSwap(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
  privateKeyBase58: string;
  rpcEndpoint: string;
  useJito: boolean;
  jitoEndpoint: string;
  jitoTipLamports: number;
  jupiterApiKey?: string | null;
}): Promise<{ txSignature: string; amountOut: number } | { error: string }> {
  const {
    inputMint, outputMint, amount, slippageBps,
    privateKeyBase58, rpcEndpoint, useJito, jitoEndpoint, jitoTipLamports,
    jupiterApiKey,
  } = params;

  if (!jupiterApiKey) {
    return { error: "Jupiter API key not configured. Please add your Jupiter API key in Settings (get a free key at dev.jup.ag)." };
  }

  // Minimum lamports needed beyond the swap amount to cover:
  //   - wSOL ATA rent (temporary):           ~2,039,280 lamports
  //   - Output ATA rent (Token-2022, 170 B): ~2,039,280 lamports
  //   - JUP route internal transfer:         ~2,039,280 lamports
  //   - Transaction fee:                         ~5,000 lamports
  // Buffer is intentionally generous (0.007 SOL) so Token-2022 tokens
  // never hit "insufficient lamports" on-chain.
  const MIN_OVERHEAD_LAMPORTS = 7_000_000;

  // WSOL mint — used to detect whether the swap input is SOL
  const WSOL_MINT = "So11111111111111111111111111111111111111112";
  const isBuyingSol = inputMint === WSOL_MINT; // true = SOL→token (buy), false = token→SOL (sell/dump)

  try {
    // 0. Pre-flight SOL balance check
    // getSolBalance returns SOL; convert to lamports for comparison
    const balanceSol = await getSolBalance(
      Keypair.fromSecretKey(bs58.decode(privateKeyBase58)).publicKey.toBase58(),
      rpcEndpoint,
    );
    const balanceLamports = Math.round(balanceSol * 1e9);

    // When buying (SOL→token), we need `amount` lamports PLUS overhead.
    // When selling (token→SOL), `amount` is token base units — we only need SOL for fees/rent.
    const neededLamports = isBuyingSol ? amount + MIN_OVERHEAD_LAMPORTS : MIN_OVERHEAD_LAMPORTS;

    if (balanceLamports < neededLamports) {
      const haveSol = balanceSol.toFixed(4);
      const needSol = (neededLamports / 1e9).toFixed(4);
      return {
        error: `Insufficient SOL: wallet has ${haveSol} SOL but needs ≥ ${needSol} SOL (${isBuyingSol ? "swap amount + " : ""}ATA rent + fees). Top up the wallet and retry.`,
      };
    }

    // 1. Get quote from Jupiter v1 API (with 429 retry)
    const quoteUrl = `${JUPITER_BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&onlyDirectRoutes=false`;
    console.log("[jupiterSwap] GET quote:", quoteUrl);
    const quoteRes = await jupiterFetch(quoteUrl, undefined, jupiterApiKey);

    if (!quoteRes.ok) {
      const errBody = await quoteRes.text().catch(() => quoteRes.statusText);
      console.error("[jupiterSwap] quote failed", quoteRes.status, errBody);
      return { error: `Jupiter quote failed (${quoteRes.status}): ${errBody}` };
    }

    const quoteData = await quoteRes.json() as Record<string, unknown> & {
      outAmount?: string;
      error?: string;
    };
    console.log("[jupiterSwap] quote ok, outAmount:", quoteData.outAmount);

    if (quoteData.error) {
      return { error: `Jupiter quote error: ${quoteData.error}` };
    }
    if (!quoteData.outAmount) {
      return { error: "Jupiter returned no route for this token pair" };
    }

    // 2. Build swap keypair
    const keypairBytes = bs58.decode(privateKeyBase58);
    const keypair = Keypair.fromSecretKey(keypairBytes);
    console.log("[jupiterSwap] wallet:", keypair.publicKey.toBase58());

    // 3. Request swap transaction from Jupiter v1 API
    const swapBody: Record<string, unknown> = {
      quoteResponse: quoteData,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
    };
    if (useJito) {
      swapBody.prioritizationFeeLamports = jitoTipLamports;
    }

    console.log("[jupiterSwap] POST swap body keys:", Object.keys(swapBody));
    const swapRes = await jupiterFetch(`${JUPITER_BASE}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(swapBody),
    }, jupiterApiKey);

    if (!swapRes.ok) {
      const errBody = await swapRes.text().catch(() => swapRes.statusText);
      console.error("[jupiterSwap] swap build failed", swapRes.status, errBody);
      return { error: `Jupiter swap build failed (${swapRes.status}): ${errBody}` };
    }

    const swapData = await swapRes.json() as { swapTransaction?: string; error?: string };
    console.log("[jupiterSwap] swap tx received:", !!swapData.swapTransaction, swapData.error);

    if (swapData.error) {
      return { error: `Jupiter swap error: ${swapData.error}` };
    }
    if (!swapData.swapTransaction) {
      return { error: "Jupiter returned no swap transaction" };
    }

    // 4. Deserialize and sign with @solana/web3.js VersionedTransaction
    const txBytes = Buffer.from(swapData.swapTransaction, "base64");
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([keypair]);
    const signedTxBytes = tx.serialize();
    console.log("[jupiterSwap] tx signed, size:", signedTxBytes.length, "bytes");

    // 5. Send the transaction
    let txSig: string;

    if (useJito) {
      // Try Jito block engine; retry once on rate-limit before falling back to RPC
      const jitoRpcUrl = `${jitoEndpoint}/api/v1/transactions`;
      console.log("[jupiterSwap] sending via Jito:", jitoRpcUrl);

      const sendViaJito = async () => {
        const res = await fetch(jitoRpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "sendTransaction",
            params: [Buffer.from(signedTxBytes).toString("base64"), { encoding: "base64" }],
          }),
        });
        return res.json() as Promise<{ result?: string; error?: { message: string } }>;
      };

      try {
        let jitoData = await sendViaJito();

        // Jito rate-limits at 1 tx/sec — parse "Retry after Nms" and retry once
        if (!jitoData.result && jitoData.error?.message?.toLowerCase().includes("rate limit")) {
          const retryMs = parseInt(jitoData.error.message.match(/Retry after (\d+)ms/i)?.[1] ?? "1100");
          const waitMs = Math.min(retryMs + 100, 3000);
          console.warn(`[jupiterSwap] Jito rate-limited, retrying after ${waitMs}ms…`);
          await new Promise((r) => setTimeout(r, waitMs));
          jitoData = await sendViaJito();
        }

        if (jitoData.result) {
          txSig = jitoData.result;
          console.log("[jupiterSwap] Jito success:", txSig);
        } else {
          console.warn("[jupiterSwap] Jito failed, falling back to RPC:", jitoData.error?.message);
          const connection = new Connection(rpcEndpoint, "confirmed");
          txSig = await connection.sendRawTransaction(signedTxBytes, {
            skipPreflight: false,
            maxRetries: 3,
          });
          console.log("[jupiterSwap] RPC fallback success:", txSig);
        }
      } catch (jitoErr) {
        console.warn("[jupiterSwap] Jito error, falling back to RPC:", jitoErr);
        const connection = new Connection(rpcEndpoint, "confirmed");
        txSig = await connection.sendRawTransaction(signedTxBytes, {
          skipPreflight: false,
          maxRetries: 3,
        });
        console.log("[jupiterSwap] RPC fallback success:", txSig);
      }
    } else {
      console.log("[jupiterSwap] sending via RPC:", rpcEndpoint);
      const connection = new Connection(rpcEndpoint, "confirmed");
      txSig = await connection.sendRawTransaction(signedTxBytes, {
        skipPreflight: false,
        maxRetries: 3,
      });
      console.log("[jupiterSwap] RPC success:", txSig);
    }

    const outAmountRaw = parseInt(quoteData.outAmount ?? "0");
    return { txSignature: txSig, amountOut: outAmountRaw };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[jupiterSwap] catch:", msg);
    return { error: msg };
  }
}

// ─── Jito bundle helpers ─────────────────────────────────────────────────────

/** 8 Jito tip accounts — pick one at random per bundle */
export const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvB6q6tGFVCaLjNvWCQFuW9LAh8CU5kfmB",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1qqUqvkFoZ",
  "DfXygSm4jCyNCybVYYK6DwvWqjY4ggCNiNGzXN3Jryv3",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

export function randomJitoTipAccount(): string {
  return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]!;
}

/**
 * Build and sign a Jupiter swap tx WITHOUT submitting it.
 * Returns base64-encoded signed tx + amount info for chaining.
 * No prioritizationFeeLamports — tip is handled separately as a bundle tip tx.
 */
export async function buildSignedSwapTx(params: {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
  privateKeyBase58: string;
  jupiterApiKey?: string | null;
  dex?: string;
}): Promise<{
  signedTxBase64: string;
  outAmount: number;
  minOutAmount: number; // otherAmountThreshold — worst-case guaranteed output
} | { error: string }> {
  const { inputMint, outputMint, amount, slippageBps, privateKeyBase58, jupiterApiKey, dex } = params;

  if (!jupiterApiKey) return { error: "No Jupiter API key" };

  try {
    let quoteUrl = `${JUPITER_BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&onlyDirectRoutes=true`;
    if (dex) quoteUrl += `&dexes=${encodeURIComponent(dex)}`;

    const quoteRes = await jupiterFetch(quoteUrl, undefined, jupiterApiKey);
    if (!quoteRes.ok) return { error: `Quote failed (${quoteRes.status})` };

    const quoteData = await quoteRes.json() as Record<string, unknown> & {
      outAmount?: string;
      otherAmountThreshold?: string;
      error?: string;
    };
    if (quoteData.error || !quoteData.outAmount) {
      return { error: quoteData.error ?? "No route found" };
    }

    const keypairBytes = bs58.decode(privateKeyBase58);
    const keypair = Keypair.fromSecretKey(keypairBytes);

    // Build tx — no prioritizationFeeLamports (tip handled by separate tip tx in bundle)
    const swapBody = {
      quoteResponse: quoteData,
      userPublicKey: keypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
    };

    const swapRes = await jupiterFetch(`${JUPITER_BASE}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(swapBody),
    }, jupiterApiKey);

    if (!swapRes.ok) {
      const errText = await swapRes.text().catch(() => swapRes.statusText);
      return { error: `Swap build failed (${swapRes.status}): ${errText}` };
    }

    const swapData = await swapRes.json() as { swapTransaction?: string; error?: string };
    if (swapData.error || !swapData.swapTransaction) {
      return { error: swapData.error ?? "No swap transaction returned" };
    }

    const txBytes = Buffer.from(swapData.swapTransaction, "base64");
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([keypair]);

    return {
      signedTxBase64: Buffer.from(tx.serialize()).toString("base64"),
      outAmount: parseInt(quoteData.outAmount),
      minOutAmount: parseInt(quoteData.otherAmountThreshold ?? quoteData.outAmount),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Build a legacy SOL transfer tx to pay the Jito tip.
 * This must be the LAST tx in the bundle.
 */
export async function buildJitoTipTx(params: {
  privateKeyBase58: string;
  tipLamports: number;
  rpcEndpoint: string;
}): Promise<string | null> {
  try {
    const { privateKeyBase58, tipLamports, rpcEndpoint } = params;
    const keypairBytes = bs58.decode(privateKeyBase58);
    const keypair = Keypair.fromSecretKey(keypairBytes);
    const connection = new Connection(rpcEndpoint, "confirmed");

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tipPubkey = new PublicKey(randomJitoTipAccount());

    const tx = new Transaction();
    tx.add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: tipPubkey,
        lamports: tipLamports,
      })
    );
    tx.recentBlockhash = blockhash;
    tx.feePayer = keypair.publicKey;
    tx.sign(keypair);

    return Buffer.from(tx.serialize()).toString("base64");
  } catch {
    return null;
  }
}

/**
 * Submit a Jito bundle (array of signed base64 txs).
 * Returns bundleId on success.
 */
export async function submitJitoBundle(params: {
  jitoEndpoint: string;
  txs: string[]; // base64 signed txs, tip tx last
}): Promise<{ bundleId: string } | { error: string }> {
  try {
    const res = await fetch(`${params.jitoEndpoint}/api/v1/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [params.txs],
      }),
    });
    const data = await res.json() as { result?: string; error?: { message?: string; data?: unknown } };
    if (data.result) return { bundleId: data.result };
    const msg = data.error?.message ?? JSON.stringify(data.error) ?? "Unknown Jito bundle error";
    return { error: msg };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

interface BundleStatusResult {
  bundle_id: string;
  transactions: string[];
  slot: number;
  confirmation_status: string | null;
  err: { Ok: null } | { Err: unknown } | null;
}

/**
 * Poll Jito for bundle status until confirmed, failed, or timeout.
 * "landed" = confirmed/finalized with no error.
 */
export async function waitForJitoBundle(params: {
  jitoEndpoint: string;
  bundleId: string;
  timeoutMs?: number;
}): Promise<{ status: "landed" | "failed" | "timeout"; txSignatures?: string[]; error?: string }> {
  const { jitoEndpoint, bundleId, timeoutMs = 45000 } = params;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));

    try {
      const res = await fetch(`${jitoEndpoint}/api/v1/bundles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBundleStatuses",
          params: [[bundleId]],
        }),
      });

      const data = await res.json() as {
        result?: { value?: BundleStatusResult[] };
        error?: { message: string };
      };

      if (data.error) return { status: "failed", error: data.error.message };

      const bundle = data.result?.value?.[0];
      if (!bundle) continue; // not found yet — keep polling

      const status = bundle.confirmation_status;

      if (status === "confirmed" || status === "finalized") {
        // Check for execution error
        const execErr = bundle.err;
        if (execErr && "Err" in execErr) {
          return { status: "failed", error: `Bundle tx error: ${JSON.stringify(execErr.Err)}` };
        }
        return { status: "landed", txSignatures: bundle.transactions };
      }

      // "processed" — still propagating, keep polling
    } catch {
      // network hiccup — retry
    }
  }

  return { status: "timeout", error: "Bundle not confirmed within timeout" };
}

export function getTokenBalance(publicKey: string, mintAddress: string, rpcEndpoint: string): Promise<number> {
  return fetch(rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [
        publicKey,
        { mint: mintAddress },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ],
    }),
  })
    .then((r) => r.json())
    .then((data: { result?: { value?: Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: number; decimals: number } } } } } }> } }) => {
      const accounts = data.result?.value ?? [];
      if (accounts.length === 0) return 0;
      return accounts[0].account.data.parsed.info.tokenAmount.uiAmount ?? 0;
    })
    .catch(() => 0);
}
