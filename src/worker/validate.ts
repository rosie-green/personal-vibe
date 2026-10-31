// Small, dependency-free request validation. Every function either returns a
// clean value or throws an HttpError(400) with a message safe to show the user.

import { isValidDate, isValidMonth } from "../core/dates.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export type Body = Record<string, unknown>;

export function asBody(value: unknown): Body {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Expected a JSON object");
  }
  return value as Body;
}

export const has = (b: Body, key: string): boolean => Object.prototype.hasOwnProperty.call(b, key);

const bad = (key: string, why: string) => new HttpError(400, `"${key}" ${why}`);

export function reqString(b: Body, key: string, max = 200): string {
  const v = b[key];
  if (typeof v !== "string" || v.trim() === "") throw bad(key, "is required");
  const s = v.trim();
  if (s.length > max) throw bad(key, `must be at most ${max} characters`);
  return s;
}

/** Absent -> undefined. null or blank -> null. Otherwise the trimmed string. */
export function optString(b: Body, key: string, max = 500): string | null | undefined {
  if (!has(b, key) || b[key] === undefined) return undefined;
  const v = b[key];
  if (v === null) return null;
  if (typeof v !== "string") throw bad(key, "must be text");
  const s = v.trim();
  if (s === "") return null;
  if (s.length > max) throw bad(key, `must be at most ${max} characters`);
  return s;
}

export function reqNumber(b: Body, key: string, min: number, max: number): number {
  const v = b[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw bad(key, "must be a number");
  if (v < min || v > max) throw bad(key, `must be between ${min} and ${max}`);
  return v;
}

export function reqInt(b: Body, key: string, min: number, max: number): number {
  const v = reqNumber(b, key, min, max);
  if (!Number.isInteger(v)) throw bad(key, "must be a whole number");
  return v;
}

/** Absent -> undefined. null -> null. Otherwise a whole number in range. */
export function optInt(b: Body, key: string, min: number, max: number): number | null | undefined {
  if (!has(b, key) || b[key] === undefined) return undefined;
  if (b[key] === null) return null;
  return reqInt(b, key, min, max);
}

export function optBool(b: Body, key: string): boolean | undefined {
  if (!has(b, key) || b[key] === undefined) return undefined;
  if (typeof b[key] !== "boolean") throw bad(key, "must be true or false");
  return b[key] as boolean;
}

export function reqEnum<T extends string>(b: Body, key: string, allowed: readonly T[]): T {
  const v = b[key];
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw bad(key, `must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}

export function reqDate(value: unknown, key = "date"): string {
  if (!isValidDate(value)) throw bad(key, "must be a date like 2026-10-31");
  return value;
}

/** Absent -> undefined. null -> null. Otherwise a valid date string. */
export function optDate(b: Body, key: string): string | null | undefined {
  if (!has(b, key) || b[key] === undefined) return undefined;
  if (b[key] === null) return null;
  return reqDate(b[key], key);
}

export function reqMonth(value: unknown, key = "month"): string {
  if (!isValidMonth(value)) throw bad(key, "must be a month like 2026-10");
  return value;
}

export function reqId(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, "Not found");
  return n;
}
