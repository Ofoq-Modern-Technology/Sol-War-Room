import { Router, type IRouter } from "express";
import { db, distributorWalletTable, accountsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import * as bip39 from "bip39";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { derivePath } from "ed25519-hd-key";
import naclPkg from "tweetnacl";
import bs58 from "bs58";
import { encrypt, decrypt } from "../lib/crypto.js";
import { getSettings } from "../lib/settingsStore.js";
import { z } from "zod";

const nacl = naclPkg;
const router: IRouter = Router();

const HD_PATH = "m/44'/501'/0'/0'";
const MIN_RENT_SOL = 0.002;

function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL));
}

async function getRpcEndpoint(): Promise<string> {
  const settings = await getSettings();
  return settings.heliusApiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
    : settings.rpcEndpoint;
}

function mnemonicToKeypair(mnemonic: string, hdPath: string): Keypair {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const { key } = derivePath(hdPath, seed.toString("hex"));
  const keypair = nacl.sign.keyPair.fromSeed(key);
  return Keypair.fromSecretKey(keypair.secretKey);
}

function privateKeyToKeypair(privateKeyBase58: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
}

async function sendSolTransfer(
  connection: Connection,
  from: Keypair,
  toAddress: string,
  lamports: bigint
): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports,
    })
  );
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = from.publicKey;
  tx.sign(from);
  return connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
}

router.get("/distributor/wallet", async (_req, res) => {
  const [wallet] = await db.select().from(distributorWalletTable);
  if (!wallet) {
    res.status(404).json({ error: "No distributor wallet found" });
    return;
  }
  res.json({
    id: wallet.id,
    publicKey: wallet.publicKey,
    hdPath: wallet.hdPath,
    solBalance: wallet.solBalance ?? null,
    createdAt: wallet.createdAt,
  });
});

router.post("/distributor/wallet", async (req, res) => {
  const body = z.object({ password: z.string().min(4) }).parse(req.body);

  const existing = await db.select().from(distributorWalletTable);
  if (existing.length > 0) {
    res.status(409).json({ error: "Distributor wallet already exists" });
    return;
  }

  const mnemonic = bip39.generateMnemonic(256);
  const keypair = mnemonicToKeypair(mnemonic, HD_PATH);
  const encryptedMnemonic = encrypt(mnemonic, body.password);

  const [wallet] = await db
    .insert(distributorWalletTable)
    .values({
      encryptedMnemonic,
      publicKey: keypair.publicKey.toBase58(),
      hdPath: HD_PATH,
    })
    .returning();

  res.status(201).json({
    id: wallet.id,
    publicKey: wallet.publicKey,
    hdPath: wallet.hdPath,
    solBalance: null,
    createdAt: wallet.createdAt,
  });
});

router.post("/distributor/wallet/balance", async (_req, res) => {
  const [wallet] = await db.select().from(distributorWalletTable);
  if (!wallet) {
    res.status(404).json({ error: "No distributor wallet found" });
    return;
  }

  const endpoint = await getRpcEndpoint();
  const connection = new Connection(endpoint, "confirmed");
  const balance = await connection.getBalance(new PublicKey(wallet.publicKey));
  const solBalance = balance / LAMPORTS_PER_SOL;

  const [updated] = await db
    .update(distributorWalletTable)
    .set({ solBalance })
    .returning();

  res.json({
    id: updated.id,
    publicKey: updated.publicKey,
    hdPath: updated.hdPath,
    solBalance: updated.solBalance,
    createdAt: updated.createdAt,
  });
});

