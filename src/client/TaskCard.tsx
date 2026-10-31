import { useState } from "react";
import type { DayTask, TimeOfDay } from "../shared/types.ts";
import { StarBurst, StarIcon } from "./ui.tsx";

export const TIME_LABEL: Record<TimeOfDay, string> = {
  morning: "Morning",
  evening: "Evening",
  any: "Any time",
};

function TimeIcon({ time }: { time: TimeOfDay }) {
  if (time === "morning") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="time-icon">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
      </svg>
    );
  }
  if (time === "evening") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="time-icon">
        <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="time-icon">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function reminderText(task: DayTask): string {
  if (task.reminder_text) return task.reminder_text;
  const when = task.time_of_day === "any" ? "" : ` this ${task.time_of_day === "morning" ? "morning" : "evening"}`;
  return `Don't forget: ${task.name}${when}.`;
}

function doneText(task: DayTask): string {
  if (task.done_text) return task.done_text;
  return `Good job on doing your ${task.name.toLowerCase()} today!\n\nCheck back tomorrow.`;
}

export function TaskCard({
  task,
  onToggle,
  busy,
}: {
  task: DayTask;
  onToggle: (task: DayTask, done: boolean) => void;
  busy?: boolean;
}) {
  const [burst, setBurst] = useState(0);

  const tick = () => {
    if (!task.done) setBurst((n) => n + 1);
    onToggle(task, !task.done);
  };

  return (
    <article className={task.done ? "card card-done" : "card card-pending"} aria-label={task.name}>
      <div className="card-accent" aria-hidden="true" />
      <div className="card-body">
        <h3 className="card-title">{task.name} Reminder</h3>
        <p className="card-text">{task.done ? doneText(task) : reminderText(task)}</p>
        <div className="card-actions">
          {task.done ? (
            <>
              <span className="pill pill-done">
                <StarIcon size={16} /> Completed
              </span>
              <button className="link-btn" onClick={tick} disabled={busy} aria-label={`Undo ${task.name}`}>
                Undo
              </button>
            </>
          ) : (
            <>
              <span className="pill pill-time">
                <TimeIcon time={task.time_of_day} /> {TIME_LABEL[task.time_of_day]}
              </span>
              <button className="btn btn-primary" onClick={tick} disabled={busy}>
                Mark done
              </button>
            </>
          )}
        </div>
        {burst > 0 && task.done ? <StarBurst key={burst} /> : null}
      </div>
    </article>
  );
}

/** Compact row for editing a past day from the calendar. */
export function TaskRow({
  task,
  onToggle,
  busy,
}: {
  task: DayTask;
  onToggle: (task: DayTask, done: boolean) => void;
  busy?: boolean;
}) {
  return (
    <li className="task-row">
      <button
        className={task.done ? "check check-on" : "check"}
        role="checkbox"
        aria-checked={task.done}
        onClick={() => onToggle(task, !task.done)}
        disabled={busy}
        aria-label={task.name}
      >
        {task.done ? <StarIcon size={18} /> : null}
      </button>
      <span className="task-row-name">{task.name}</span>
      <span className="task-row-time">{TIME_LABEL[task.time_of_day]}</span>
    </li>
  );
}
