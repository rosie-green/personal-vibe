// Medicine module: loads rows and hands them to the pure stock maths.

import { computeStock, scheduleOn } from "../medicine/stock.ts";
import type { DoseScheduleRow, Medication, MedicationView, StockEventRow, TimeOfDay } from "../shared/types.ts";
import { row, rows } from "./db.ts";
import type { D1Like } from "./db.ts";
import { createTask, latestAllowedDate } from "./tasks.ts";
import { HttpError } from "./validate.ts";

interface MedicationRow extends Omit<Medication, "auto_supplied"> {
  auto_supplied: number;
}

const MED_COLUMNS =
  "id, name, unit, pack_size, pack_label, reorder_lead_days, order_cover_days, auto_supplied, notes";

function toMedication(r: MedicationRow): Medication {
  return { ...r, auto_supplied: r.auto_supplied === 1 };
}

async function requireMedication(db: D1Like, id: number): Promise<Medication> {
  const r = await row<MedicationRow>(db, `SELECT ${MED_COLUMNS} FROM medications WHERE id = ?`, id);
  if (!r) throw new HttpError(404, "Medicine not found");
  return toMedication(r);
}

async function buildView(db: D1Like, med: Medication, asOf: string): Promise<MedicationView> {
  const [schedules, events, linked] = await Promise.all([
    rows<DoseScheduleRow>(
      db,
      "SELECT id, amount, every_n_days, effective_from FROM dose_schedules WHERE medication_id = ? ORDER BY effective_from",
      med.id,
    ),
    rows<StockEventRow>(
      db,
      "SELECT id, date, kind, doses, note FROM stock_events WHERE medication_id = ? ORDER BY date, id",
      med.id,
    ),
    rows<{ id: number; active_from: string; active_to: string | null }>(
      db,
      "SELECT id, active_from, active_to FROM tasks WHERE medication_id = ?",
      med.id,
    ),
  ]);

  // Only completions on days the linked task was actually active count towards usage.
  let completionDates: string[] = [];
  if (linked.length > 0) {
    const placeholders = linked.map(() => "?").join(",");
    const comps = await rows<{ task_id: number; date: string }>(
      db,
      `SELECT task_id, date FROM completions WHERE task_id IN (${placeholders})`,
      ...linked.map((t) => t.id),
    );
    const windows = new Map(linked.map((t) => [t.id, t]));
    completionDates = comps
      .filter((c) => {
        const t = windows.get(c.task_id);
        return t !== undefined && c.date >= t.active_from && (t.active_to === null || c.date <= t.active_to);
      })
      .map((c) => c.date);
  }

  const stock = computeStock({
    medication: med,
    schedules,
    events,
    completionDates,
    linkedTasks: linked,
    asOf,
  });

  return {
    ...med,
    currentDose: scheduleOn(schedules, asOf),
    linkedTaskIds: linked.map((t) => t.id),
    stock,
    recentEvents: [...events].reverse().slice(0, 10),
  };
}

export async function listMedicationViews(db: D1Like, asOf: string): Promise<MedicationView[]> {
  const meds = await rows<MedicationRow>(db, `SELECT ${MED_COLUMNS} FROM medications ORDER BY id`);
  return Promise.all(meds.map((m) => buildView(db, toMedication(m), asOf)));
}

export async function getMedicationView(db: D1Like, id: number, asOf: string): Promise<MedicationView> {
  return buildView(db, await requireMedication(db, id), asOf);
}

export interface NewMedication {
  name: string;
  unit: string;
  pack_size: number;
  pack_label: string;
  reorder_lead_days: number | null;
  order_cover_days: number | null;
  auto_supplied: boolean;
  notes: string | null;
  dose_amount: number;
  every_n_days: number;
  effective_from: string;
  /** Also create a daily task that uses this medicine. */
  task: { time_of_day: TimeOfDay; name: string } | null;
}

