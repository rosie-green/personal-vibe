// Cloudflare Worker entry point: a small JSON API under /api/*.
// Everything else (the React app) is served by Workers Static Assets.

import { getCalendar, getDayView, setCompletion } from "./days.ts";
import type { D1Like } from "./db.ts";
import {
  addStockEvent,
  createMedication,
  deleteStockEvent,
  getMedicationView,
  listMedicationViews,
  setDose,
  updateMedication,
} from "./medicines.ts";
import { Router } from "./router.ts";
import { createNote, deleteNote, listNotes, readNote, updateNote } from "./notes.ts";
import { createTask, deleteTask, listTasks, updateTask } from "./tasks.ts";
import {
  HttpError,
  asBody,
  has,
  optBool,
  optDate,
  optInt,
  optString,
  reqDate,
  reqEnum,
  reqId,
  reqInt,
  reqMonth,
  reqNumber,
  reqString,
} from "./validate.ts";
import type { Body } from "./validate.ts";
import type { TaskPatch } from "./tasks.ts";
import type { MedicationPatch } from "./medicines.ts";
import { loginPage, makeSession, passwordMatches, sessionCookie, validSession } from "./session.ts";

export interface Env {
  DB: D1Like;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  APP_PASSWORD?: string;
}

export interface Deps {
  nowSec: number;
  nowIso: string;
}

interface Ctx {
  request: Request;
  env: Env;
  url: URL;
  deps: Deps;
  body(): Promise<Body>;
}

const TIMES = ["morning", "evening", "any"] as const;
const KINDS = ["delivery", "adjustment", "recount"] as const;
const MAX_BODY_BYTES = 32 * 1024;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const router = new Router<Ctx>();

router.post("/api/login", async (c) => {
  const password = c.env.APP_PASSWORD;
  if (!password) throw new HttpError(503, "Login is not configured");
  const body = await c.body();
  if (typeof body.password !== "string" || !(await passwordMatches(body.password, password))) {
    throw new HttpError(401, "Incorrect password");
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": sessionCookie(await makeSession(password)),
    },
  });
});

// --- days, stars, calendar -------------------------------------------------

router.get("/api/day", async (c) => json(await getDayView(c.env.DB, reqDate(c.url.searchParams.get("date")))));

router.put("/api/completions", async (c) => {
  const b = await c.body();
  const taskId = reqInt(b, "task_id", 1, Number.MAX_SAFE_INTEGER);
  const date = reqDate(b.date);
  if (typeof b.done !== "boolean") throw new HttpError(400, '"done" must be true or false');
  return json(await setCompletion(c.env.DB, taskId, date, b.done, c.deps.nowIso));
});

router.get("/api/calendar", async (c) => json(await getCalendar(c.env.DB, reqMonth(c.url.searchParams.get("month")))));

// --- tasks -------------------------------------------------------------------

router.get("/api/tasks", async (c) => json(await listTasks(c.env.DB)));

router.post("/api/tasks", async (c) => {
  const b = await c.body();
  const task = await createTask(c.env.DB, {
    name: reqString(b, "name", 80),
    time_of_day: has(b, "time_of_day") ? reqEnum(b, "time_of_day", TIMES) : "any",
    reminder_text: optString(b, "reminder_text", 300) ?? null,
    done_text: optString(b, "done_text", 300) ?? null,
    medication_id: optInt(b, "medication_id", 1, Number.MAX_SAFE_INTEGER) ?? null,
    active_from: reqDate(b.active_from, "active_from"),
  });
  return json(task, 201);
});

router.patch("/api/tasks/:id", async (c, p) => {
  const b = await c.body();
  const patch: TaskPatch = {};
  if (has(b, "name")) patch.name = reqString(b, "name", 80);
  if (has(b, "time_of_day")) patch.time_of_day = reqEnum(b, "time_of_day", TIMES);
  const reminder = optString(b, "reminder_text", 300);
  if (reminder !== undefined) patch.reminder_text = reminder;
  const done = optString(b, "done_text", 300);
  if (done !== undefined) patch.done_text = done;
  const activeTo = optDate(b, "active_to");
  if (activeTo !== undefined) patch.active_to = activeTo;
  return json(await updateTask(c.env.DB, reqId(p.id!), patch));
});

