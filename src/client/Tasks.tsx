import { useState } from "react";
import type { SubmitEvent } from "react";
import type { Task, TimeOfDay } from "../shared/types.ts";
import { api } from "./api.ts";
import { formatShort } from "./dates.ts";
import { TIME_LABEL } from "./TaskCard.tsx";
import { ErrorBanner, Field, Segmented, useLoad } from "./ui.tsx";

const TIME_OPTIONS = [
  { value: "morning", label: "Morning" },
  { value: "evening", label: "Evening" },
  { value: "any", label: "Any time" },
] as const;

interface FormValues {
  name: string;
  time_of_day: TimeOfDay;
  reminder_text: string;
  done_text: string;
}

function TaskForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  submitLabel: string;
  onSubmit: (v: FormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (v.name.trim() === "") return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(v);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Name">
        <input value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Brush teeth" required />
      </Field>
      <Field label="When">
        <Segmented
          label="Time of day"
          value={v.time_of_day}
          options={TIME_OPTIONS}
          onChange={(time_of_day) => setV({ ...v, time_of_day })}
        />
      </Field>
      <Field label="Reminder message" hint="Optional. Shown until you tick it off.">
        <textarea
          rows={2}
          value={v.reminder_text}
          maxLength={300}
          onChange={(e) => setV({ ...v, reminder_text: e.target.value })}
          placeholder="Don't forget to brush your teeth in the evening."
        />
      </Field>
      <Field label="Done message" hint="Optional. Shown after you tick it off.">
        <textarea
          rows={2}
          value={v.done_text}
          maxLength={300}
          onChange={(e) => setV({ ...v, done_text: e.target.value })}
          placeholder="Good job! Check back tomorrow."
        />
      </Field>
      {error ? <ErrorBanner error={error} /> : null}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={saving || v.name.trim() === ""}>
          {saving ? "Saving…" : submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

const empty: FormValues = { name: "", time_of_day: "any", reminder_text: "", done_text: "" };

export function Tasks({ today }: { today: string }) {
  const { data: tasks, setData, error, loading, reload } = useLoad(() => api.tasks(), []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const replace = (task: Task) => setData((tasks ?? []).map((t) => (t.id === task.id ? task : t)));

  const run = async (fn: () => Promise<void>) => {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err);
    }
  };

  if (loading && !tasks) return <p className="muted center pad">Loading…</p>;
  if (error && !tasks) return <ErrorBanner error={error} onRetry={reload} />;

  const all = tasks ?? [];
  const current = all.filter((t) => t.active_to === null || t.active_to >= today);
  const retired = all.filter((t) => t.active_to !== null && t.active_to < today);

  return (
    <section>
      <div className="page-head">
        <h1>Tasks</h1>
        {!adding ? (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add task
          </button>
        ) : null}
      </div>
      <p className="muted">Things you want to tick off each day. A task counts from the day you add it, so changing the list never rewrites past days.</p>

      {actionError ? <ErrorBanner error={actionError} /> : null}

      {adding ? (
        <div className="panel">
          <h2 className="panel-title">New task</h2>
          <TaskForm
            initial={empty}
            submitLabel="Add task"
            onCancel={() => setAdding(false)}
            onSubmit={async (v) => {
              const created = await api.createTask({
                name: v.name.trim(),
                time_of_day: v.time_of_day,
                reminder_text: v.reminder_text.trim() || null,
                done_text: v.done_text.trim() || null,
                active_from: today,
              });
              setData([...all, created]);
              setAdding(false);
            }}
          />
        </div>
      ) : null}

      {current.length === 0 && !adding ? <p className="muted center pad">No tasks yet. Add your first one above.</p> : null}

      <ul className="item-list">
        {current.map((t) => (
          <li key={t.id} className="item">
            {editing === t.id ? (
              <TaskForm
                initial={{ name: t.name, time_of_day: t.time_of_day, reminder_text: t.reminder_text ?? "", done_text: t.done_text ?? "" }}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={async (v) => {
                  replace(
                    await api.patchTask(t.id, {
                      name: v.name.trim(),
                      time_of_day: v.time_of_day,
                      reminder_text: v.reminder_text.trim() || null,
                      done_text: v.done_text.trim() || null,
                    }),
                  );
                  setEditing(null);
                }}
              />
            ) : (
              <>
                <div className="item-main">
                  <div className="item-name">{t.name}</div>
                  <div className="muted small">
                    {TIME_LABEL[t.time_of_day]} · since {formatShort(t.active_from)}
                    {t.medication_id !== null ? " · counts towards medicine stock" : ""}
                    {t.active_to !== null ? ` · ends after ${formatShort(t.active_to)}` : ""}
                  </div>
                </div>
                <div className="item-actions">
                  <button className="btn btn-small" onClick={() => setEditing(t.id)}>
                    Edit
                  </button>
                  {t.active_to !== null ? (
                    <button className="btn btn-small" onClick={() => run(async () => replace(await api.patchTask(t.id, { active_to: null })))}>
                      Keep
                    </button>
                  ) : (
                    <button
                      className="btn btn-small"
                      onClick={() => {
                        const lastDay = today < t.active_from ? t.active_from : today;
                        if (confirm(`Stop "${t.name}" from tomorrow? Past days keep their history.`)) {
                          void run(async () => replace(await api.patchTask(t.id, { active_to: lastDay })));
                        }
                      }}
                    >
                      Retire
                    </button>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      {retired.length > 0 ? (
        <details className="retired">
          <summary>Retired tasks ({retired.length})</summary>
          <ul className="item-list">
            {retired.map((t) => (
              <li key={t.id} className="item item-muted">
                <div className="item-main">
                  <div className="item-name">{t.name}</div>
                  <div className="muted small">
                    {formatShort(t.active_from)} to {formatShort(t.active_to!)}
                  </div>
                </div>
                <div className="item-actions">
                  {/* Restoring starts a fresh copy from today, so the days it was retired aren't
                      suddenly counted as missed. */}
                  <button
                    className="btn btn-small"
                    onClick={() =>
                      run(async () => {
                        const copy = await api.createTask({
                          name: t.name,
                          time_of_day: t.time_of_day,
                          reminder_text: t.reminder_text,
                          done_text: t.done_text,
                          medication_id: t.medication_id,
                          active_from: today,
                        });
                        setData([...all, copy]);
                      })
                    }
                  >
                    Restore from today
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
