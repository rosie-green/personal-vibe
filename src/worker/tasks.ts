import { addDays } from "../core/dates.ts";
import type { Task, TimeOfDay } from "../shared/types.ts";
import { row, rows } from "./db.ts";
import type { D1Like } from "./db.ts";
import { HttpError } from "./validate.ts";

const COLUMNS =
  "id, name, time_of_day, medication_id, reminder_text, done_text, sort_order, active_from, active_to";

export async function listTasks(db: D1Like): Promise<Task[]> {
  return rows<Task>(db, `SELECT ${COLUMNS} FROM tasks ORDER BY sort_order, id`);
}

export async function getTask(db: D1Like, id: number): Promise<Task | null> {
  return row<Task>(db, `SELECT ${COLUMNS} FROM tasks WHERE id = ?`, id);
}

export async function requireTask(db: D1Like, id: number): Promise<Task> {
  const task = await getTask(db, id);
  if (!task) throw new HttpError(404, "Task not found");
  return task;
}

export interface NewTask {
  name: string;
  time_of_day: TimeOfDay;
  medication_id?: number | null;
  reminder_text?: string | null;
  done_text?: string | null;
  active_from: string;
}

export async function createTask(db: D1Like, input: NewTask): Promise<Task> {
  if (input.medication_id != null) {
    const med = await row<{ id: number }>(db, "SELECT id FROM medications WHERE id = ?", input.medication_id);
    if (!med) throw new HttpError(400, "That medicine doesn't exist");
  }
  const max = await row<{ m: number | null }>(db, "SELECT MAX(sort_order) AS m FROM tasks");
  const sortOrder = (max?.m ?? 0) + 10;
  const res = await db
    .prepare(
      `INSERT INTO tasks (name, time_of_day, medication_id, reminder_text, done_text, sort_order, active_from)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.name,
      input.time_of_day,
      input.medication_id ?? null,
      input.reminder_text ?? null,
      input.done_text ?? null,
      sortOrder,
      input.active_from,
    )
    .run();
  const id = res.meta.last_row_id;
  if (typeof id !== "number") throw new Error("insert did not return an id");
  return requireTask(db, id);
}

export interface TaskPatch {
  name?: string;
  time_of_day?: TimeOfDay;
  reminder_text?: string | null;
  done_text?: string | null;
  active_to?: string | null;
}

export async function updateTask(db: D1Like, id: number, patch: TaskPatch): Promise<Task> {
  const current = await requireTask(db, id);
  if (patch.active_to !== undefined && patch.active_to !== null && patch.active_to < current.active_from) {
    throw new HttpError(400, `"active_to" can't be before the day the task started (${current.active_from})`);
  }
  const next = { ...current, ...patch };
  await db
    .prepare(
      `UPDATE tasks SET name = ?, time_of_day = ?, reminder_text = ?, done_text = ?, active_to = ? WHERE id = ?`,
    )
    .bind(next.name, next.time_of_day, next.reminder_text, next.done_text, next.active_to, id)
    .run();
  return requireTask(db, id);
}

/** Only for tasks created by mistake: a task with history must be retired instead. */
export async function deleteTask(db: D1Like, id: number): Promise<void> {
  await requireTask(db, id);
  const used = await row<{ n: number }>(db, "SELECT COUNT(*) AS n FROM completions WHERE task_id = ?", id);
  if ((used?.n ?? 0) > 0) {
    throw new HttpError(409, "This task has history. Retire it instead so past days stay accurate.");
  }
  await db.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
}

/** Latest date a client may report as "today" given the server clock (covers every timezone). */
export function latestAllowedDate(nowIso: string): string {
  return addDays(nowIso.slice(0, 10), 1);
}
