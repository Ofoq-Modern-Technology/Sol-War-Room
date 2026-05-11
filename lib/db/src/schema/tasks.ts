import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const tasksTable = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  type: text("type").notNull(), // "dca_buy" | "exit_sell" | "limit_buy"
  label: text("label").notNull(),
  status: text("status").notNull().default("pending"), // "pending" | "running" | "completed" | "failed" | "cancelled"

  mintAddress: text("mint_address").notNull(),
  accountIds: text("account_ids").notNull(), // JSON: number[]
  password: text("password").notNull(),       // stored so tasks run unattended
  slippageBps: integer("slippage_bps").notNull().default(1500),

  // ── DCA Buy ───────────────────────────────────────────────────────────────
  dcaAmountSol: real("dca_amount_sol"),        // SOL per cycle per account
  dcaIntervalSec: integer("dca_interval_sec"), // seconds between cycles
  dcaRoundsTotal: integer("dca_rounds_total"), // total cycles to run
  dcaRoundsDone: integer("dca_rounds_done").notNull().default(0),

  // ── Exit Sell / Limit Buy ─────────────────────────────────────────────────
  triggerPriceUsd: real("trigger_price_usd"),   // price that triggers action
  triggerCondition: text("trigger_condition"),   // "above" | "below"
  sellPct: real("sell_pct"),                     // % of token balance to sell

  // ── Execution state ───────────────────────────────────────────────────────
  nextRunAt: integer("next_run_at"),    // Unix ms — when DCA runs next
  lastRunAt: integer("last_run_at"),    // Unix ms — last execution
  lastResult: text("last_result"),      // JSON summary of last run
  errorMessage: text("error_message"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export type Task = typeof tasksTable.$inferSelect;
export type InsertTask = typeof tasksTable.$inferInsert;
