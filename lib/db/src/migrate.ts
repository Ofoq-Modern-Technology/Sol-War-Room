/**
 * Schema auto-migration — runs CREATE TABLE IF NOT EXISTS for all tables
 * on every startup so fresh databases are initialised automatically.
 *
 * The SQL is embedded as a TypeScript string constant (schema-sql.ts) so it
 * works equally in development (tsx) and inside the standalone pkg binary
 * where no filesystem reads are available.
 *
 * To regenerate after schema changes:
 *   pnpm --filter @workspace/db run generate-schema
 */

import { SCHEMA_SQL } from "./schema-sql";
import type { SqlJsAdapter } from "./sqljs-adapter";

export function runMigrations(adapter: SqlJsAdapter): void {
  const statements = SCHEMA_SQL
    .split(/--> statement-breakpoint/g)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    try {
      adapter.exec(stmt);
    } catch (err) {
      const msg = (err as Error).message ?? "";
      // IF NOT EXISTS should prevent most conflicts, but guard anyway
      if (msg.toLowerCase().includes("already exists")) continue;
      throw err;
    }
  }

  // Column additions for existing databases (safe — silently ignored if already present)
  const alterColumns = [
    "ALTER TABLE settings ADD COLUMN xai_api_key text",
    "ALTER TABLE settings ADD COLUMN social_gate_accounts text",
  ];
  for (const sql of alterColumns) {
    try { adapter.exec(sql); } catch { /* column already exists */ }
  }
}
