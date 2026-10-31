// Month view data: for each day, how many tasks were active and how many got done.
// Because it uses each task's active_from / active_to window, adding or retiring a
// task later never changes how a past month looks.

import { datesInMonth } from "./dates.ts";
import { activeTasksOn, doneByDate, scoreDay } from "./stars.ts";
import type { CompletionRef, DayScore, TaskWindow } from "./stars.ts";

export interface MonthView {
  month: string;
  days: DayScore[];
  stars: number; // stars earned in this month
  completeDays: number; // days where everything was done
  trackedDays: number; // days that had at least one task
}

export function buildMonth(month: string, tasks: readonly TaskWindow[], completions: readonly CompletionRef[]): MonthView {
  const done = doneByDate(tasks, completions);
  const empty = new Set<number>();
  const days = datesInMonth(month).map((date) =>
    scoreDay(
      date,
      activeTasksOn(tasks, date).map((t) => t.id),
      done.get(date) ?? empty,
    ),
  );
  return {
    month,
    days,
    stars: days.reduce((n, d) => n + d.stars, 0),
    completeDays: days.filter((d) => d.complete).length,
    trackedDays: days.filter((d) => d.total > 0).length,
  };
}
