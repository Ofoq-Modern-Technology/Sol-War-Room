import { Router } from "express";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { db, accountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/crypto.js";
import { getSettings } from "../lib/settingsStore.js";

const router = Router();

// POST /token-launch/pump
// Creates a token on Pump.fun via PumpPortal API
router.post("/token-launch/pump", async (req, res) => {
  try {
    const {
      name, symbol, description,
      twitter, telegram, website,
      imageBase64, imageMimeType,
      accountId, password,
      initialBuyAmountSol = 0,
    } = req.body as {
      name: string;
      symbol: string;
      description?: string;
      twitter?: string;
      telegram?: string;
      website?: string;
      imageBase64?: string;
      imageMimeType?: string;
      accountId: number;
      password: string;
      initialBuyAmountSol?: number;
    };

    if (!name || !symbol || !accountId || !password) {
      res.status(400).json({ error: "name, symbol, accountId, password required" });
      return;
    }

    // Load account + decrypt key
    const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, accountId));
    if (!account) { res.status(404).json({ error: "Account not found" }); return; }

    let privateKeyB58: string;
    try {
      privateKeyB58 = decrypt(account.encryptedPrivateKey, password);
    } catch {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    const wallet = Keypair.fromSecretKey(bs58.decode(privateKeyB58));

    // Generate a new keypair for the token mint
    const mintKeypair = Keypair.generate();

    // ── Step 1: Upload image to pump.fun IPFS ──────────────────────────────
    let metadataUri: string;
    try {
      const formData = new FormData();
      if (imageBase64 && imageMimeType) {
        const bytes = Buffer.from(imageBase64, "base64");
        const blob = new Blob([bytes], { type: imageMimeType });
        formData.append("file", blob, "image.png");
      }
      formData.append("name", name);
      formData.append("symbol", symbol);
      formData.append("description", description ?? "");
      if (twitter)  formData.append("twitter", twitter.replace(/^@/, ""));
      if (telegram) formData.append("telegram", telegram);
      if (website)  formData.append("website", website);
      formData.append("showName", "true");

      const ipfsResp = await fetch("https://pump.fun/api/ipfs", {
        method: "POST",
        body: formData,
      });
      if (!ipfsResp.ok) {
        const txt = await ipfsResp.text();
        res.status(502).json({ error: `IPFS upload failed: ${txt.slice(0, 200)}` });
        return;
      }
      const ipfsData = await ipfsResp.json() as { metadataUri?: string };
      if (!ipfsData.metadataUri) {
        res.status(502).json({ error: "No metadataUri returned from pump.fun IPFS" });
        return;
      }
      metadataUri = ipfsData.metadataUri;
    } catch (err) {
      res.status(502).json({ error: `IPFS error: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    // ── Step 2: Get create transaction from PumpPortal ─────────────────────
    const settings = await getSettings();
    const rpcEndpoint = settings.rpcEndpoint || "https://api.mainnet-beta.solana.com";

    const portalResp = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: wallet.publicKey.toBase58(),
        action: "create",
        tokenMetadata: { name, symbol, uri: metadataUri },
        mint: mintKeypair.publicKey.toBase58(),
        denominatedInSol: "true",
        amount: initialBuyAmountSol,
        slippage: 10,
        priorityFee: 0.0005,
        pool: "pump",
      }),
    });

    if (!portalResp.ok) {
      const txt = await portalResp.text();
      res.status(502).json({ error: `PumpPortal error: ${txt.slice(0, 300)}` });
      return;
    }

    const txBytes = new Uint8Array(await portalResp.arrayBuffer());
    const tx = VersionedTransaction.deserialize(txBytes);

    // Sign with both the mint keypair and the wallet
    tx.sign([mintKeypair, wallet]);

    // ── Step 3: Send transaction ───────────────────────────────────────────
    const connection = new Connection(rpcEndpoint, "confirmed");
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });

    // Confirm
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");

    res.json({
      signature,
      mintAddress: mintKeypair.publicKey.toBase58(),
      metadataUri,
      message: `Token created! Mint: ${mintKeypair.publicKey.toBase58()}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
