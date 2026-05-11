import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  walletId: integer("wallet_id").notNull(),
  name: text("name").notNull(),
  publicKey: text("public_key").notNull().unique(),
  encryptedPrivateKey: text("encrypted_private_key").notNull(),
  hdPath: text("hd_path").notNull(),
  hdIndex: integer("hd_index").notNull(),
  solBalance: real("sol_balance"),
  selected: integer("selected", { mode: "boolean" }).default(false).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertAccountSchema = createInsertSchema(accountsTable).omit({ id: true, createdAt: true });
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;
