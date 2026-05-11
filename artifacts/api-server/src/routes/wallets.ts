import { Router, type IRouter } from "express";
import { db, walletsTable, accountsTable, distributorWalletTable } from "@workspace/db";
import { eq, count, isNull } from "drizzle-orm";
import { generateNewMnemonic } from "../lib/solana.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import {
  CreateWalletsBody,
  DeleteWalletParams,
} from "@workspace/api-zod";
import { z } from "zod";
import * as bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";
import naclPkg from "tweetnacl";
import bs58 from "bs58";

const nacl = naclPkg;

const router: IRouter = Router();

router.get("/wallets", async (_req, res) => {
  const wallets = await db.select().from(walletsTable).where(isNull(walletsTable.archivedAt));
  const accountCounts = await db
    .select({ walletId: accountsTable.walletId, count: count() })
    .from(accountsTable)
    .groupBy(accountsTable.walletId);

  const countMap = new Map(accountCounts.map((r) => [r.walletId, r.count]));

  res.json(
    wallets.map((w) => ({
      id: w.id,
      name: w.name,
      encryptedMnemonic: w.encryptedMnemonic,
      accountCount: countMap.get(w.id) ?? 0,
      createdAt: w.createdAt,
    }))
  );
});

router.post("/wallets", async (req, res) => {
  const body = CreateWalletsBody.parse(req.body);
  const createdWallets = [];

  for (let i = 0; i < body.count; i++) {
    const mnemonic = generateNewMnemonic();
    const encryptedMnemonic = encrypt(mnemonic, body.password);
    const walletIndex = (await db.select().from(walletsTable)).length + i + 1;
    const name = `Wallet ${walletIndex}`;

    const [wallet] = await db
      .insert(walletsTable)
      .values({ name, encryptedMnemonic })
      .returning();

    createdWallets.push({
      id: wallet.id,
      name: wallet.name,
      encryptedMnemonic: wallet.encryptedMnemonic,
      accountCount: 0,
      createdAt: wallet.createdAt,
    });
  }

  res.status(201).json(createdWallets);
});

router.delete("/wallets/:walletId", async (req, res) => {
  const { walletId } = DeleteWalletParams.parse({ walletId: parseInt(req.params.walletId) });
  // Soft-delete: remove accounts from active lists, preserve mnemonic in archived wallet
  await db.delete(accountsTable).where(eq(accountsTable.walletId, walletId));
  await db.update(walletsTable).set({ archivedAt: new Date() }).where(eq(walletsTable.id, walletId));
  res.json({ success: true, message: "Wallet archived (mnemonic preserved)" });
});

router.post("/wallets/import", async (req, res) => {
  const body = z.object({
    rows: z.array(z.object({ name: z.string().min(1), mnemonic: z.string().min(1) })).min(1).max(200),
    password: z.string().min(4),
  }).parse(req.body);

  const results = [];
  for (const row of body.rows) {
    const mnemonic = row.mnemonic.trim();
    if (!bip39.validateMnemonic(mnemonic)) {
      res.status(400).json({ error: `Invalid mnemonic for "${row.name}": not a valid BIP39 seed phrase` });
      return;
    }
    const encryptedMnemonic = encrypt(mnemonic, body.password);
    const [wallet] = await db.insert(walletsTable).values({ name: row.name, encryptedMnemonic }).returning();
    results.push({ id: wallet.id, name: wallet.name, accountCount: 0, createdAt: wallet.createdAt });
  }
  res.status(201).json(results);
});

router.post("/wallets/export", async (req, res) => {
  const body = z.object({ password: z.string().min(1) }).parse(req.body);

  const wallets = await db.select().from(walletsTable);
  const accounts = await db.select().from(accountsTable);
  const [distributorWallet] = await db.select().from(distributorWalletTable);

  const accountsByWallet = new Map<number, typeof accounts>();
  for (const acc of accounts) {
    const list = accountsByWallet.get(acc.walletId) ?? [];
    list.push(acc);
    accountsByWallet.set(acc.walletId, list);
  }

  const exported = [];

  // ── Distributor wallet first ──────────────────────────────────────────────
  if (distributorWallet) {
    let distMnemonic: string;
    try {
      distMnemonic = decrypt(distributorWallet.encryptedMnemonic, body.password);
    } catch {
      res.status(401).json({ error: "Invalid password for distributor wallet" });
      return;
    }
    let distPrivKey = "[derive failed]";
    try {
      const seed = bip39.mnemonicToSeedSync(distMnemonic);
      const { key } = derivePath(distributorWallet.hdPath, seed.toString("hex"));
      const kp = nacl.sign.keyPair.fromSeed(key);
      distPrivKey = bs58.encode(kp.secretKey);
    } catch { /* leave as placeholder */ }

    exported.push({
      walletId: 0,
      walletName: "DISTRIBUTOR WALLET",
      mnemonic: distMnemonic,
      accounts: [{
        accountId: 0,
        name: "Distributor",
        publicKey: distributorWallet.publicKey,
        privateKeyBase58: distPrivKey,
        hdPath: distributorWallet.hdPath,
        hdIndex: 0,
      }],
    });
  }

  // ── Regular wallets ───────────────────────────────────────────────────────
  for (const wallet of wallets) {
    let mnemonic: string;
    try {
      mnemonic = decrypt(wallet.encryptedMnemonic, body.password);
    } catch {
      res.status(401).json({ error: `Invalid password for wallet "${wallet.name}"` });
      return;
    }

    const walletAccounts = accountsByWallet.get(wallet.id) ?? [];
    const decryptedAccounts = [];
    for (const acc of walletAccounts) {
      let privateKeyBase58: string;
      try {
        privateKeyBase58 = decrypt(acc.encryptedPrivateKey, body.password);
      } catch {
        privateKeyBase58 = "[decrypt failed]";
      }
      decryptedAccounts.push({
        accountId: acc.id,
        name: acc.name,
        publicKey: acc.publicKey,
        privateKeyBase58,
        hdPath: acc.hdPath,
        hdIndex: acc.hdIndex,
      });
    }

    exported.push({
      walletId: wallet.id,
      walletName: wallet.name,
      mnemonic,
      accounts: decryptedAccounts,
    });
  }

  res.json(exported);
});

export default router;
