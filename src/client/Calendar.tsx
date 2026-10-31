import { useEffect, useState } from "react";
import type { CalendarDay, DayTask, DayView } from "../shared/types.ts";
import { addMonths, monthOf, weekdayMondayFirst } from "../core/dates.ts";
import { api } from "./api.ts";
import { formatLong, formatMonth } from "./dates.ts";
import { TaskRow } from "./TaskCard.tsx";
import { ErrorBanner, StarIcon, useLoad } from "./ui.tsx";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function level(day: CalendarDay, today: string): "none" | "future" | "missed" | "some" | "most" | "full" {
  if (day.total === 0) return "none";
  if (day.date > today) return "future";
  if (day.complete) return "full";
  if (day.done === 0) return "missed";
  return day.done / day.total > 0.5 ? "most" : "some";
}

const LEVEL_TEXT = {
  none: "nothing scheduled",
  future: "upcoming",
  missed: "nothing done",
  some: "partly done",
  most: "mostly done",
  full: "all done",
} as const;

export function Calendar({ today, onStars }: { today: string; onStars: (n: number) => void }) {
  const [month, setMonth] = useState(monthOf(today));
  const [selected, setSelected] = useState<string | null>(null);
  const { data: cal, error, loading, reload, setData } = useLoad(() => api.calendar(month), [month]);

  useEffect(() => {
    if (cal) onStars(cal.totalStars);
  }, [cal, onStars]);

  const go = (delta: number) => {
    setMonth((m) => addMonths(m, delta));
    setSelected(null);
  };

  const currentMonth = monthOf(today);
  const leading = cal ? weekdayMondayFirst(`${month}-01`) : 0;

  return (
    <section>
      <div className="month-nav">
        <button className="btn btn-icon" onClick={() => go(-1)} aria-label="Previous month">
          ‹
        </button>
        <h1 className="month-title">{formatMonth(month)}</h1>
        <button className="btn btn-icon" onClick={() => go(1)} aria-label="Next month" disabled={month >= currentMonth}>
          ›
        </button>
      </div>

      {error && !cal ? <ErrorBanner error={error} onRetry={reload} /> : null}
      {loading && !cal ? <p className="muted center pad">Loading…</p> : null}

      {cal ? (
        <>
          <div className="summary">
            <div>
              <strong>{cal.completeDays}</strong>
              <span className="muted"> of {cal.trackedDays} days complete</span>
            </div>
            <div className="summary-stars">
              <StarIcon size={18} /> <strong>{cal.stars}</strong>
              <span className="muted"> this month</span>
            </div>
          </div>

          <div className="cal-grid" role="grid" aria-label={formatMonth(month)}>
            {WEEKDAYS.map((w) => (
              <div key={w} className="cal-weekday" role="columnheader">
                {w}
              </div>
            ))}
            {Array.from({ length: leading }, (_, i) => (
              <div key={`blank-${i}`} className="cal-blank" role="gridcell" />
            ))}
            {cal.days.map((d) => {
              const lv = level(d, today);
              const dayNum = Number(d.date.slice(8));
              const isSelected = selected === d.date;
              return (
                <button
                  key={d.date}
                  role="gridcell"
                  className={`cal-day cal-${lv}${d.date === today ? " cal-today" : ""}${isSelected ? " cal-selected" : ""}`}
                  disabled={d.total === 0 || d.date > today}
                  onClick={() => setSelected(isSelected ? null : d.date)}
                  aria-label={`${formatLong(d.date)}: ${LEVEL_TEXT[lv]}${d.total > 0 ? `, ${d.done} of ${d.total}` : ""}`}
                  aria-pressed={isSelected}
                >
                  <span className="cal-num">{dayNum}</span>
                  {lv === "full" ? <StarIcon size={14} className="cal-star" /> : <span className="cal-count">{d.total > 0 && d.date <= today ? `${d.done}/${d.total}` : ""}</span>}
                </button>
              );
            })}
          </div>

          <ul className="legend" aria-label="Key">
            <li><span className="swatch cal-full" /> All done</li>
            <li><span className="swatch cal-most" /> Mostly</li>
            <li><span className="swatch cal-some" /> Some</li>
            <li><span className="swatch cal-missed" /> None</li>
          </ul>

          {selected ? (
            <DayDetail
              key={selected}
              date={selected}
              onChanged={(day) => {
                // Refresh this month's colours and the star total after an edit.
                api.calendar(month).then(setData, () => reload());
                onStars(day.totalStars);
              }}
            />
          ) : (
            <p className="muted center hint">Tap a day to see what you did, or to tick off something you forgot.</p>
          )}
        </>
      ) : null}
    </section>
  );
}

function DayDetail({ date, onChanged }: { date: string; onChanged: (day: DayView) => void }) {
  const { data: day, setData, error, reload } = useLoad(() => api.day(date), [date]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const toggle = async (task: DayTask, done: boolean) => {
    setBusy(true);
    setActionError(null);
    try {
      const updated = await api.setDone(task.id, date, done);
      setData(updated);
      onChanged(updated);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail">
      <h2 className="detail-title">{formatLong(date)}</h2>
      {error && !day ? <ErrorBanner error={error} onRetry={reload} /> : null}
      {actionError ? <ErrorBanner error={actionError} /> : null}
      {day ? (
        <>
          <ul className="task-list">
            {day.tasks.map((t) => (
              <TaskRow key={t.id} task={t} onToggle={toggle} busy={busy} />
            ))}
          </ul>
          <p className="muted small">
            {day.done} of {day.total} done · {day.stars} {day.stars === 1 ? "star" : "stars"}
            {day.complete ? " (with the bonus)" : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}
