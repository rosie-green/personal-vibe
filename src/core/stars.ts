// Stars and day-completion. Pure functions, no database, no clock.
//
// Rules
//  - Every completed task earns 1 star.
//  - A day where every task active that day is completed earns 1 bonus star.
//  - A completion only counts if its task was active on that date.
//  - Stars are never stored. They are always derived from completions.

import { inRange } from "./dates.ts";

export interface TaskWindow {
  id: number;
  active_from: string;
  active_to: string | null;
}

export interface CompletionRef {
  task_id: number;
  date: string;
}

export interface DayScore {
  date: string;
  total: number; // tasks active that day
  done: number; // of those, completed
  complete: boolean; // total > 0 and done === total
  stars: number; // done + bonus
}

export function isActiveOn(task: TaskWindow, date: string): boolean {
  return inRange(date, task.active_from, task.active_to);
}

export function activeTasksOn<T extends TaskWindow>(tasks: readonly T[], date: string): T[] {
  return tasks.filter((t) => isActiveOn(t, date));
}

export function scoreDay(date: string, activeTaskIds: readonly number[], doneTaskIds: ReadonlySet<number>): DayScore {
  const total = activeTaskIds.length;
  let done = 0;
  for (const id of activeTaskIds) if (doneTaskIds.has(id)) done++;
  const complete = total > 0 && done === total;
  return { date, total, done, complete, stars: done + (complete ? 1 : 0) };
}

/** Group completions by date, keeping only those for tasks that were active that day. */
export function doneByDate(tasks: readonly TaskWindow[], completions: readonly CompletionRef[]): Map<string, Set<number>> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Map<string, Set<number>>();
  for (const c of completions) {
    const task = byId.get(c.task_id);
    if (!task || !isActiveOn(task, c.date)) continue;
    let set = out.get(c.date);
    if (!set) out.set(c.date, (set = new Set()));
    set.add(c.task_id);
  }
  return out;
}

/** Total stars earned across all history. */
export function totalStars(tasks: readonly TaskWindow[], completions: readonly CompletionRef[]): number {
  let total = 0;
  for (const [date, done] of doneByDate(tasks, completions)) {
    const activeIds = activeTasksOn(tasks, date).map((t) => t.id);
    total += scoreDay(date, activeIds, done).stars;
  }
  return total;
}