router.post("/distributor/send", async (req, res) => {
  const body = z.object({
    password: z.string().min(1),
    accountIds: z.array(z.number()).min(1),
    amountSol: z.number().positive(),
  }).parse(req.body);

  const [wallet] = await db.select().from(distributorWalletTable);
  if (!wallet) {
    res.status(404).json({ error: "No distributor wallet" });
    return;
  }

  let mnemonic: string;
  try {
    mnemonic = decrypt(wallet.encryptedMnemonic, body.password);
  } catch {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  const distributorKeypair = mnemonicToKeypair(mnemonic, wallet.hdPath);
  const endpoint = await getRpcEndpoint();
  const connection = new Connection(endpoint, "confirmed");
  const accounts = await db.select().from(accountsTable).where(inArray(accountsTable.id, body.accountIds));

  const results = await Promise.all(
    accounts.map(async (acc) => {
      try {
        const lamports = solToLamports(body.amountSol);
        const sig = await sendSolTransfer(connection, distributorKeypair, acc.publicKey, lamports);
        return {
          signature: sig,
          fromAddress: distributorKeypair.publicKey.toBase58(),
          toAddress: acc.publicKey,
          amountSol: body.amountSol,
          success: true,
          error: null,
        };
      } catch (err: unknown) {
        return {
          fromAddress: distributorKeypair.publicKey.toBase58(),
          toAddress: acc.publicKey,
          amountSol: body.amountSol,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  res.json(results);
});

router.post("/distributor/collect", async (req, res) => {
  const body = z.object({
    password: z.string().min(1),
    accountIds: z.array(z.number()).min(1),
    leaveRentSol: z.number().optional().default(MIN_RENT_SOL),
  }).parse(req.body);

  const [wallet] = await db.select().from(distributorWalletTable);
  if (!wallet) {
    res.status(404).json({ error: "No distributor wallet" });
    return;
  }

  const endpoint = await getRpcEndpoint();
  const connection = new Connection(endpoint, "confirmed");
  const accounts = await db.select().from(accountsTable).where(inArray(accountsTable.id, body.accountIds));

  const distributorPubkey = new PublicKey(wallet.publicKey);

  const results = await Promise.all(
    accounts.map(async (acc) => {
      try {
        let privateKey: string;
        try {
          privateKey = decrypt(acc.encryptedPrivateKey, body.password);
        } catch {
          return {
            fromAddress: acc.publicKey,
            toAddress: wallet.publicKey,
            amountSol: 0,
            success: false,
            error: "Invalid password for account",
          };
        }

        const accountKeypair = privateKeyToKeypair(privateKey);
        const balance = await connection.getBalance(accountKeypair.publicKey);
        const rentLamports = solToLamports(body.leaveRentSol);
        const feeEstimate = BigInt(5000);
        const sendLamports = BigInt(balance) - rentLamports - feeEstimate;

        if (sendLamports <= BigInt(0)) {
          return {
            fromAddress: acc.publicKey,
            toAddress: wallet.publicKey,
            amountSol: 0,
            success: false,
            error: "Insufficient balance after rent reserve",
          };
        }

        const amountSol = Number(sendLamports) / LAMPORTS_PER_SOL;
        const sig = await sendSolTransfer(connection, accountKeypair, wallet.publicKey, sendLamports);
        return {
          signature: sig,
          fromAddress: acc.publicKey,
          toAddress: wallet.publicKey,
          amountSol,
          success: true,
          error: null,
        };
      } catch (err: unknown) {
        return {
          fromAddress: acc.publicKey,
          toAddress: wallet.publicKey,
          amountSol: 0,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  res.json(results);
});

router.post("/distributor/withdraw", async (req, res) => {
  const body = z.object({
    password: z.string().min(1),
    toAddress: z.string().min(32, "Invalid Solana address"),
    amountSol: z.number().positive("Must be positive"),
  }).parse(req.body);

  const [wallet] = await db.select().from(distributorWalletTable);
  if (!wallet) {
    res.status(404).json({ error: "No distributor wallet" });
    return;
  }

  let mnemonic: string;
  try {
    mnemonic = decrypt(wallet.encryptedMnemonic, body.password);
  } catch {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  const distributorKeypair = mnemonicToKeypair(mnemonic, wallet.hdPath);
  const endpoint = await getRpcEndpoint();
  const connection = new Connection(endpoint, "confirmed");

  const lamports = solToLamports(body.amountSol);
  const sig = await sendSolTransfer(connection, distributorKeypair, body.toAddress, lamports);

  res.json({
    signature: sig,
    fromAddress: distributorKeypair.publicKey.toBase58(),
    toAddress: body.toAddress,
    amountSol: body.amountSol,
    success: true,
  });
});

export default router;
