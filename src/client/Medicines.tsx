import { useState } from "react";
import type { SubmitEvent, ReactNode } from "react";
import type { MedicationView, TimeOfDay } from "../shared/types.ts";
import { api } from "./api.ts";
import { formatShort } from "./dates.ts";
import { ErrorBanner, Field, Segmented, fmt, parseNum, plural, useLoad } from "./ui.tsx";

type Panel = "delivery" | "recount" | "dose" | "edit" | null;

const TIME_OPTIONS = [
  { value: "morning", label: "Morning" },
  { value: "evening", label: "Evening" },
  { value: "any", label: "Any time" },
] as const;

export function Medicines({ today }: { today: string }) {
  const { data: meds, setData, error, loading, reload } = useLoad(() => api.medications(today), [today]);
  const [adding, setAdding] = useState(false);

  const replace = (m: MedicationView) => setData((meds ?? []).map((x) => (x.id === m.id ? m : x)));

  if (loading && !meds) return <p className="muted center pad">Loading…</p>;
  if (error && !meds) return <ErrorBanner error={error} onRetry={reload} />;

  const list = meds ?? [];
  const alerts = list.filter((m) => m.stock.reorderDue);

  return (
    <section>
      <div className="page-head">
        <h1>Medicines</h1>
        {!adding ? (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add medicine
          </button>
        ) : null}
      </div>

      {alerts.map((m) => (
        <div key={m.id} className="alert" role="alert">
          <strong>Time to order {m.name}.</strong>{" "}
          {m.stock.daysLeft !== null ? `About ${fmt(m.stock.daysLeft)} ${plural("day", m.stock.daysLeft)} left. ` : ""}
          {m.stock.suggestedPacks !== null
            ? `Order about ${m.stock.suggestedPacks} ${plural(m.pack_label, m.stock.suggestedPacks)}${
                m.stock.suggestedPacksCoverDays ? ` (covers ${m.stock.suggestedPacksCoverDays} days)` : ""
              }.`
            : ""}
        </div>
      ))}

      {adding ? (
        <div className="panel">
          <h2 className="panel-title">New medicine</h2>
          <AddForm
            today={today}
            onCancel={() => setAdding(false)}
            onCreated={(m) => {
              setData([...list, m]);
              setAdding(false);
            }}
          />
        </div>
      ) : null}

      {list.length === 0 && !adding ? (
        <p className="muted center pad">No medicines yet. Add one to track how much you have left.</p>
      ) : null}

      {list.map((m) => (
        <MedicineCard key={m.id} med={m} today={today} onChange={replace} />
      ))}
    </section>
  );
}

function statusOf(m: MedicationView): { label: string; tone: "ok" | "alert" | "muted" } {
  if (m.stock.reorderDue) return { label: "Order now", tone: "alert" };
  if (!m.stock.tracking) return { label: "Not tracking yet", tone: "muted" };
  if (m.auto_supplied) return { label: "Auto-supplied", tone: "ok" };
  return { label: "OK", tone: "ok" };
}

