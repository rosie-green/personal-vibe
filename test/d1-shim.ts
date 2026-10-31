// A SQLite-backed stand-in for Cloudflare D1, built on Node's built-in node:sqlite.
// It lets the tests run the real SQL migrations and the real services without
// needing a Cloudflare account or wrangler.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { D1Like, D1ResultLike, D1StatementLike } from "../src/worker/db.ts";

type SqlValue = string | number | null;

class Statement implements D1StatementLike {
  private sql: string;
  private params: SqlValue[];
  private raw: DatabaseSync;

  constructor(raw: DatabaseSync, sql: string, params: SqlValue[] = []) {
    this.raw = raw;
    this.sql = sql;
    this.params = params;
  }

  bind(...values: unknown[]): Statement {
    const clean = values.map((v) => {
      if (v === undefined) throw new Error("D1 can't bind undefined; use null");
      if (typeof v === "boolean") throw new Error("D1 can't bind booleans; use 0/1");
      return v as SqlValue;
    });
    return new Statement(this.raw, this.sql, clean);
  }

  async first<T = unknown>(): Promise<T | null> {
    const r = this.raw.prepare(this.sql).get(...this.params);
    return r ? ({ ...r } as T) : null;
  }

  async all<T = unknown>(): Promise<D1ResultLike<T>> {
    const results = this.raw.prepare(this.sql).all(...this.params).map((r) => ({ ...r }) as T);
    return { results, success: true, meta: {} };
  }

  async run(): Promise<D1ResultLike<unknown>> {
    const info = this.raw.prepare(this.sql).run(...this.params);
    return {
      results: [],
      success: true,
      meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) },
    };
  }
}

export interface TestDb {
  db: D1Like;
  raw: DatabaseSync;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Fresh in-memory database with every file in migrations/ applied in order. */
export function createTestDb(): TestDb {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const dir = join(root, "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(join(dir, file), "utf8"));
  }
  const db: D1Like = {
    prepare: (sql) => new Statement(raw, sql),
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const out: D1ResultLike<unknown>[] = [];
        for (const s of statements) out.push(await s.run());
        raw.exec("COMMIT");
        return out;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
  };
  return { db, raw };
}

export function seedSql(): string {
  return readFileSync(join(root, "seed", "seed.sql"), "utf8");
}
