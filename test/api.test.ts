// End-to-end tests of the API: real request handler, real SQL migrations,
// SQLite standing in for D1.

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { handle } from "../src/worker/index.ts";
import type { Env } from "../src/worker/index.ts";
import { makeSession, sessionCookie } from "../src/worker/session.ts";
import type { CalendarView, DayView, MedicationView, Task } from "../src/shared/types.ts";
import { NOTE_MARKDOWN_LIMIT } from "../src/shared/notes.ts";
import type { Note } from "../src/shared/notes.ts";
import { createTestDb, seedSql } from "./d1-shim.ts";
import type { TestDb } from "./d1-shim.ts";

const NOW_ISO = "2026-10-31T12:00:00.000Z";
const deps = { nowIso: NOW_ISO, nowSec: Math.floor(Date.parse(NOW_ISO) / 1000) };
const APP_PASSWORD = "test-password";
const cookie = sessionCookie(await makeSession(APP_PASSWORD, deps.nowSec)).split(";")[0]!;

let t: TestDb;
let env: Env;

beforeEach(() => {
  t = createTestDb();
  env = { DB: t.db, APP_PASSWORD };
});

function signedInRequest(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("cookie", cookie);
  return new Request(`http://app.test${path}`, { ...init, headers });
}

async function call<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: T }> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await handle(signedInRequest(path, init), env, deps);
  return { status: res.status, data: (await res.json()) as T };
}

const mkTask = async (name: string, over: Record<string, unknown> = {}) =>
  (await call<Task>("POST", "/api/tasks", { name, active_from: "2026-10-01", ...over })).data;

describe("notes", () => {
  test("requires a signed-in session", async () => {
    const response = await handle(new Request("http://app.test/api/notes"), env, deps);
    assert.equal(response.status, 401);
  });

  test("create, list, edit and delete a note while preserving Markdown whitespace", async () => {
    const markdown = "    indented code\n\nA hard break  \nOn the next line\n";
    const created = await call<Note>("POST", "/api/notes", { title: "  Journal  ", markdown });
    assert.equal(created.status, 201);
    assert.deepEqual(created.data, { id: 1, title: "Journal", markdown, updated_at: NOW_ISO });
    assert.deepEqual((await call("GET", "/api/notes")).data, [created.data]);

    const path = `/api/notes/${created.data.id}`;
    const edited = await call<Note>("PUT", path, { title: "Journal entry", markdown: "" });
    assert.equal(edited.status, 200);
    assert.deepEqual((await call("GET", "/api/notes")).data, [{ ...created.data, title: "Journal entry", markdown: "" }]);

    assert.equal((await call("DELETE", path)).status, 200);
    assert.deepEqual((await call("GET", "/api/notes")).data, []);
    assert.equal((await call("PUT", path, { title: "Missing", markdown })).status, 404);
    assert.equal((await call("DELETE", path)).status, 404);
  });

  test("validates title and Markdown", async () => {
    assert.equal((await call("POST", "/api/notes", { title: " ", markdown: "" })).status, 400);
    assert.equal((await call("POST", "/api/notes", { title: "Journal", markdown: 1 })).status, 400);
    assert.equal((await call("POST", "/api/notes", { title: "Journal", markdown: "a".repeat(NOTE_MARKDOWN_LIMIT + 1) })).status, 400);
  });
});

