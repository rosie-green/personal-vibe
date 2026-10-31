// Browser-side date helpers. "Today" is the user's local calendar day.

/**
 * If you're often up past midnight and want "today" to roll over later, set this
 * to e.g. 4 and the new day starts at 4am instead of midnight.
 */
export const DAY_STARTS_AT_HOUR = 0;

const pad = (n: number) => String(n).padStart(2, "0");

export function todayLocal(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - DAY_STARTS_AT_HOUR * 3_600_000);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

const long = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export const formatLong = (date: string) => long.format(utcDate(date));
export const formatShort = (date: string) => short.format(utcDate(date));
export const formatMonth = (month: string) => monthLong.format(utcDate(`${month}-01`));
