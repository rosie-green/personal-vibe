import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildMonth } from "../src/core/calendar.ts";
import { activeTasksOn, doneByDate, scoreDay, totalStars } from "../src/core/stars.ts";

const A = { id: 1, active_from: "2026-10-01", active_to: null };
const B = { id: 2, active_from: "2026-10-01", active_to: "2026-10-10" };

describe("scoreDay", () => {
  test("one star per task plus a bonus for a fully completed day", () => {
    assert.deepEqual(scoreDay("2026-10-01", [1, 2], new Set([1, 2])), {
      date: "2026-10-01",
      total: 2,
      done: 2,
      complete: true,
      stars: 3,
    });
  });

  test("partial day gets no bonus", () => {
    const s = scoreDay("2026-10-01", [1, 2], new Set([1]));
    assert.equal(s.stars, 1);
    assert.equal(s.complete, false);
  });

  test("nothing done earns nothing", () => {
    assert.equal(scoreDay("2026-10-01", [1, 2], new Set()).stars, 0);
  });

  test("a day with no tasks is never 'complete' and earns nothing", () => {
    const s = scoreDay("2026-10-01", [], new Set());
    assert.equal(s.complete, false);
    assert.equal(s.stars, 0);
  });

  test("completions of tasks that aren't active that day are ignored", () => {
    // task 3 isn't in the active list, so it can't add to `done`
    assert.equal(scoreDay("2026-10-01", [1], new Set([1, 3])).done, 1);
  });
});

describe("totalStars", () => {
  test("adds up across days, honouring each task's active window", () => {
    const completions = [
      { task_id: 1, date: "2026-10-01" },
      { task_id: 2, date: "2026-10-01" }, // full day: 2 + 1 bonus = 3
      { task_id: 1, date: "2026-10-02" }, // partial: B not done = 1
      { task_id: 1, date: "2026-10-11" }, // B retired, so A alone is a full day: 1 + 1 = 2
      { task_id: 2, date: "2026-10-11" }, // B wasn't active on the 11th: ignored
    ];
    assert.equal(totalStars([A, B], completions), 6);
  });

  test("undoing a completion removes its star and the bonus", () => {
    const full = [
      { task_id: 1, date: "2026-10-01" },
      { task_id: 2, date: "2026-10-01" },
    ];
    assert.equal(totalStars([A, B], full), 3);
    assert.equal(totalStars([A, B], full.slice(0, 1)), 1);
  });

  test("adding a task later doesn't change past days", () => {
    const completions = [
      { task_id: 1, date: "2026-10-02" },
      { task_id: 2, date: "2026-10-02" },
    ];
    const before = totalStars([A, B], completions);
    const C = { id: 3, active_from: "2026-10-20", active_to: null };
    assert.equal(totalStars([A, B, C], completions), before);
  });

  test("activeTasksOn", () => {
    assert.deepEqual(
      activeTasksOn([A, B], "2026-10-11").map((t) => t.id),
      [1],
    );
    assert.deepEqual(
      activeTasksOn([A, B], "2026-09-30").map((t) => t.id),
      [],
    );
  });

  test("doneByDate drops completions outside the window", () => {
    const m = doneByDate([A, B], [
      { task_id: 2, date: "2026-10-11" },
      { task_id: 1, date: "2026-10-11" },
      { task_id: 99, date: "2026-10-11" },
    ]);
    assert.deepEqual([...(m.get("2026-10-11") ?? [])], [1]);
  });
});

describe("buildMonth", () => {
  const completions = [
    { task_id: 1, date: "2026-10-01" },
    { task_id: 2, date: "2026-10-01" },
    { task_id: 1, date: "2026-10-02" },
    { task_id: 1, date: "2026-10-12" },
  ];
  const month = buildMonth("2026-10", [A, B], completions);

  test("has one entry per day", () => {
    assert.equal(month.days.length, 31);
    assert.equal(month.days[0]?.date, "2026-10-01");
  });

  test("per-day totals use each day's active tasks", () => {
    const d = (n: number) => month.days[n - 1]!;
    assert.equal(d(1).total, 2);
    assert.equal(d(1).complete, true);
    assert.equal(d(2).done, 1);
    assert.equal(d(2).complete, false);
    assert.equal(d(12).total, 1); // B retired after the 10th
    assert.equal(d(12).complete, true);
    assert.equal(d(20).total, 1);
    assert.equal(d(20).done, 0);
  });

  test("month totals", () => {
    assert.equal(month.stars, 3 + 1 + 2);
    assert.equal(month.completeDays, 2);
    assert.equal(month.trackedDays, 31);
  });

  test("days before any task existed are untracked", () => {
    const m = buildMonth("2026-09", [A, B], completions);
    assert.equal(m.trackedDays, 0);
    assert.equal(m.stars, 0);
  });

  test("retiring a task later doesn't change an earlier month", () => {
    const before = buildMonth("2026-10", [A, { ...B, active_to: null }], completions).days.slice(0, 10);
    const after = buildMonth("2026-10", [A, B], completions).days.slice(0, 10);
    assert.deepEqual(after, before);
  });
});