describe("tasks and the daily flow", () => {
  test("empty day", async () => {
    const r = await call<DayView>("GET", "/api/day?date=2026-10-31");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.tasks, []);
    assert.equal(r.data.stars, 0);
    assert.equal(r.data.totalStars, 0);
  });

  test("create tasks, complete them, earn stars, undo", async () => {
    const a = await mkTask("Estrogen", { time_of_day: "morning" });
    const b = await mkTask("Teeth brushing", { time_of_day: "evening", reminder_text: "Don't forget to brush your teeth." });
    assert.equal(b.reminder_text, "Don't forget to brush your teeth.");
    assert.equal(b.sort_order > a.sort_order, true);

    let day = (await call<DayView>("GET", "/api/day?date=2026-10-31")).data;
    assert.deepEqual(day.tasks.map((x) => [x.name, x.done]), [["Estrogen", false], ["Teeth brushing", false]]);

    day = (await call<DayView>("PUT", "/api/completions", { task_id: a.id, date: "2026-10-31", done: true })).data;
    assert.equal(day.done, 1);
    assert.equal(day.stars, 1);
    assert.equal(day.totalStars, 1);
    assert.equal(day.tasks[0]!.completed_at, NOW_ISO);

    // ticking twice is harmless
    day = (await call<DayView>("PUT", "/api/completions", { task_id: a.id, date: "2026-10-31", done: true })).data;
    assert.equal(day.totalStars, 1);

    day = (await call<DayView>("PUT", "/api/completions", { task_id: b.id, date: "2026-10-31", done: true })).data;
    assert.equal(day.complete, true);
    assert.equal(day.stars, 3); // 2 + bonus
    assert.equal(day.totalStars, 3);

    day = (await call<DayView>("PUT", "/api/completions", { task_id: b.id, date: "2026-10-31", done: false })).data;
    assert.equal(day.complete, false);
    assert.equal(day.totalStars, 1);
  });

  test("can't complete a task on a day it isn't active, or in the future", async () => {
    const a = await mkTask("Estrogen");
    const before = await call("PUT", "/api/completions", { task_id: a.id, date: "2026-09-30", done: true });
    assert.equal(before.status, 400);
    const future = await call("PUT", "/api/completions", { task_id: a.id, date: "2026-11-05", done: true });
    assert.equal(future.status, 400);
    // a date that is "tomorrow" in UTC is allowed (it can be today for someone far east)
    const tomorrow = await call("PUT", "/api/completions", { task_id: a.id, date: "2026-11-01", done: true });
    assert.equal(tomorrow.status, 200);
    const missing = await call("PUT", "/api/completions", { task_id: 999, date: "2026-10-31", done: true });
    assert.equal(missing.status, 404);
  });

  test("backfilling a past day works", async () => {
    const a = await mkTask("Estrogen");
    const r = await call<DayView>("PUT", "/api/completions", { task_id: a.id, date: "2026-10-05", done: true });
    assert.equal(r.status, 200);
    assert.equal(r.data.date, "2026-10-05");
    assert.equal(r.data.totalStars, 2);
  });

  test("retiring a task keeps history and removes it from later days", async () => {
    const a = await mkTask("Estrogen");
    const b = await mkTask("Vitamin D");
    await call("PUT", "/api/completions", { task_id: b.id, date: "2026-10-10", done: true });
    const patched = await call<Task>("PATCH", `/api/tasks/${b.id}`, { active_to: "2026-10-15" });
    assert.equal(patched.data.active_to, "2026-10-15");

    const early = (await call<DayView>("GET", "/api/day?date=2026-10-10")).data;
    assert.equal(early.tasks.length, 2);
    const late = (await call<DayView>("GET", "/api/day?date=2026-10-20")).data;
    assert.deepEqual(late.tasks.map((x) => x.name), ["Estrogen"]);

    const blocked = await call("PUT", "/api/completions", { task_id: b.id, date: "2026-10-20", done: true });
    assert.equal(blocked.status, 400);

    // restore
    const restored = await call<Task>("PATCH", `/api/tasks/${b.id}`, { active_to: null });
    assert.equal(restored.data.active_to, null);
    assert.equal(a.id !== b.id, true);
  });

  test("a task can be created linked to a medicine (used when restoring a retired task)", async () => {
    const med = (
      await call<MedicationView>("POST", "/api/medications", {
        name: "Example",
        pack_size: 10,
        dose_amount: 1,
        effective_from: "2026-10-01",
        create_task: { time_of_day: "morning" },
      })
    ).data;
    const original = med.linkedTaskIds[0]!;
    await call("PUT", "/api/completions", { task_id: original, date: "2026-10-05", done: true });
    await call("PATCH", `/api/tasks/${original}`, { active_to: "2026-10-10" });

    const copy = await call<Task>("POST", "/api/tasks", {
      name: "Example",
      active_from: "2026-10-20",
      medication_id: med.id,
    });
    assert.equal(copy.status, 201);
    assert.equal(copy.data.medication_id, med.id);

    // Days in between aren't suddenly counted as missed.
    const gap = (await call<DayView>("GET", "/api/day?date=2026-10-15")).data;
    assert.equal(gap.total, 0);
    // Stock now counts both tasks' history but only the active one for the daily rate.
    const view = (await call<MedicationView>("GET", `/api/medications/${med.id}?date=2026-10-21`)).data;
    assert.equal(view.linkedTaskIds.length, 2);
    assert.equal(view.stock.dosesPerDay, 1);

    const bad = await call("POST", "/api/tasks", { name: "x", active_from: "2026-10-01", medication_id: 999 });
    assert.equal(bad.status, 400);
  });

  test("can't retire a task before it started", async () => {
    const a = await mkTask("Estrogen");
    const r = await call("PATCH", `/api/tasks/${a.id}`, { active_to: "2026-09-01" });
    assert.equal(r.status, 400);
  });

  test("edit name, time of day and texts; blank text clears it", async () => {
    const a = await mkTask("Estrogen", { reminder_text: "hello" });
    const r = await call<Task>("PATCH", `/api/tasks/${a.id}`, {
      name: "Estrogen gel",
      time_of_day: "evening",
      reminder_text: "  ",
      done_text: "Done!",
    });
    assert.equal(r.data.name, "Estrogen gel");
    assert.equal(r.data.time_of_day, "evening");
    assert.equal(r.data.reminder_text, null);
    assert.equal(r.data.done_text, "Done!");
  });

  test("delete only works for tasks with no history", async () => {
    const a = await mkTask("Mistake");
    const b = await mkTask("Real");
    await call("PUT", "/api/completions", { task_id: b.id, date: "2026-10-31", done: true });
    assert.equal((await call("DELETE", `/api/tasks/${b.id}`)).status, 409);
    assert.equal((await call("DELETE", `/api/tasks/${a.id}`)).status, 200);
    assert.equal((await call<Task[]>("GET", "/api/tasks")).data.length, 1);
  });

  test("calendar and stars across a month, unaffected by tasks added later", async () => {
    const a = await mkTask("Estrogen");
    const b = await mkTask("Teeth");
    for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
      await call("PUT", "/api/completions", { task_id: a.id, date: d, done: true });
    }
    await call("PUT", "/api/completions", { task_id: b.id, date: "2026-10-01", done: true });

    const c = (await call<CalendarView>("GET", "/api/calendar?month=2026-10")).data;
    assert.equal(c.days.length, 31);
    assert.deepEqual(
      c.days.slice(0, 3).map((d) => [d.total, d.done, d.complete]),
      [[2, 2, true], [2, 1, false], [2, 1, false]],
    );
    assert.equal(c.stars, 3 + 1 + 1);
    assert.equal(c.completeDays, 1);
    assert.equal(c.totalStars, 5);

    await mkTask("New thing", { active_from: "2026-10-20" });
    const after = (await call<CalendarView>("GET", "/api/calendar?month=2026-10")).data;
    assert.deepEqual(after.days.slice(0, 19), c.days.slice(0, 19));
    assert.equal(after.days[19]!.total, 3);

    const september = (await call<CalendarView>("GET", "/api/calendar?month=2026-09")).data;
    assert.equal(september.trackedDays, 0);
  });
});

