/**
 * sql.js → better-sqlite3 compatibility shim
 *
 * Makes a sql.js Database look like a better-sqlite3 Database so the
 * existing drizzle-orm/better-sqlite3 driver works without changes.
 */

import type { Database as SqlJsDatabase, QueryExecResult } from "sql.js";
import { writeFileSync } from "fs";

type Row = Record<string, unknown>;

function buildRow(columns: string[], values: unknown[]): Row {
  const row: Row = {};
  for (let i = 0; i < columns.length; i++) row[columns[i]] = values[i];
  return row;
}

function normalizeBindValues(bindValues: unknown[]): unknown[] | Record<string, unknown> {
  if (bindValues.length === 0) return [];
  if (
    bindValues.length === 1 &&
    typeof bindValues[0] === "object" &&
    bindValues[0] !== null &&
    !Array.isArray(bindValues[0])
  ) {
    return bindValues[0] as Record<string, unknown>;
  }
  return bindValues as unknown[];
}

class SqlJsStatement {
  private readonly _sql: string;
  private readonly _db: SqlJsDatabase;
  private readonly _onWrite: () => void;

  constructor(sql: string, db: SqlJsDatabase, onWrite: () => void) {
    this._sql = sql;
    this._db = db;
    this._onWrite = onWrite;
  }

  run(...bindValues: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const params = normalizeBindValues(bindValues);
    const stmt = this._db.prepare(this._sql);
    stmt.run(params as unknown[]);
    stmt.free();
    this._onWrite();
    const changes = this._db.getRowsModified();
    const lastInsertRowid = this._getLastInsertRowid();
    return { changes, lastInsertRowid };
  }

  get(...bindValues: unknown[]): Row | undefined {
    const params = normalizeBindValues(bindValues);
    const stmt = this._db.prepare(this._sql);
    stmt.bind(params as unknown[]);
    if (!stmt.step()) {
      stmt.free();
      return undefined;
    }
    const columns = stmt.getColumnNames();
    const values = stmt.get();
    stmt.free();
    return buildRow(columns, values as unknown[]);
  }

  all(...bindValues: unknown[]): Row[] {
    const params = normalizeBindValues(bindValues);
    const stmt = this._db.prepare(this._sql);
    stmt.bind(params as unknown[]);
    const rows: Row[] = [];
    while (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      rows.push(buildRow(columns, values as unknown[]));
    }
    stmt.free();
    return rows;
  }

  *iterate(...bindValues: unknown[]): IterableIterator<Row> {
    const params = normalizeBindValues(bindValues);
    const stmt = this._db.prepare(this._sql);
    stmt.bind(params as unknown[]);
    while (stmt.step()) {
      const columns = stmt.getColumnNames();
      const values = stmt.get();
      yield buildRow(columns, values as unknown[]);
    }
    stmt.free();
  }

  columns(): Array<{ name: string; column: string | null; table: string | null; database: string | null; type: string | null }> {
    const stmt = this._db.prepare(this._sql);
    const names = stmt.getColumnNames();
    stmt.free();
    return names.map((name: string) => ({ name, column: null, table: null, database: null, type: null }));
  }

  safeIntegers(_toggle: boolean): this {
    return this;
  }

  /**
   * Returns a "raw" variant of this statement whose `all()` returns rows
   * as ordered arrays instead of plain objects — this is what Drizzle's
   * better-sqlite3 session calls when building result sets.
   */
  raw(): { all: (...bindValues: unknown[]) => unknown[][] } {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      all(...bindValues: unknown[]): unknown[][] {
        const params = normalizeBindValues(bindValues);
        const stmt = self._db.prepare(self._sql);
        stmt.bind(params as unknown[]);
        const rows: unknown[][] = [];
        while (stmt.step()) {
          rows.push(stmt.get() as unknown[]);
        }
        stmt.free();
        return rows;
      },
    };
  }

  private _getLastInsertRowid(): number {
    const r: QueryExecResult[] = this._db.exec("SELECT last_insert_rowid()");
    if (!r.length || !r[0].values.length) return 0;
    return r[0].values[0][0] as number;
  }
}

export class SqlJsAdapter {
  private readonly _db: SqlJsDatabase;
  private readonly _onWrite: () => void;

  constructor(db: SqlJsDatabase, onWrite: () => void) {
    this._db = db;
    this._onWrite = onWrite;
  }

  prepare(sql: string): SqlJsStatement {
    return new SqlJsStatement(sql, this._db, this._onWrite);
  }

  exec(sql: string): this {
    this._db.exec(sql);
    return this;
  }

  pragma(setting: string): unknown {
    const r = this._db.exec(`PRAGMA ${setting}`);
    if (!r.length) return undefined;
    return r[0].values.map((row) => {
      const obj: Record<string, unknown> = {};
      r[0].columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }

  transaction<T>(fn: (db: this) => T): (args?: unknown) => T {
    return (args?: unknown) => {
      this._db.exec("BEGIN");
      try {
        const result = fn.call(this, args as never);
        this._db.exec("COMMIT");
        this._onWrite();
        return result;
      } catch (err) {
        this._db.exec("ROLLBACK");
        throw err;
      }
    };
  }

  close(): void {
    this._db.close();
  }

  export(): Uint8Array {
    return this._db.export();
  }
}

export type { SqlJsAdapter as BetterSQLite3Compatible };