router.delete("/api/tasks/:id", async (c, p) => {
  await deleteTask(c.env.DB, reqId(p.id!));
  return json({ ok: true });
});

// --- notes --------------------------------------------------------------------

router.get("/api/notes", async (c) => json(await listNotes(c.env.DB)));

router.post("/api/notes", async (c) =>
  json(await createNote(c.env.DB, readNote(await c.body()), c.deps.nowIso), 201),
);

router.put("/api/notes/:id", async (c, p) =>
  json(await updateNote(c.env.DB, reqId(p.id!), readNote(await c.body()), c.deps.nowIso)),
);

router.delete("/api/notes/:id", async (c, p) => {
  await deleteNote(c.env.DB, reqId(p.id!));
  return json({ ok: true });
});

// --- medicines -----------------------------------------------------------------

router.get("/api/medications", async (c) =>
  json(await listMedicationViews(c.env.DB, reqDate(c.url.searchParams.get("date")))),
);

router.post("/api/medications", async (c) => {
  const b = await c.body();
  const name = reqString(b, "name", 80);
  const effectiveFrom = reqDate(b.effective_from, "effective_from");
  let task: { time_of_day: (typeof TIMES)[number]; name: string } | null = null;
  if (b.create_task !== undefined && b.create_task !== null && b.create_task !== false) {
    const t = b.create_task === true ? {} : asBody(b.create_task);
    task = {
      time_of_day: has(t, "time_of_day") ? reqEnum(t, "time_of_day", TIMES) : "any",
      name: optString(t, "name", 80) ?? name,
    };
  }
  const view = await createMedication(c.env.DB, {
    name,
    unit: optString(b, "unit", 30) ?? "dose",
    pack_size: reqInt(b, "pack_size", 1, 100_000),
    pack_label: optString(b, "pack_label", 30) ?? "pack",
    reorder_lead_days: optInt(b, "reorder_lead_days", 0, 365) ?? null,
    order_cover_days: optInt(b, "order_cover_days", 1, 730) ?? null,
    auto_supplied: optBool(b, "auto_supplied") ?? false,
    notes: optString(b, "notes", 500) ?? null,
    dose_amount: reqNumber(b, "dose_amount", 0.01, 10_000),
    every_n_days: has(b, "every_n_days") ? reqInt(b, "every_n_days", 1, 365) : 1,
    effective_from: effectiveFrom,
    task,
  });
  return json(view, 201);
});

router.get("/api/medications/:id", async (c, p) =>
  json(await getMedicationView(c.env.DB, reqId(p.id!), reqDate(c.url.searchParams.get("date")))),
);

router.patch("/api/medications/:id", async (c, p) => {
  const b = await c.body();
  const asOf = reqDate(c.url.searchParams.get("date"));
  const patch: MedicationPatch = {};
  if (has(b, "name")) patch.name = reqString(b, "name", 80);
  if (has(b, "pack_size")) patch.pack_size = reqInt(b, "pack_size", 1, 100_000);
  if (has(b, "pack_label")) patch.pack_label = optString(b, "pack_label", 30) ?? "pack";
  const lead = optInt(b, "reorder_lead_days", 0, 365);
  if (lead !== undefined) patch.reorder_lead_days = lead;
  const cover = optInt(b, "order_cover_days", 1, 730);
  if (cover !== undefined) patch.order_cover_days = cover;
  const auto = optBool(b, "auto_supplied");
  if (auto !== undefined) patch.auto_supplied = auto;
  const notes = optString(b, "notes", 500);
  if (notes !== undefined) patch.notes = notes;
  return json(await updateMedication(c.env.DB, reqId(p.id!), patch, asOf));
});

