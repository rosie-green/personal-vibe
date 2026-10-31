// Calendar-day helpers. A "date" is always a 'YYYY-MM-DD' string for a local
// calendar day chosen by the browser. Nothing here depends on the server's
// timezone: we only ever do arithmetic in UTC on the date parts.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = MONTH_RE.exec(value);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

function toUtc(date: string): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUtc(dt: Date): string {
  const y = String(dt.getUTCFullYear()).padStart(4, "0");
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Add (or subtract) whole days. Works across month/year boundaries and DST. */
export function addDays(date: string, days: number): string {
  const dt = toUtc(date);
  dt.setUTCDate(dt.getUTCDate() + Math.round(days));
  return fromUtc(dt);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** 0 = Monday ... 6 = Sunday (UK-style week). */
export function weekdayMondayFirst(date: string): number {
  return (toUtc(date).getUTCDay() + 6) % 7;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, delta: number): string {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Invalid month: ${month}`);
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  const y = Math.floor(idx / 12);
  const mo = (idx % 12) + 1;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}`;
}

export function firstDayOfMonth(month: string): string {
  return `${month}-01`;
}

export function daysInMonth(month: string): number {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Invalid month: ${month}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

/** Every date in a month, in order. */
export function datesInMonth(month: string): string[] {
  const n = daysInMonth(month);
  const out: string[] = [];
  for (let d = 1; d <= n; d++) out.push(`${month}-${String(d).padStart(2, "0")}`);
  return out;
}

/** True if `date` is on or between `from` and `to` (to = null means open ended). */
export function inRange(date: string, from: string, to: string | null): boolean {
  return date >= from && (to === null || date <= to);
}