describe("request handling", () => {
  test("validation errors are 400 with a readable message", async () => {
    const r = await call<{ error: string }>("POST", "/api/tasks", { active_from: "2026-10-01" });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /name/);
    assert.equal((await call("GET", "/api/day?date=nonsense")).status, 400);
    assert.equal((await call("GET", "/api/day")).status, 400);
    assert.equal((await call("GET", "/api/calendar?month=2026-13")).status, 400);
    assert.equal((await call("POST", "/api/tasks", { name: "x", active_from: "2026-02-30" })).status, 400);
    assert.equal((await call("POST", "/api/tasks", { name: "x", active_from: "2026-10-01", time_of_day: "noon" })).status, 400);
    assert.equal((await call("PUT", "/api/completions", { task_id: 1, date: "2026-10-31", done: "yes" })).status, 400);
    assert.equal((await call("POST", "/api/tasks", [1, 2])).status, 400);
  });

  test("writes must be JSON (blocks cross-site form posts)", async () => {
    const res = await handle(
      signedInRequest("/api/tasks", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ name: "x", active_from: "2026-10-01" }),
      }),
      env,
      deps,
    );
    assert.equal(res.status, 415);
    const res2 = await handle(
      signedInRequest("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" }),
      env,
      deps,
    );
    assert.equal(res2.status, 400);
  });

  test("unknown route is 404, wrong method is 405, bad ids are 404", async () => {
    assert.equal((await call("GET", "/api/nope")).status, 404);
    assert.equal((await call("DELETE", "/api/day")).status, 405);
    assert.equal((await call("PATCH", "/api/tasks/abc", { name: "x" })).status, 404);
    assert.equal((await call("PATCH", "/api/tasks/999", { name: "x" })).status, 404);
  });

  test("API responses are never cached", async () => {
    const res = await handle(signedInRequest("/api/health"), env, deps);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  test("non-API paths fall through to static assets", async () => {
    let asked = "";
    const withAssets: Env = {
      ...env,
      ASSETS: {
        fetch: async (req) => {
          asked = new URL(req.url).pathname;
          return new Response("<html></html>", { headers: { "content-type": "text/html" } });
        },
      },
    };
    const res = await handle(signedInRequest("/calendar"), withAssets, deps);
    assert.equal(asked, "/calendar");
    assert.equal(res.headers.get("content-type"), "text/html");
    const noAssets = await handle(signedInRequest("/calendar"), env, deps);
    assert.equal(noAssets.status, 404);
  });
});

