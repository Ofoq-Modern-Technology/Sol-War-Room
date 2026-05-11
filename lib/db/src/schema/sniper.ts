import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sniperConfigsTable = sqliteTable("sniper_configs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  accountIds: text("account_ids").notNull().default("[]"),
  solPerAccount: real("sol_per_account").notNull().default(0.1),
  maxBuySlippageBps: integer("max_buy_slippage_bps").notNull().default(1500),
  minLiquiditySol: real("min_liquidity_sol").notNull().default(1.0),
  exitStrategy: text("exit_strategy").notNull().default("timer"),
  exitTimerSeconds: integer("exit_timer_seconds").notNull().default(300),
  exitMultiplier: real("exit_multiplier").notNull().default(2.0),
  useJito: integer("use_jito", { mode: "boolean" }).notNull().default(true),
  jitoTipLamports: integer("jito_tip_lamports").notNull().default(100000),
  targetDexes: text("target_dexes").notNull().default('["raydium","raydium_cpmm","pumpfun"]'),
  maxSnipesPerPool: integer("max_snipes_per_pool").notNull().default(1),
  enableSocialGate: integer("enable_social_gate", { mode: "boolean" }).notNull().default(false),
  enableCtoBuy: integer("enable_cto_buy", { mode: "boolean" }).notNull().default(false),
  buyMode: text("buy_mode").notNull().default("fixed"),
  buyPercent: real("buy_percent").notNull().default(90),
  stopLossPct: real("stop_loss_pct").notNull().default(20),
  status: text("status").notNull().default("idle"),
  totalSnipes: integer("total_snipes").notNull().default(0),
  totalPnlSol: real("total_pnl_sol").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const sniperTradesTable = sqliteTable("sniper_trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  configId: integer("config_id").notNull(),
  mintAddress: text("mint_address").notNull(),
  tokenSymbol: text("token_symbol"),
  tokenName: text("token_name"),
  dex: text("dex").notNull(),
  accountId: integer("account_id").notNull(),
  solSpent: real("sol_spent").notNull(),
  tokensReceived: real("tokens_received"),
  solReceived: real("sol_received"),
  pnlSol: real("pnl_sol"),
  status: text("status").notNull().default("pending"),
  buyTxSignature: text("buy_tx_signature"),
  sellTxSignature: text("sell_tx_signature"),
  error: text("error"),
  detectedAt: integer("detected_at", { mode: "timestamp" }).notNull(),
  boughtAt: integer("bought_at", { mode: "timestamp" }),
  soldAt: integer("sold_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const tokenRadarTable = sqliteTable("token_radar", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mintAddress: text("mint_address").notNull(),
  dex: text("dex").notNull(),
  signature: text("signature").notNull(),
  tokenName: text("token_name"),
  tokenSymbol: text("token_symbol"),
  tokenUri: text("token_uri"),
  isGraduation: integer("is_graduation", { mode: "boolean" }).notNull().default(false),
  poolAddress: text("pool_address"),
  detectedAt: integer("detected_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export type TokenRadar = typeof tokenRadarTable.$inferSelect;

export const insertSniperConfigSchema = createInsertSchema(sniperConfigsTable).omit({ id: true, createdAt: true });
export type InsertSniperConfig = z.infer<typeof insertSniperConfigSchema>;
export type SniperConfig = typeof sniperConfigsTable.$inferSelect;

export const insertSniperTradeSchema = createInsertSchema(sniperTradesTable).omit({ id: true, createdAt: true });
export type InsertSniperTrade = z.infer<typeof insertSniperTradeSchema>;
export type SniperTrade = typeof sniperTradesTable.$inferSelect;
