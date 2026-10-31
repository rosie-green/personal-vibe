import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addDays,
  addMonths,
  datesInMonth,
  daysBetween,
  daysInMonth,
  inRange,
  isValidDate,
  isValidMonth,
  weekdayMondayFirst,
} from "../src/core/dates.ts";

describe("dates", () => {
  test("isValidDate accepts real calendar days only", () => {
    assert.equal(isValidDate("2026-10-31"), true);
    assert.equal(isValidDate("2028-02-29"), true); // leap year
    assert.equal(isValidDate("2026-02-29"), false);
    assert.equal(isValidDate("2026-13-01"), false);
    assert.equal(isValidDate("2026-04-31"), false);
    assert.equal(isValidDate("2026-1-1"), false);
    assert.equal(isValidDate("20261031"), false);
    assert.equal(isValidDate(20261031), false);
    assert.equal(isValidDate(null), false);
  });

  test("isValidMonth", () => {
    assert.equal(isValidMonth("2026-10"), true);
    assert.equal(isValidMonth("2026-00"), false);
    assert.equal(isValidMonth("2026-13"), false);
    assert.equal(isValidMonth("2026-1"), false);
  });

  test("addDays crosses month, year and leap boundaries", () => {
    assert.equal(addDays("2026-10-31", 1), "2026-11-01");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addDays("2027-02-28", 1), "2027-03-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addDays("2026-10-31", 0), "2026-10-31");
  });

  test("addDays is unaffected by daylight saving changes", () => {
    // UK clocks go back on 2026-10-25 and forward on 2026-03-29.
    assert.equal(addDays("2026-10-24", 1), "2026-10-25");
    assert.equal(addDays("2026-10-25", 1), "2026-10-26");
    assert.equal(addDays("2026-03-28", 2), "2026-03-30");
  });

  test("daysBetween", () => {
    assert.equal(daysBetween("2026-10-01", "2026-10-31"), 30);
    assert.equal(daysBetween("2026-10-31", "2026-10-01"), -30);
    assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2); // across DST change
  });

  test("weekdayMondayFirst", () => {
    assert.equal(weekdayMondayFirst("2026-10-26"), 0); // Monday
    assert.equal(weekdayMondayFirst("2026-10-31"), 5); // Saturday
    assert.equal(weekdayMondayFirst("2026-11-01"), 6); // Sunday
  });

  test("months", () => {
    assert.equal(addMonths("2026-12", 1), "2027-01");
    assert.equal(addMonths("2026-01", -1), "2025-12");
    assert.equal(addMonths("2026-10", 0), "2026-10");
    assert.equal(addMonths("2026-10", 15), "2028-01");
    assert.equal(daysInMonth("2028-02"), 29);
    assert.equal(daysInMonth("2026-02"), 28);
    assert.equal(daysInMonth("2026-10"), 31);
    const oct = datesInMonth("2026-10");
    assert.equal(oct.length, 31);
    assert.equal(oct[0], "2026-10-01");
    assert.equal(oct[30], "2026-10-31");
  });

  test("inRange is inclusive on both ends and open ended with null", () => {
    assert.equal(inRange("2026-10-05", "2026-10-05", "2026-10-10"), true);
    assert.equal(inRange("2026-10-10", "2026-10-05", "2026-10-10"), true);
    assert.equal(inRange("2026-10-11", "2026-10-05", "2026-10-10"), false);
    assert.equal(inRange("2026-10-04", "2026-10-05", null), false);
    assert.equal(inRange("2030-01-01", "2026-10-05", null), true);
  });
});