function MedicineCard({ med, today, onChange }: { med: MedicationView; today: string; onChange: (m: MedicationView) => void }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<unknown>(null);
  const s = med.stock;
  const status = statusOf(med);
  const label = med.pack_label;

  const closeWith = (m: MedicationView) => {
    onChange(m);
    setPanel(null);
  };
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));

  return (
    <article className="med">
      <header className="med-head">
        <h2>{med.name}</h2>
        <span className={`badge badge-${status.tone}`}>{status.label}</span>
      </header>

      {s.tracking && s.onHandDoses !== null ? (
        <div className="stock">
          <div className="stock-big">
            {fmt(s.onHandPacks ?? 0)} <span>{plural(label, s.onHandPacks ?? 0)}</span>
          </div>
          <div className="muted">
            {fmt(s.onHandDoses)} {plural(med.unit, s.onHandDoses)} left
            {s.daysLeft !== null ? ` · about ${fmt(s.daysLeft)} ${plural("day", s.daysLeft)}` : ""}
          </div>
          {s.runsOutOn && s.daysLeft !== null ? <div className="muted small">Runs out around {formatShort(s.runsOutOn)}</div> : null}
        </div>
      ) : (
        <p className="muted">Log a delivery, or count what you have, to start tracking stock.</p>
      )}

      {s.clamped ? (
        <p className="note note-warn">Your log says you've run out. If that's not right, do a recount to correct it.</p>
      ) : null}
      {!s.consumptionTracked ? (
        <p className="note">No daily task is linked to this medicine, so doses aren't counted automatically. Use recounts to keep it right.</p>
      ) : null}
      {s.reorderDue && s.suggestedPacks !== null ? (
        <p className="note note-warn">
          Order about {s.suggestedPacks} {plural(label, s.suggestedPacks)}
          {s.suggestedPacksCoverDays ? ` (covers ${s.suggestedPacksCoverDays} days)` : ""}.
        </p>
      ) : null}
      {!s.reorderDue && !med.auto_supplied && s.orderByDate && med.reorder_lead_days !== null ? (
        <p className="note">Order by {formatShort(s.orderByDate)} (when about {med.reorder_lead_days} {plural("day", med.reorder_lead_days)} are left).</p>
      ) : null}

      <dl className="facts">
        <div>
          <dt>Dose</dt>
          <dd>
            {med.currentDose
              ? `${fmt(med.currentDose.amount)} ${plural(med.unit, med.currentDose.amount)} each time${
                  med.currentDose.every_n_days > 1 ? ` (every ${med.currentDose.every_n_days} days)` : ""
                }`
              : "Not set"}
            {s.dosesPerDay !== null ? ` · ${fmt(s.dosesPerDay)}/day` : ""}
          </dd>
        </div>
        <div>
          <dt>Pack</dt>
          <dd>
            {med.pack_size} {plural(med.unit, med.pack_size)} per {label}
          </dd>
        </div>
        <div>
          <dt>Ordering</dt>
          <dd>{med.auto_supplied ? "Sent automatically" : med.reorder_lead_days !== null ? `Order at ${med.reorder_lead_days} days left` : "No reminder set"}</dd>
        </div>
      </dl>

      <div className="med-actions">
        <button className={panel === "delivery" ? "btn btn-small btn-on" : "btn btn-small"} onClick={() => toggle("delivery")}>
          Log delivery
        </button>
        <button className={panel === "recount" ? "btn btn-small btn-on" : "btn btn-small"} onClick={() => toggle("recount")}>
          Recount
        </button>
        <button className={panel === "dose" ? "btn btn-small btn-on" : "btn btn-small"} onClick={() => toggle("dose")}>
          Change dose
        </button>
        <button className={panel === "edit" ? "btn btn-small btn-on" : "btn btn-small"} onClick={() => toggle("edit")}>
          Settings
        </button>
      </div>

      {error ? <ErrorBanner error={error} /> : null}

      {panel === "delivery" || panel === "recount" ? (
        <StockForm
          key={panel}
          med={med}
          kind={panel}
          today={today}
          onDone={closeWith}
          onError={setError}
        />
      ) : null}
      {panel === "dose" ? <DoseForm med={med} today={today} onDone={closeWith} onError={setError} /> : null}
      {panel === "edit" ? <EditForm med={med} today={today} onDone={closeWith} onError={setError} /> : null}

      {med.recentEvents.length > 0 ? (
        <details className="history">
          <summary>Recent entries</summary>
          <ul className="history-list">
            {med.recentEvents.map((e) => (
              <li key={e.id}>
                <span>
                  {formatShort(e.date)} ·{" "}
                  {e.kind === "delivery"
                    ? `Delivery +${fmt(e.doses)}`
                    : e.kind === "recount"
                      ? `Counted ${fmt(e.doses)}`
                      : `Adjustment ${e.doses > 0 ? "+" : ""}${fmt(e.doses)}`}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
                <button
                  className="link-btn"
                  onClick={async () => {
                    if (!confirm("Remove this entry?")) return;
                    setError(null);
                    try {
                      onChange(await api.deleteStock(med.id, e.id, today));
                    } catch (err) {
                      setError(err);
                    }
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

function FormShell({
  children,
  onSubmit,
  submitLabel,
  saving,
  disabled,
}: {
  children: ReactNode;
  onSubmit: (e: SubmitEvent) => void;
  submitLabel: string;
  saving: boolean;
  disabled?: boolean;
}) {
  return (
    <form className="form form-inline" onSubmit={onSubmit}>
      {children}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={saving || disabled}>
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

type Unit = "packs" | "doses";

function StockForm({
  med,
  kind,
  today,
  onDone,
  onError,
}: {
  med: MedicationView;
  kind: "delivery" | "recount";
  today: string;
  onDone: (m: MedicationView) => void;
  onError: (e: unknown) => void;
}) {
  const [unit, setUnit] = useState<Unit>("packs");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const n = parseNum(amount);
  const valid = n !== null && (kind === "recount" ? n >= 0 : n > 0);
  const doses = n === null ? null : unit === "packs" ? n * med.pack_size : n;

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!valid || n === null) return;
    setSaving(true);
    onError(null);
    try {
      onDone(
        await api.addStock(med.id, today, {
          kind,
          date,
          note: note.trim() || null,
          ...(unit === "packs" ? { packs: n } : { doses: n }),
        }),
      );
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell onSubmit={submit} submitLabel={kind === "delivery" ? "Add delivery" : "Save count"} saving={saving} disabled={!valid}>
      <p className="muted small">
        {kind === "delivery"
          ? "How much arrived?"
          : "Count what you have right now (after any doses you've already taken today). This replaces the running total."}
      </p>
      <Segmented
        label="Count in"
        value={unit}
        options={[
          { value: "packs", label: plural(med.pack_label, 2) },
          { value: "doses", label: plural(med.unit, 2) },
        ]}
        onChange={setUnit}
      />
      <Field label={kind === "delivery" ? "Amount delivered" : "Amount left"} hint={doses !== null && valid ? `= ${fmt(doses)} ${plural(med.unit, doses)}` : undefined}>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={unit === "packs" ? "e.g. 6" : "e.g. 120"} autoFocus />
      </Field>
      <Field label="Date">
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <Field label="Note (optional)">
        <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormShell>
  );
}

function DoseForm({
  med,
  today,
  onDone,
  onError,
}: {
  med: MedicationView;
  today: string;
  onDone: (m: MedicationView) => void;
  onError: (e: unknown) => void;
}) {
  const [amount, setAmount] = useState(med.currentDose ? String(med.currentDose.amount) : "");
  const [from, setFrom] = useState(today);
  const [saving, setSaving] = useState(false);
  const n = parseNum(amount);
  const valid = n !== null && n > 0;

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!valid || n === null) return;
    setSaving(true);
    onError(null);
    try {
      onDone(await api.setDose(med.id, today, { amount: n, effective_from: from }));
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell onSubmit={submit} submitLabel="Save dose" saving={saving} disabled={!valid}>
      <p className="muted small">
        Past days keep the old dose. This only changes days from the date below.
      </p>
      <Field label={`${plural(med.unit, 2)} each time you tick the task`}>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </Field>
      <Field label="Starting from">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
      </Field>
    </FormShell>
  );
}

function EditForm({
  med,
  today,
  onDone,
  onError,
}: {
  med: MedicationView;
  today: string;
  onDone: (m: MedicationView) => void;
  onError: (e: unknown) => void;
}) {
  const [name, setName] = useState(med.name);
  const [packLabel, setPackLabel] = useState(med.pack_label);
  const [packSize, setPackSize] = useState(String(med.pack_size));
  const [auto, setAuto] = useState(med.auto_supplied);
  const [lead, setLead] = useState(med.reorder_lead_days === null ? "" : String(med.reorder_lead_days));
  const [cover, setCover] = useState(med.order_cover_days === null ? "" : String(med.order_cover_days));
  const [notes, setNotes] = useState(med.notes ?? "");
  const [saving, setSaving] = useState(false);

  const size = parseNum(packSize);
  const valid = name.trim() !== "" && size !== null && size >= 1;

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!valid || size === null) return;
    setSaving(true);
    onError(null);
    try {
      onDone(
        await api.patchMedication(med.id, today, {
          name: name.trim(),
          pack_label: packLabel.trim() || "pack",
          pack_size: Math.round(size),
          auto_supplied: auto,
          reorder_lead_days: parseNum(lead) === null ? null : Math.round(parseNum(lead)!),
          order_cover_days: parseNum(cover) === null ? null : Math.round(parseNum(cover)!),
          notes: notes.trim() || null,
        }),
      );
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormShell onSubmit={submit} submitLabel="Save settings" saving={saving} disabled={!valid}>
      <Field label="Name">
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <div className="row">
        <Field label="Pack called">
          <input value={packLabel} maxLength={30} onChange={(e) => setPackLabel(e.target.value)} placeholder="tube, box…" />
        </Field>
        <Field label={`${plural(med.unit, 2)} per pack`}>
          <input inputMode="numeric" value={packSize} onChange={(e) => setPackSize(e.target.value)} />
        </Field>
      </div>
      <label className="check-line">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        <span>Supplied automatically (no reorder reminders)</span>
      </label>
      {!auto ? (
        <Field label="Remind me to order when this many days are left">
          <input inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} placeholder="7" />
        </Field>
      ) : null}
      <Field label="A full order should last (days)" hint="Used to suggest how many packs to order.">
        <input inputMode="numeric" value={cover} onChange={(e) => setCover(e.target.value)} placeholder="optional" />
      </Field>
      <Field label="Notes">
        <textarea rows={2} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </FormShell>
  );
}

function AddForm({
  today,
  onCreated,
  onCancel,
}: {
  today: string;
  onCreated: (m: MedicationView) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [packLabel, setPackLabel] = useState("pack");
  const [packSize, setPackSize] = useState("");
  const [dose, setDose] = useState("1");
  const [auto, setAuto] = useState(false);
  const [lead, setLead] = useState("7");
  const [cover, setCover] = useState("");
  const [makeTask, setMakeTask] = useState(true);
  const [time, setTime] = useState<TimeOfDay>("morning");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const size = parseNum(packSize);
  const doseN = parseNum(dose);
  const valid = name.trim() !== "" && size !== null && size >= 1 && doseN !== null && doseN > 0;

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!valid || size === null || doseN === null) return;
    setSaving(true);
    setError(null);
    try {
      const leadN = parseNum(lead);
      const coverN = parseNum(cover);
      onCreated(
        await api.createMedication({
          name: name.trim(),
          pack_label: packLabel.trim() || "pack",
          pack_size: Math.round(size),
          dose_amount: doseN,
          auto_supplied: auto,
          reorder_lead_days: !auto && leadN !== null ? Math.round(leadN) : null,
          order_cover_days: coverN !== null ? Math.round(coverN) : null,
          effective_from: today,
          create_task: makeTask ? { time_of_day: time } : null,
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Name">
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Estrogen" required />
      </Field>
      <div className="row">
        <Field label="Pack called">
          <input value={packLabel} maxLength={30} onChange={(e) => setPackLabel(e.target.value)} placeholder="tube, box…" />
        </Field>
        <Field label="Doses per pack">
          <input inputMode="numeric" value={packSize} onChange={(e) => setPackSize(e.target.value)} placeholder="e.g. 64" />
        </Field>
      </div>
      <Field label="Doses each time you take it" hint="Counted every time you tick the daily task.">
        <input inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} />
      </Field>
      <label className="check-line">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        <span>Supplied automatically (no reorder reminders)</span>
      </label>
      {!auto ? (
        <Field label="Remind me to order when this many days are left">
          <input inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} />
        </Field>
      ) : null}
      <Field label="A full order should last (days)" hint="Optional. Used to suggest how many packs to order.">
        <input inputMode="numeric" value={cover} onChange={(e) => setCover(e.target.value)} />
      </Field>
      <label className="check-line">
        <input type="checkbox" checked={makeTask} onChange={(e) => setMakeTask(e.target.checked)} />
        <span>Add a daily task for it</span>
      </label>
      {makeTask ? (
        <Segmented label="Time of day" value={time} options={TIME_OPTIONS} onChange={setTime} />
      ) : null}
      {error ? <ErrorBanner error={error} /> : null}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={saving || !valid}>
          {saving ? "Saving…" : "Add medicine"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