router.post("/api/medications/:id/stock", async (c, p) => {
  const b = await c.body();
  const asOf = reqDate(c.url.searchParams.get("date"));
  const id = reqId(p.id!);
  const kind = reqEnum(b, "kind", KINDS);

  // Accept either a number of doses or a number of whole packs (tubes/boxes).
  let doses: number;
  if (has(b, "packs") && !has(b, "doses")) {
    const med = await getMedicationView(c.env.DB, id, asOf);
    doses = reqNumber(b, "packs", -10_000, 10_000) * med.pack_size;
  } else {
    doses = reqNumber(b, "doses", -1_000_000, 1_000_000);
  }
  const view = await addStockEvent(
    c.env.DB,
    id,
    { kind, date: reqDate(b.date), doses, note: optString(b, "note", 200) ?? null },
    asOf,
    c.deps.nowIso,
  );
  return json(view, 201);
});

router.delete("/api/medications/:id/stock/:eventId", async (c, p) =>
  json(await deleteStockEvent(c.env.DB, reqId(p.id!), reqId(p.eventId!), reqDate(c.url.searchParams.get("date")))),
);

router.post("/api/medications/:id/dose", async (c, p) => {
  const b = await c.body();
  const view = await setDose(
    c.env.DB,
    reqId(p.id!),
    {
      amount: reqNumber(b, "amount", 0.01, 10_000),
      every_n_days: has(b, "every_n_days") ? reqInt(b, "every_n_days", 1, 365) : 1,
      effective_from: reqDate(b.effective_from, "effective_from"),
    },
    reqDate(c.url.searchParams.get("date")),
  );
  return json(view, 201);
});

router.get("/api/health", async () => json({ ok: true }));

// --- request handling ----------------------------------------------------------

export async function handle(request: Request, env: Env, deps?: Partial<Deps>): Promise<Response> {
  const url = new URL(request.url);

  const now = new Date();
  const fullDeps: Deps = {
    nowSec: deps?.nowSec ?? Math.floor(now.getTime() / 1000),
    nowIso: deps?.nowIso ?? now.toISOString(),
  };

  // Enforce the app password before serving either the API or any static asset.
  try {
    if (url.pathname === "/login" || url.pathname === "/login/") {
      if (env.APP_PASSWORD && await validSession(request.headers.get("cookie"), env.APP_PASSWORD, fullDeps.nowSec)) {
        return Response.redirect(new URL("/", request.url), 303);
      }
      return loginPage(url.searchParams.get("return") ?? "/");
    }

    const isLogin = url.pathname === "/api/login" && request.method === "POST";
    const authenticated = !!env.APP_PASSWORD && await validSession(request.headers.get("cookie"), env.APP_PASSWORD, fullDeps.nowSec);
    if (!isLogin && !authenticated) {
      if (url.pathname.startsWith("/api/")) return json({ error: "Sign in required" }, 401);
      if (!env.APP_PASSWORD) return new Response("APP_PASSWORD is not configured", { status: 503 });
      const returnTo = `${url.pathname}${url.search}${url.hash}`;
      return Response.redirect(new URL(`/login?return=${encodeURIComponent(returnTo)}`, request.url), 303);
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "Something went wrong on the server" }, 500);
  }

  if (!url.pathname.startsWith("/api/") && url.pathname !== "/api") {
    // Not an API call. Normally Static Assets answers these before we run.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  }

  try {
    const found = router.match(request.method, url.pathname.replace(/\/+$/, "") || "/");
    if (found === null) throw new HttpError(404, "Not found");
    if (found === "method-not-allowed") throw new HttpError(405, "Method not allowed");

    const ctx: Ctx = {
      request,
      env,
      url,
      deps: fullDeps,
      body: async () => readJsonBody(request),
    };
    return await found.route.handler(ctx, found.params);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "Something went wrong on the server" }, 500);
  }
}

async function readJsonBody(request: Request): Promise<Body> {
  // Requiring a JSON content type also blocks simple cross-site form posts (CSRF).
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Send JSON with a content-type of application/json");
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "Request too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  return asBody(parsed);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
