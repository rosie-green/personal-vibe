import { useState } from "react";
import type { DayTask, TimeOfDay } from "../shared/types.ts";
import { Emoji, StarBurst, StarIcon } from "./ui.tsx";

export const TIME_LABEL: Record<TimeOfDay, string> = {
  morning: "Morning",
  evening: "Evening",
  any: "Any time",
};

const TIME_ICON: Record<TimeOfDay, string> = {
  morning: "☀️",
  evening: "🌙",
  any: "🕐",
};

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
                <Emoji symbol={TIME_ICON[task.time_of_day]} size={16} /> {TIME_LABEL[task.time_of_day]}
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
