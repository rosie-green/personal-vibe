// Daily flow, stars and calendar: loads rows, then hands them to the pure
// functions in src/core.

import { buildMonth } from "../core/calendar.ts";
import { activeTasksOn, doneByDate, isActiveOn, scoreDay, totalStars } from "../core/stars.ts";
import type { CalendarView, DayTask, DayView } from "../shared/types.ts";
import { rows } from "./db.ts";
import type { D1Like } from "./db.ts";
import { latestAllowedDate, listTasks, requireTask } from "./tasks.ts";
import { HttpError } from "./validate.ts";

interface CompletionRow {
  task_id: number;
  date: string;
  completed_at: string;
}

async function allCompletions(db: D1Like): Promise<CompletionRow[]> {
  return rows<CompletionRow>(db, "SELECT task_id, date, completed_at FROM completions");
}

export async function getDayView(db: D1Like, date: string): Promise<DayView> {
  const [tasks, completions] = await Promise.all([listTasks(db), allCompletions(db)]);

  const doneAt = new Map<number, string>();
  for (const c of completions) if (c.date === date) doneAt.set(c.task_id, c.completed_at);

  const active = activeTasksOn(tasks, date);
  const dayTasks: DayTask[] = active.map((t) => ({
    ...t,
    done: doneAt.has(t.id),
    completed_at: doneAt.get(t.id) ?? null,
  }));

  const doneIds = doneByDate(tasks, completions).get(date) ?? new Set<number>();
  const score = scoreDay(date, active.map((t) => t.id), doneIds);

  return {
    date,
    tasks: dayTasks,
    total: score.total,
    done: score.done,
    complete: score.complete,
    stars: score.stars,
    totalStars: totalStars(tasks, completions),
  };
}

export async function setCompletion(
  db: D1Like,
  taskId: number,
  date: string,
  done: boolean,
  nowIso: string,
): Promise<DayView> {
  const task = await requireTask(db, taskId);
  if (!isActiveOn(task, date)) throw new HttpError(400, "That task isn't scheduled for that day");
  if (date > latestAllowedDate(nowIso)) throw new HttpError(400, "You can't tick things off in the future");

  if (done) {
    await db
      .prepare("INSERT INTO completions (task_id, date, completed_at) VALUES (?, ?, ?) ON CONFLICT (task_id, date) DO NOTHING")
      .bind(taskId, date, nowIso)
      .run();
  } else {
    await db.prepare("DELETE FROM completions WHERE task_id = ? AND date = ?").bind(taskId, date).run();
  }
  return getDayView(db, date);
}

export async function getCalendar(db: D1Like, month: string): Promise<CalendarView> {
  const [tasks, completions] = await Promise.all([listTasks(db), allCompletions(db)]);
  const view = buildMonth(month, tasks, completions);
  return { ...view, totalStars: totalStars(tasks, completions) };
}
