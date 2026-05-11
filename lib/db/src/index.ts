import { drizzle } from "drizzle-orm/better-sqlite3";
import initSqlJs from "sql.js";
import { createRequire } from "module";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import * as schema from "./schema";
import { SqlJsAdapter } from "./sqljs-adapter";
import { runMigrations } from "./migrate";

const dbPath =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "solwarroom.db");

let _db: ReturnType<typeof drizzle> | null = null;
let _adapter: SqlJsAdapter | null = null;

// Deferred-flush: coalesce all writes in a single event-loop tick → one disk write
let _dirty = false;
function scheduleFlush() {
  if (_dirty) return;
  _dirty = true;
  setImmediate(() => {
    _dirty = false;
    if (_adapter) writeFileSync(dbPath, Buffer.from(_adapter.export()));
  });
}

/** Resolve the sql.js WASM file for the current environment. */
function locateSqlWasm(file: string): string {
  // ── Production "node server.cjs" path ─────────────────────────────────────
  // build.ts copies sql-wasm.wasm alongside server.cjs.
  if (process.argv[1]) {
    const nearby = path.join(path.dirname(process.argv[1]), file);
    if (existsSync(nearby)) return nearby;
  }
  const cwd = path.join(process.cwd(), file);
  if (existsSync(cwd)) return cwd;

  // ── Development (tsx/ESM) ─────────────────────────────────────────────────
  // import.meta.url is a real URL in ESM; undefined in esbuild CJS output
  try {
    const req = createRequire(import.meta.url);
    return path.join(path.dirname(req.resolve("sql.js")), file);
  } catch {
    return path.join(process.cwd(), file);
  }
}

export async function initDb(): Promise<ReturnType<typeof drizzle>> {
  // ── Embedded WASM (standalone binary / single-file server.cjs) ───────────
  // build.ts base64-encodes the WASM and prepends it to server.cjs as
  //   globalThis.__SQLJS_WASM_B64__ = "<base64>";
  // This removes the need for a separate sql-wasm.wasm file entirely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const embeddedB64: string | undefined = (globalThis as any).__SQLJS_WASM_B64__;
  const wasmBinary = embeddedB64 ? Buffer.from(embeddedB64, "base64") : undefined;

  const SQL = await initSqlJs(
    wasmBinary ? { wasmBinary } : { locateFile: locateSqlWasm },
  );

  const rawDb = existsSync(dbPath)
    ? new SQL.Database(readFileSync(dbPath))
    : new SQL.Database();

  _adapter = new SqlJsAdapter(rawDb, scheduleFlush);
  _adapter.exec("PRAGMA foreign_keys = ON");

  // Auto-create all tables on fresh databases (first boot, standalone binary)
  runMigrations(_adapter);

  // Persist on clean shutdown / OS signals
  const flush = () => {
    if (_adapter) writeFileSync(dbPath, Buffer.from(_adapter.export()));
  };
  process.once("exit", flush);
  process.once("SIGTERM", () => { flush(); process.exit(0); });
  process.once("SIGINT", () => { flush(); process.exit(0); });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _db = drizzle(_adapter as any, { schema });
  return _db;
}

// Transparent proxy so `import { db } from "@workspace/db"` works unchanged
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    if (!_db) throw new Error("[db] Not initialised — call initDb() first.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (_db as any)[prop];
  },
  has(_target, prop) {
    return _db ? prop in (_db as object) : false;
  },
});

export * from "./schema";
