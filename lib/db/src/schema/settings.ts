import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rpcEndpoint: text("rpc_endpoint").notNull().default("https://api.mainnet-beta.solana.com"),
  heliusApiKey: text("helius_api_key"),
  jupiterApiKey: text("jupiter_api_key"),
  jitoEndpoint: text("jito_endpoint").notNull().default("https://mainnet.block-engine.jito.wtf"),
  defaultSlippageBps: integer("default_slippage_bps").notNull().default(500),
  defaultJitoTipLamports: integer("default_jito_tip_lamports").notNull().default(10000),
  defaultDelayMs: integer("default_delay_ms").notNull().default(0),
  xaiApiKey: text("xai_api_key"),
  socialGateAccounts: text("social_gate_accounts").notNull().default('["WatcherGuru","elonmusk","realDonaldTrump","ansemburner","cobie","CryptoCobain","blknoiz06","MustStopMurad","DegenSpartan","CryptoGodJohn"]'),
  jwtSecret: text("jwt_secret"),
  // License
  licenseKey: text("license_key"),
  licenseInstanceId: text("license_instance_id"),
  licenseStatus: text("license_status").notNull().default("unchecked"), // unchecked | valid | invalid | expired
  licenseExpiresAt: integer("license_expires_at", { mode: "timestamp" }),
  licenseCheckedAt: integer("license_checked_at", { mode: "timestamp" }),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
