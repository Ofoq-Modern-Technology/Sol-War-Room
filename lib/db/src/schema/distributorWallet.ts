import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const distributorWalletTable = sqliteTable("distributor_wallet", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  encryptedMnemonic: text("encrypted_mnemonic").notNull(),
  publicKey: text("public_key").notNull(),
  hdPath: text("hd_path").notNull().default("m/44'/501'/0'/0'"),
  solBalance: real("sol_balance"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertDistributorWalletSchema = createInsertSchema(distributorWalletTable).omit({ id: true, createdAt: true });
export type InsertDistributorWallet = z.infer<typeof insertDistributorWalletSchema>;
export type DistributorWallet = typeof distributorWalletTable.$inferSelect;
