import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const arbConfigsTable = sqliteTable("arb_configs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  accountId: integer("account_id").notNull(),
  mintAddress: text("mint_address").notNull(),
  tokenSymbol: text("token_symbol"),
  inputAmountSol: real("input_amount_sol").notNull(),
  minProfitSol: real("min_profit_sol").notNull().default(0.001),
  jitoTipLamports: integer("jito_tip_lamports").notNull().default(10000),
  scanIntervalMs: integer("scan_interval_ms").notNull().default(5000),
  slippageBps: integer("slippage_bps").notNull().default(100),
  targetDexes: text("target_dexes").notNull().default('["Raydium","Raydium CLMM","Orca","Whirlpool","Meteora DLMM","Pump.fun AMM"]'),
  status: text("status").notNull().default("idle"),
  totalArbs: integer("total_arbs").notNull().default(0),
  totalProfitSol: real("total_profit_sol").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp" }),
  stoppedAt: integer("stopped_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const arbLogsTable = sqliteTable("arb_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  configId: integer("config_id").notNull(),
  type: text("type").notNull(),
  inputSol: real("input_sol").notNull(),
  outputSol: real("output_sol"),
  profitSol: real("profit_sol"),
  status: text("status").notNull(),
  buyDex: text("buy_dex"),
  sellDex: text("sell_dex"),
  buyTxSignature: text("buy_tx_signature"),
  sellTxSignature: text("sell_tx_signature"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});

export const insertArbConfigSchema = createInsertSchema(arbConfigsTable).omit({ id: true, createdAt: true });
export type InsertArbConfig = z.infer<typeof insertArbConfigSchema>;
export type ArbConfig = typeof arbConfigsTable.$inferSelect;

export const insertArbLogSchema = createInsertSchema(arbLogsTable).omit({ id: true, createdAt: true });
export type InsertArbLog = z.infer<typeof insertArbLogSchema>;
export type ArbLog = typeof arbLogsTable.$inferSelect;
