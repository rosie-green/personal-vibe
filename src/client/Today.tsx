import { useEffect, useState } from "react";
import type { DayTask, TimeOfDay } from "../shared/types.ts";
import { api } from "./api.ts";
import { formatLong } from "./dates.ts";
import { TIME_LABEL, TaskCard } from "./TaskCard.tsx";
import { Banner, ErrorBanner, StarIcon, useLoad } from "./ui.tsx";

const SECTIONS: TimeOfDay[] = ["morning", "evening", "any"];

export function Today({
  today,
  onStars,
  goTo,
}: {
  today: string;
  onStars: (n: number) => void;
  goTo: (tab: "tasks") => void;
}) {
  const { data: day, setData, error, loading, reload } = useLoad(() => api.day(today), [today]);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    if (day) onStars(day.totalStars);
  }, [day, onStars]);

  const toggle = async (task: DayTask, done: boolean) => {
    if (!day) return;
    setActionError(null);
    setPending((p) => new Set(p).add(task.id));

    // Optimistic update so the tap feels instant; the server's answer replaces it.
    const before = day;
    const tasks = day.tasks.map((t) => (t.id === task.id ? { ...t, done } : t));
    const doneCount = tasks.filter((t) => t.done).length;
    setData({ ...day, tasks, done: doneCount, complete: doneCount === tasks.length });

    try {
      setData(await api.setDone(task.id, today, done));
    } catch (err) {
      setData(before);
      setActionError(err);
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(task.id);
        return next;
      });
    }
  };

  if (loading && !day) return <p className="muted center pad">Loading…</p>;
  if (error && !day) return <ErrorBanner error={error} onRetry={reload} />;
  if (!day) return null;

  return (
    <section>
      <div className="day-head">
        <h1>{formatLong(day.date)}</h1>
        {day.total > 0 ? (
          <p className="muted" aria-live="polite">
            {day.done} of {day.total} done
          </p>
        ) : null}
        {day.total > 0 ? (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={day.total} aria-valuenow={day.done}>
            <div className="progress-fill" style={{ width: `${(day.done / day.total) * 100}%` }} />
          </div>
        ) : null}
      </div>

      {actionError ? <ErrorBanner error={actionError} /> : null}

      {day.complete ? (
        <div className="celebrate" role="status">
          <StarIcon size={28} className="celebrate-star" />
          <div>
            <strong>Everything done today!</strong>
            <div className="muted">
              You earned {day.stars} {day.stars === 1 ? "star" : "stars"} today, including a bonus one.
            </div>
          </div>
        </div>
      ) : null}

      {day.total === 0 ? (
        <Banner kind="info" action={<button className="btn btn-small" onClick={() => goTo("tasks")}>Add a task</button>}>
          Nothing scheduled yet.
        </Banner>
      ) : null}

      {SECTIONS.map((time) => {
        const tasks = day.tasks.filter((t) => t.time_of_day === time);
        if (tasks.length === 0) return null;
        return (
          <div key={time} className="section">
            <h2 className="section-title">{TIME_LABEL[time]}</h2>
            {tasks.map((t) => (
              <TaskCard key={t.id} task={t} onToggle={toggle} busy={pending.has(t.id)} />
            ))}
          </div>
        );
      })}
    </section>
  );
}