export async function createMedication(db: D1Like, input: NewMedication): Promise<MedicationView> {
  const res = await db
    .prepare(
      `INSERT INTO medications (name, unit, pack_size, pack_label, reorder_lead_days, order_cover_days, auto_supplied, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.name,
      input.unit,
      input.pack_size,
      input.pack_label,
      input.reorder_lead_days,
      input.order_cover_days,
      input.auto_supplied ? 1 : 0,
      input.notes,
    )
    .run();
  const id = res.meta.last_row_id;
  if (typeof id !== "number") throw new Error("insert did not return an id");

  try {
    await db
      .prepare("INSERT INTO dose_schedules (medication_id, amount, every_n_days, effective_from) VALUES (?, ?, ?, ?)")
      .bind(id, input.dose_amount, input.every_n_days, input.effective_from)
      .run();
    if (input.task) {
      await createTask(db, {
        name: input.task.name,
        time_of_day: input.task.time_of_day,
        medication_id: id,
        active_from: input.effective_from,
      });
    }
  } catch (err) {
    // Don't leave a half-created medicine behind.
    await db.prepare("DELETE FROM dose_schedules WHERE medication_id = ?").bind(id).run();
    await db.prepare("DELETE FROM medications WHERE id = ?").bind(id).run();
    throw err;
  }
  return getMedicationView(db, id, input.effective_from);
}

export interface MedicationPatch {
  name?: string;
  pack_size?: number;
  pack_label?: string;
  reorder_lead_days?: number | null;
  order_cover_days?: number | null;
  auto_supplied?: boolean;
  notes?: string | null;
}

export async function updateMedication(db: D1Like, id: number, patch: MedicationPatch, asOf: string): Promise<MedicationView> {
  const cur = await requireMedication(db, id);
  const next = { ...cur, ...patch };
  await db
    .prepare(
      `UPDATE medications SET name = ?, pack_size = ?, pack_label = ?, reorder_lead_days = ?,
                              order_cover_days = ?, auto_supplied = ?, notes = ? WHERE id = ?`,
    )
    .bind(
      next.name,
      next.pack_size,
      next.pack_label,
      next.reorder_lead_days,
      next.order_cover_days,
      next.auto_supplied ? 1 : 0,
      next.notes,
      id,
    )
    .run();
  return getMedicationView(db, id, asOf);
}

export interface NewStockEvent {
  kind: "delivery" | "adjustment" | "recount";
  date: string;
  doses: number;
  note: string | null;
}

export async function addStockEvent(
  db: D1Like,
  id: number,
  input: NewStockEvent,
  asOf: string,
  nowIso: string,
): Promise<MedicationView> {
  await requireMedication(db, id);
  if (input.date > latestAllowedDate(nowIso)) throw new HttpError(400, "That date is in the future");
  if (input.kind === "delivery" && input.doses <= 0) throw new HttpError(400, "A delivery must be more than zero");
  if (input.kind === "recount" && input.doses < 0) throw new HttpError(400, "A count can't be negative");
  if (input.kind === "adjustment" && input.doses === 0) throw new HttpError(400, "An adjustment can't be zero");

  await db
    .prepare("INSERT INTO stock_events (medication_id, date, kind, doses, note) VALUES (?, ?, ?, ?, ?)")
    .bind(id, input.date, input.kind, input.doses, input.note)
    .run();
  return getMedicationView(db, id, asOf);
}

export async function setDose(
  db: D1Like,
  id: number,
  input: { amount: number; every_n_days: number; effective_from: string },
  asOf: string,
): Promise<MedicationView> {
  await requireMedication(db, id);
  await db
    .prepare(
      `INSERT INTO dose_schedules (medication_id, amount, every_n_days, effective_from) VALUES (?, ?, ?, ?)
       ON CONFLICT (medication_id, effective_from)
       DO UPDATE SET amount = excluded.amount, every_n_days = excluded.every_n_days`,
    )
    .bind(id, input.amount, input.every_n_days, input.effective_from)
    .run();
  return getMedicationView(db, id, asOf);
}

export async function deleteStockEvent(db: D1Like, medicationId: number, eventId: number, asOf: string): Promise<MedicationView> {
  await requireMedication(db, medicationId);
  const res = await db
    .prepare("DELETE FROM stock_events WHERE id = ? AND medication_id = ?")
    .bind(eventId, medicationId)
    .run();
  if ((res.meta.changes ?? 0) === 0) throw new HttpError(404, "That entry doesn't exist");
  return getMedicationView(db, medicationId, asOf);
}
