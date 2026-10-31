import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays } from "../src/core/dates.ts";
import { computeStock, scheduleOn, suggestPacks } from "../src/medicine/stock.ts";
import type { StockInput } from "../src/medicine/stock.ts";

/** Completions on every date from `from` to `to` inclusive. */
function daily(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const task = { active_from: "2026-10-01", active_to: null };

const estrogen = { pack_size: 64, reorder_lead_days: null, order_cover_days: 90, auto_supplied: true };
const nhs = { pack_size: 28, reorder_lead_days: 7, order_cover_days: 28, auto_supplied: false };

function input(over: Partial<StockInput>): StockInput {
  return {
    medication: nhs,
    schedules: [{ effective_from: "2026-10-01", amount: 2, every_n_days: 1 }],
    events: [],
    completionDates: [],
    linkedTasks: [task],
    asOf: "2026-10-10",
    ...over,
  };
}

describe("scheduleOn", () => {
  const s = [
    { effective_from: "2026-10-01", amount: 2, every_n_days: 1 },
    { effective_from: "2026-10-10", amount: 3, every_n_days: 1 },
  ];
  test("picks the latest schedule that has started", () => {
    assert.equal(scheduleOn(s, "2026-09-30"), null);
    assert.equal(scheduleOn(s, "2026-10-09")?.amount, 2);
    assert.equal(scheduleOn(s, "2026-10-10")?.amount, 3);
    assert.equal(scheduleOn(s, "2027-01-01")?.amount, 3);
  });
});

describe("estrogen: 64 doses per tube, 4 doses a day", () => {
  const base = input({
    medication: estrogen,
    schedules: [{ effective_from: "2026-10-01", amount: 4, every_n_days: 1 }],
    events: [{ date: "2026-10-01", kind: "delivery", doses: 6 * 64 }],
    completionDates: daily("2026-10-01", "2026-10-10"),
  });
  const s = computeStock(base);

  test("stock and days left", () => {
    assert.equal(s.onHandDoses, 384 - 40);
    assert.equal(s.onHandPacks, 5.4);
    assert.equal(s.dosesPerDay, 4);
    assert.equal(s.daysLeft, 86);
    assert.equal(s.runsOutOn, "2027-01-04");
  });

  test("auto-supplied: never asks you to reorder", () => {
    // 92 days x 4 doses = 368 used, 16 doses left = 4 days: well inside any reorder window
    const low = computeStock({ ...base, completionDates: daily("2026-10-01", "2026-12-31"), asOf: "2026-12-31" });
    assert.equal(low.daysLeft, 4);
    assert.equal(low.reorderDue, false);
    assert.equal(low.orderByDate, null);
  });

  test("suggests 6 tubes for a 90 day supply", () => {
    assert.equal(s.suggestedPacks, 6);
    assert.equal(s.suggestedPacksCoverDays, 90);
  });
});

describe("NHS medicine: reorder with 7 days left", () => {
  const events = [{ date: "2026-10-01", kind: "delivery" as const, doses: 56 }];

  test("not due at 8 days left, with an order-by date for tomorrow", () => {
    const s = computeStock(input({ events, completionDates: daily("2026-10-01", "2026-10-20"), asOf: "2026-10-20" }));
    assert.equal(s.onHandDoses, 16);
    assert.equal(s.daysLeft, 8);
    assert.equal(s.reorderDue, false);
    assert.equal(s.orderByDate, "2026-10-21");
  });

  test("due at exactly 7 days left", () => {
    const s = computeStock(input({ events, completionDates: daily("2026-10-01", "2026-10-21"), asOf: "2026-10-21" }));
    assert.equal(s.daysLeft, 7);
    assert.equal(s.reorderDue, true);
    assert.equal(s.orderByDate, "2026-10-21");
  });

  test("still due (order-by is today) when well below 7 days", () => {
    const s = computeStock(input({ events, completionDates: daily("2026-10-01", "2026-10-26"), asOf: "2026-10-26" }));
    assert.equal(s.daysLeft, 2);
    assert.equal(s.reorderDue, true);
    assert.equal(s.orderByDate, "2026-10-26");
  });

  test("suggests packs covering order_cover_days", () => {
    const s = computeStock(input({ events, asOf: "2026-10-01" }));
    assert.equal(s.suggestedPacks, 2); // 28 days x 2 doses = 56 doses = 2 packs of 28
  });

  test("no lead time configured means no alert", () => {
    const s = computeStock(
      input({
        medication: { ...nhs, reorder_lead_days: null },
        events,
        completionDates: daily("2026-10-01", "2026-10-27"),
        asOf: "2026-10-27",
      }),
    );
    assert.equal(s.reorderDue, false);
  });
});

describe("changing dose", () => {
  test("only affects days from the new effective date", () => {
    const s = computeStock(
      input({
        schedules: [
          { effective_from: "2026-10-01", amount: 2, every_n_days: 1 },
          { effective_from: "2026-10-10", amount: 3, every_n_days: 1 },
        ],
        events: [{ date: "2026-10-01", kind: "delivery", doses: 100 }],
        completionDates: daily("2026-10-01", "2026-10-12"),
        asOf: "2026-10-12",
      }),
    );
    // 9 days x 2 + 3 days x 3 = 27
    assert.equal(s.onHandDoses, 73);
    assert.equal(s.dosesPerDay, 3);
    assert.equal(s.daysLeft, 24.3);
  });

  test("a dose change is retroactive-safe: future schedules don't touch today's total", () => {
    const withFuture = computeStock(
      input({
        schedules: [
          { effective_from: "2026-10-01", amount: 2, every_n_days: 1 },
          { effective_from: "2026-11-01", amount: 99, every_n_days: 1 },
        ],
        events: [{ date: "2026-10-01", kind: "delivery", doses: 100 }],
        completionDates: daily("2026-10-01", "2026-10-05"),
        asOf: "2026-10-05",
      }),
    );
    assert.equal(withFuture.onHandDoses, 90);
    assert.equal(withFuture.dosesPerDay, 2);
  });

  test("two linked tasks share the daily usage (e.g. morning and evening halves)", () => {
    const s = computeStock(
      input({
        schedules: [{ effective_from: "2026-10-01", amount: 1, every_n_days: 1 }],
        linkedTasks: [task, task],
        events: [{ date: "2026-10-01", kind: "delivery", doses: 60 }],
        completionDates: [...daily("2026-10-01", "2026-10-05"), ...daily("2026-10-01", "2026-10-05")],
        asOf: "2026-10-05",
      }),
    );
    assert.equal(s.dosesPerDay, 2);
    assert.equal(s.onHandDoses, 50);
    assert.equal(s.daysLeft, 25);
  });
});

describe("recounts", () => {
  const events = [
    { id: 1, date: "2026-10-01", kind: "delivery" as const, doses: 100 },
    { id: 2, date: "2026-10-05", kind: "recount" as const, doses: 80 },
  ];

  test("a recount replaces the running total; only later days count after it", () => {
    const s = computeStock(input({ events, completionDates: daily("2026-10-01", "2026-10-07"), asOf: "2026-10-07" }));
    // 80 at the end of the 5th, minus the 6th and 7th (2 doses each)
    assert.equal(s.onHandDoses, 76);
    assert.equal(s.lastCountDate, "2026-10-05");
  });

  test("deliveries after the recount are added, same-day ones are assumed to be in the count", () => {
    const s = computeStock(
      input({
        events: [
          ...events,
          { id: 3, date: "2026-10-05", kind: "delivery", doses: 999 }, // same day as the recount: already counted
          { id: 4, date: "2026-10-06", kind: "delivery", doses: 30 },
        ],
        completionDates: daily("2026-10-01", "2026-10-07"),
        asOf: "2026-10-07",
      }),
    );
    assert.equal(s.onHandDoses, 106);
  });

  test("the latest recount wins", () => {
    const s = computeStock(
      input({
        events: [...events, { id: 3, date: "2026-10-08", kind: "recount", doses: 50 }],
        completionDates: daily("2026-10-01", "2026-10-09"),
        asOf: "2026-10-09",
      }),
    );
    assert.equal(s.onHandDoses, 48);
  });

  test("a recount of zero is allowed and reads as empty", () => {
    const s = computeStock(
      input({ events: [{ id: 1, date: "2026-10-05", kind: "recount", doses: 0 }], asOf: "2026-10-05" }),
    );
    assert.equal(s.onHandDoses, 0);
    assert.equal(s.daysLeft, 0);
    assert.equal(s.reorderDue, true);
  });

  test("adjustments are signed", () => {
    const s = computeStock(
      input({
        events: [
          { id: 1, date: "2026-10-01", kind: "delivery", doses: 100 },
          { id: 2, date: "2026-10-02", kind: "adjustment", doses: -5 }, // spilled some
          { id: 3, date: "2026-10-03", kind: "adjustment", doses: 3 }, // found some
        ],
        asOf: "2026-10-03",
      }),
    );
    assert.equal(s.onHandDoses, 98);
  });
});

describe("edge cases", () => {
  test("nothing logged yet means not tracking, but usage is still reported", () => {
    const s = computeStock(input({}));
    assert.equal(s.tracking, false);
    assert.equal(s.onHandDoses, null);
    assert.equal(s.daysLeft, null);
    assert.equal(s.reorderDue, false);
    assert.equal(s.dosesPerDay, 2);
  });

  test("running out clamps at zero and flags the log as incomplete", () => {
    const s = computeStock(
      input({
        events: [{ date: "2026-10-01", kind: "delivery", doses: 10 }],
        completionDates: daily("2026-10-01", "2026-10-10"),
      }),
    );
    assert.equal(s.onHandDoses, 0);
    assert.equal(s.clamped, true);
    assert.equal(s.reorderDue, true);
  });

  test("with no linked task doses can't be counted, so no days-left estimate", () => {
    const s = computeStock(
      input({ linkedTasks: [], events: [{ date: "2026-10-01", kind: "delivery", doses: 50 }], asOf: "2026-10-10" }),
    );
    assert.equal(s.consumptionTracked, false);
    assert.equal(s.onHandDoses, 50);
    assert.equal(s.daysLeft, null);
    assert.equal(s.dosesPerDay, null);
    assert.equal(s.reorderDue, false);
  });

  test("a retired linked task stops contributing to daily usage", () => {
    const s = computeStock(
      input({
        linkedTasks: [{ active_from: "2026-10-01", active_to: "2026-10-05" }],
        events: [{ date: "2026-10-01", kind: "delivery", doses: 50 }],
        completionDates: daily("2026-10-01", "2026-10-05"),
        asOf: "2026-10-10",
      }),
    );
    assert.equal(s.onHandDoses, 40);
    assert.equal(s.dosesPerDay, null);
    assert.equal(s.daysLeft, null);
  });

  test("events and completions after asOf are ignored", () => {
    const s = computeStock(
      input({
        events: [
          { date: "2026-10-01", kind: "delivery", doses: 100 },
          { date: "2026-10-20", kind: "delivery", doses: 500 },
        ],
        completionDates: [...daily("2026-10-01", "2026-10-03"), "2026-10-15"],
        asOf: "2026-10-03",
      }),
    );
    assert.equal(s.onHandDoses, 94);
  });

  test("completions before any dose schedule existed use no stock", () => {
    const s = computeStock(
      input({
        schedules: [{ effective_from: "2026-10-05", amount: 2, every_n_days: 1 }],
        events: [{ date: "2026-10-01", kind: "delivery", doses: 100 }],
        completionDates: ["2026-10-02", "2026-10-06"],
        asOf: "2026-10-06",
      }),
    );
    assert.equal(s.onHandDoses, 98);
  });

  test("dose every N days lowers the daily rate used for days left", () => {
    const s = computeStock(
      input({
        schedules: [{ effective_from: "2026-10-01", amount: 1, every_n_days: 4 }],
        events: [{ date: "2026-10-01", kind: "delivery", doses: 10 }],
        asOf: "2026-10-01",
      }),
    );
    assert.equal(s.dosesPerDay, 0.25);
    assert.equal(s.daysLeft, 40);
  });
});

describe("suggestPacks", () => {
  test("rounds up to whole packs", () => {
    assert.equal(suggestPacks(estrogen, 4), 6); // 360 doses / 64 = 5.6
  });
  test("an exact multiple isn't rounded up a pack", () => {
    assert.equal(suggestPacks({ ...estrogen, order_cover_days: 96 }, 4), 6); // 384 / 64 = 6
  });
  test("null without usage or a cover period", () => {
    assert.equal(suggestPacks(estrogen, null), null);
    assert.equal(suggestPacks({ ...estrogen, order_cover_days: null }, 4), null);
  });
});
