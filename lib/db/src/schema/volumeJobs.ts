import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const volumeJobsTable = sqliteTable("volume_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mintAddress: text("mint_address").notNull(),
  tokenSymbol: text("token_symbol"),
  accountIds: text("account_ids").notNull(),
  status: text("status").notNull().default("running"),
  pattern: text("pattern").notNull().default("random"),
  minAmountSol: real("min_amount_sol").notNull(),
  maxAmountSol: real("max_amount_sol").notNull(),
  minDelayMs: integer("min_delay_ms").notNull(),
  maxDelayMs: integer("max_delay_ms").notNull(),
  totalDurationMinutes: integer("total_duration_minutes").notNull(),
  slippageBps: integer("slippage_bps").notNull().default(500),
  useJito: integer("use_jito", { mode: "boolean" }).notNull().default(true),
  jitoTipLamports: integer("jito_tip_lamports").notNull().default(10000),
  encryptedPassword: text("encrypted_password"),
  totalTrades: integer("total_trades").notNull().default(0),
  successfulTrades: integer("successful_trades").notNull().default(0),
  failedTrades: integer("failed_trades").notNull().default(0),
  totalVolumeSol: real("total_volume_sol").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  stoppedAt: integer("stopped_at", { mode: "timestamp" }),
  endsAt: integer("ends_at", { mode: "timestamp" }),
});

export const insertVolumeJobSchema = createInsertSchema(volumeJobsTable).omit({ id: true, startedAt: true });
export type InsertVolumeJob = z.infer<typeof insertVolumeJobSchema>;
export type VolumeJob = typeof volumeJobsTable.$inferSelect;
