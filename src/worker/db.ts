// The tiny slice of Cloudflare's D1 API this app uses. The real `D1Database`
// satisfies it, and so does the SQLite stand-in the tests use, which is why the
// services below can be tested without a Cloudflare account.

export interface D1ResultLike<T = unknown> {
  results: T[];
  success: boolean;
  meta: { last_row_id?: number; changes?: number };
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1ResultLike<T>>;
  run(): Promise<D1ResultLike<unknown>>;
}

export interface D1Like {
  prepare(sql: string): D1StatementLike;
  /** Runs the statements in order inside one transaction. */
  batch(statements: D1StatementLike[]): Promise<D1ResultLike<unknown>[]>;
}

export async function rows<T>(db: D1Like, sql: string, ...params: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<T>();
  return res.results;
}

export async function row<T>(db: D1Like, sql: string, ...params: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}
