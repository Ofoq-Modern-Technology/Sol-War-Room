import { Router, type IRouter } from "express";
import { db, transactionsTable, accountsTable, walletsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { ListTransactionsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/transactions", async (req, res) => {
  const query = ListTransactionsQueryParams.parse(req.query);

  const accounts = await db.select().from(accountsTable);
  const wallets = await db.select().from(walletsTable);
  const walletMap = new Map(wallets.map((w) => [w.id, w.name]));
  const accountMap = new Map(accounts.map((a) => [a.id, { name: a.name, walletId: a.walletId }]));

  let txQuery = db.select().from(transactionsTable).$dynamic();

  if (query.accountId) {
    txQuery = txQuery.where(eq(transactionsTable.accountId, query.accountId));
  }

  const limit = query.limit ?? 50;
  const transactions = await txQuery.orderBy(desc(transactionsTable.createdAt)).limit(limit);

  res.json(
    transactions.map((tx) => {
      const acc = accountMap.get(tx.accountId);
      const walletName = acc ? (walletMap.get(acc.walletId) ?? "Unknown") : "Unknown";
      return {
        id: tx.id,
        accountId: tx.accountId,
        accountName: acc?.name ?? "Unknown",
        walletName,
        type: tx.type as "buy" | "sell" | "volume",
        mintAddress: tx.mintAddress,
        tokenSymbol: tx.tokenSymbol ?? null,
        status: tx.status as "success" | "failed" | "pending",
        txSignature: tx.txSignature ?? null,
        amountIn: tx.amountIn ?? null,
        amountOut: tx.amountOut ?? null,
        error: tx.error ?? null,
        createdAt: tx.createdAt,
      };
    })
  );
});

export default router;