describe("medicines", () => {
  const estrogen = {
    name: "Estrogen",
    pack_size: 64,
    pack_label: "tube",
    dose_amount: 4,
    order_cover_days: 90,
    auto_supplied: true,
    effective_from: "2026-10-01",
    create_task: { time_of_day: "morning" },
  };

  test("create a medicine with a linked daily task", async () => {
    const r = await call<MedicationView>("POST", "/api/medications", estrogen);
    assert.equal(r.status, 201);
    assert.equal(r.data.name, "Estrogen");
    assert.equal(r.data.auto_supplied, true);
    assert.equal(r.data.currentDose?.amount, 4);
    assert.equal(r.data.linkedTaskIds.length, 1);
    assert.equal(r.data.stock.tracking, false);
    assert.equal(r.data.stock.suggestedPacks, 6);

    const tasks = (await call<Task[]>("GET", "/api/tasks")).data;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.medication_id, r.data.id);
    assert.equal(tasks[0]!.time_of_day, "morning");
    assert.equal(tasks[0]!.name, "Estrogen");
  });

  test("deliveries in packs, completions use up doses, recounts reset", async () => {
    const med = (await call<MedicationView>("POST", "/api/medications", estrogen)).data;
    const taskId = med.linkedTaskIds[0]!;

    let r = await call<MedicationView>("POST", `/api/medications/${med.id}/stock?date=2026-10-10`, {
      kind: "delivery",
      packs: 6,
      date: "2026-10-01",
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.stock.onHandDoses, 384);
    assert.equal(r.data.stock.onHandPacks, 6);

    for (let d = 1; d <= 10; d++) {
      const date = `2026-10-${String(d).padStart(2, "0")}`;
      await call("PUT", "/api/completions", { task_id: taskId, date, done: true });
    }
    r = await call<MedicationView>("GET", `/api/medications/${med.id}?date=2026-10-10`);
    assert.equal(r.data.stock.onHandDoses, 344);
    assert.equal(r.data.stock.daysLeft, 86);
    assert.equal(r.data.stock.reorderDue, false); // auto supplied

    // un-ticking a day gives its doses back
    await call("PUT", "/api/completions", { task_id: taskId, date: "2026-10-10", done: false });
    r = await call<MedicationView>("GET", `/api/medications/${med.id}?date=2026-10-10`);
    assert.equal(r.data.stock.onHandDoses, 348);

    r = await call<MedicationView>("POST", `/api/medications/${med.id}/stock?date=2026-10-10`, {
      kind: "recount",
      doses: 300,
      date: "2026-10-10",
    });
    assert.equal(r.data.stock.onHandDoses, 300);
    assert.equal(r.data.stock.lastCountDate, "2026-10-10");
    assert.equal(r.data.recentEvents[0]!.kind, "recount");
  });

  test("changing dose only affects days from the new date", async () => {
    const med = (await call<MedicationView>("POST", "/api/medications", estrogen)).data;
    const taskId = med.linkedTaskIds[0]!;
    await call("POST", `/api/medications/${med.id}/stock?date=2026-10-12`, { kind: "delivery", doses: 400, date: "2026-10-01" });
    for (const d of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]) {
      await call("PUT", "/api/completions", { task_id: taskId, date: d, done: true });
    }
    const r = await call<MedicationView>("POST", `/api/medications/${med.id}/dose?date=2026-10-06`, {
      amount: 5,
      effective_from: "2026-10-06",
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.currentDose?.amount, 5);
    for (const d of ["2026-10-06", "2026-10-07"]) {
      await call("PUT", "/api/completions", { task_id: taskId, date: d, done: true });
    }
    const after = (await call<MedicationView>("GET", `/api/medications/${med.id}?date=2026-10-07`)).data;
    assert.equal(after.stock.onHandDoses, 400 - 5 * 4 - 2 * 5);
    assert.equal(after.stock.dosesPerDay, 5);
  });

  test("NHS medicine alerts a week out", async () => {
    const med = (
      await call<MedicationView>("POST", "/api/medications", {
        name: "Example tablets",
        pack_size: 28,
        pack_label: "box",
        dose_amount: 2,
        reorder_lead_days: 7,
        order_cover_days: 28,
        effective_from: "2026-10-01",
        create_task: { time_of_day: "morning" },
      })
    ).data;
    const taskId = med.linkedTaskIds[0]!;
    await call("POST", `/api/medications/${med.id}/stock?date=2026-10-31`, { kind: "delivery", packs: 2, date: "2026-10-01" });
    for (let d = 1; d <= 21; d++) {
      await call("PUT", "/api/completions", { task_id: taskId, date: `2026-10-${String(d).padStart(2, "0")}`, done: true });
    }
    const r = (await call<MedicationView>("GET", `/api/medications/${med.id}?date=2026-10-21`)).data;
    assert.equal(r.stock.onHandDoses, 14);
    assert.equal(r.stock.daysLeft, 7);
    assert.equal(r.stock.reorderDue, true);
    assert.equal(r.stock.suggestedPacks, 2);
  });

  test("edit settings, remove a mistaken entry, validate input", async () => {
    const med = (await call<MedicationView>("POST", "/api/medications", estrogen)).data;
    const patched = await call<MedicationView>("PATCH", `/api/medications/${med.id}?date=2026-10-31`, {
      auto_supplied: false,
      reorder_lead_days: 30,
      notes: "  ",
    });
    assert.equal(patched.data.auto_supplied, false);
    assert.equal(patched.data.reorder_lead_days, 30);
    assert.equal(patched.data.notes, null);
    assert.equal(patched.data.pack_size, 64); // untouched

    const added = await call<MedicationView>("POST", `/api/medications/${med.id}/stock?date=2026-10-31`, {
      kind: "delivery",
      doses: 64,
      date: "2026-10-31",
    });
    const eventId = added.data.recentEvents[0]!.id;
    const removed = await call<MedicationView>("DELETE", `/api/medications/${med.id}/stock/${eventId}?date=2026-10-31`);
    assert.equal(removed.data.stock.tracking, false);
    assert.equal((await call("DELETE", `/api/medications/${med.id}/stock/${eventId}?date=2026-10-31`)).status, 404);

    const stock = (b: object) => call("POST", `/api/medications/${med.id}/stock?date=2026-10-31`, b);
    assert.equal((await stock({ kind: "delivery", doses: -5, date: "2026-10-31" })).status, 400);
    assert.equal((await stock({ kind: "recount", doses: -1, date: "2026-10-31" })).status, 400);
    assert.equal((await stock({ kind: "adjustment", doses: 0, date: "2026-10-31" })).status, 400);
    assert.equal((await stock({ kind: "delivery", doses: 5, date: "2026-12-31" })).status, 400);
    assert.equal((await stock({ kind: "bogus", doses: 5, date: "2026-10-31" })).status, 400);
    assert.equal((await stock({ kind: "delivery", date: "2026-10-31" })).status, 400);
    assert.equal(
      (await call("POST", "/api/medications", { ...estrogen, pack_size: 0 })).status,
      400,
    );
    assert.equal((await call("POST", "/api/medications", { ...estrogen, dose_amount: -1 })).status, 400);
    assert.equal((await call("GET", "/api/medications/999?date=2026-10-31")).status, 404);
  });

  test("a failed create leaves nothing behind", async () => {
    // A bad linked-task date can't happen through validation, so force a failure in the DB layer.
    t.raw.exec("CREATE TRIGGER block_tasks BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT, 'nope'); END;");
    const realError = console.error;
    console.error = () => {}; // the handler logs unexpected errors; keep the test output quiet
    let r;
    try {
      r = await call("POST", "/api/medications", estrogen);
    } finally {
      console.error = realError;
    }
    assert.equal(r.status, 500);
    const list = (await call<MedicationView[]>("GET", "/api/medications?date=2026-10-31")).data;
    assert.deepEqual(list, []);
  });

  test("a medicine with no task can't count doses, and says so", async () => {
    const r = await call<MedicationView>("POST", "/api/medications", {
      name: "Manual",
      pack_size: 10,
      dose_amount: 1,
      effective_from: "2026-10-01",
    });
    assert.equal(r.data.linkedTaskIds.length, 0);
    assert.equal(r.data.stock.consumptionTracked, false);
    assert.equal(r.data.pack_label, "pack");
    assert.equal(r.data.unit, "dose");
  });
});

describe("seed data", () => {
  test("seed.sql loads and gives a working app", async () => {
    t.raw.exec(seedSql());
    const day = (await call<DayView>("GET", "/api/day?date=2099-01-01")).data;
    assert.equal(day.tasks.length, 2);
    const names = day.tasks.map((x) => x.name);
    assert.deepEqual(names, ["Estrogen", "Teeth brushing"]);
    assert.match(day.tasks[0]!.done_text ?? "", /Good job on doing your estrogen today!\n\nCheck back tomorrow\./);

    const meds = (await call<MedicationView[]>("GET", "/api/medications?date=2099-01-01")).data;
    assert.equal(meds.length, 1);
    assert.equal(meds[0]!.name, "Estrogen");
    assert.equal(meds[0]!.auto_supplied, true);
    assert.equal(meds[0]!.pack_size, 64);
    assert.equal(meds[0]!.currentDose?.amount, 4);
    assert.equal(meds[0]!.stock.dosesPerDay, 4); // seed links the estrogen task: 1 task x 4 doses
    assert.equal(meds[0]!.stock.suggestedPacks, 6);
  });
});
