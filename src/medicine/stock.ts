// Medicine stock maths. Pure functions, no database, no clock (`asOf` is passed in).
//
// How it works
//  - Stock is counted in individual doses.
//  - Stock events: deliveries (+), adjustments (+/-) and recounts (absolute).
//  - Every completion of a task linked to the medicine uses `amount` doses, where
//    `amount` comes from the dose schedule in force on the day of the completion.
//    Changing your dose later only affects days from the new effective date.
//  - A recount says "at the END of this date, I had N doses". Stock on hand is then
//    that count, plus later deliveries/adjustments, minus later completions.
//  - Days left = stock on hand / doses used per day (today's dose x number of
//    linked tasks active today / every_n_days).

import { addDays, inRange } from "../core/dates.ts";

export interface MedicationSettings {
  pack_size: number;
  reorder_lead_days: number | null;
  order_cover_days: number | null;
  auto_supplied: boolean;
}

export interface DoseSchedule {
  effective_from: string;
  amount: number;
  every_n_days: number;
}

export interface StockEvent {
  date: string;
  kind: "delivery" | "adjustment" | "recount";
  doses: number;
  /** Tie-breaker for events on the same date (insertion order). */
  id?: number;
}

export interface LinkedTaskWindow {
  active_from: string;
  active_to: string | null;
}

export interface StockInput {
  medication: MedicationSettings;
  schedules: readonly DoseSchedule[];
  events: readonly StockEvent[];
  /** One entry per completion of a task linked to this medicine. */
  completionDates: readonly string[];
  linkedTasks: readonly LinkedTaskWindow[];
  asOf: string;
}

export interface StockSummary {
  /** false until at least one delivery / recount / adjustment has been logged */
  tracking: boolean;
  /** false when no task is linked, so doses can't be counted automatically */
  consumptionTracked: boolean;
  onHandDoses: number | null;
  onHandPacks: number | null;
  /** true if the running total went below zero and was clamped (i.e. the log is incomplete) */
  clamped: boolean;
  dosesPerDay: number | null;
  daysLeft: number | null;
  runsOutOn: string | null;
  reorderDue: boolean;
  /** Last date you can order so you still have `reorder_lead_days` left (null if not applicable) */
  orderByDate: string | null;
  suggestedPacks: number | null;
  suggestedPacksCoverDays: number | null;
  lastCountDate: string | null;
}

/** The dose schedule in force on `date`, or null if none had started yet. */
export function scheduleOn<T extends DoseSchedule>(schedules: readonly T[], date: string): T | null {
  let best: T | null = null;
  for (const s of schedules) {
    if (s.effective_from <= date && (best === null || s.effective_from > best.effective_from)) best = s;
  }
  return best;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeStock(input: StockInput): StockSummary {
  const { medication, schedules, events, completionDates, linkedTasks, asOf } = input;

  const relevant = events.filter((e) => e.date <= asOf);
  const consumptionTracked = linkedTasks.length > 0;

  // Daily usage as of today.
  const todaysSchedule = scheduleOn(schedules, asOf);
  const linkedToday = linkedTasks.filter((t) => inRange(asOf, t.active_from, t.active_to)).length;
  const dosesPerDay =
    todaysSchedule && linkedToday > 0 ? (linkedToday * todaysSchedule.amount) / todaysSchedule.every_n_days : null;

  const empty: StockSummary = {
    tracking: false,
    consumptionTracked,
    onHandDoses: null,
    onHandPacks: null,
    clamped: false,
    dosesPerDay,
    daysLeft: null,
    runsOutOn: null,
    reorderDue: false,
    orderByDate: null,
    suggestedPacks: suggestPacks(medication, dosesPerDay),
    suggestedPacksCoverDays: dosesPerDay !== null ? (medication.order_cover_days ?? null) : null,
    lastCountDate: null,
  };
  if (relevant.length === 0) return empty;

  // Find the most recent recount (latest date, then latest insertion).
  const ordered = [...relevant].sort((a, b) => (a.date === b.date ? (a.id ?? 0) - (b.id ?? 0) : a.date < b.date ? -1 : 1));
  let baseIndex = -1;
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i]!.kind === "recount") {
      baseIndex = i;
      break;
    }
  }
  const base = baseIndex >= 0 ? ordered[baseIndex]! : null;
  const startAfter = base ? base.date : null; // end-of-day semantics: only later days count
  let onHand = base ? base.doses : 0;

  for (const e of ordered) {
    if (e.kind === "recount") continue;
    if (startAfter !== null && e.date <= startAfter) continue;
    onHand += e.doses;
  }
  for (const date of completionDates) {
    if (date > asOf) continue;
    if (startAfter !== null && date <= startAfter) continue;
    const s = scheduleOn(schedules, date);
    if (s) onHand -= s.amount;
  }

  const clamped = onHand < 0;
  if (clamped) onHand = 0;
  onHand = round1(onHand);

  const daysLeft = dosesPerDay !== null && dosesPerDay > 0 ? onHand / dosesPerDay : null;
  const runsOutOn = daysLeft !== null ? addDays(asOf, Math.floor(daysLeft)) : null;

  const lead = medication.reorder_lead_days;
  const reorderApplies = !medication.auto_supplied && lead !== null;
  const reorderDue = reorderApplies && daysLeft !== null && daysLeft <= lead!;
  const orderByDate =
    reorderApplies && daysLeft !== null ? addDays(asOf, Math.max(0, Math.floor(daysLeft - lead!))) : null;

  return {
    tracking: true,
    consumptionTracked,
    onHandDoses: onHand,
    onHandPacks: round1(onHand / medication.pack_size),
    clamped,
    dosesPerDay,
    daysLeft: daysLeft !== null ? round1(daysLeft) : null,
    runsOutOn,
    reorderDue,
    orderByDate,
    suggestedPacks: suggestPacks(medication, dosesPerDay),
    suggestedPacksCoverDays: dosesPerDay !== null ? (medication.order_cover_days ?? null) : null,
    lastCountDate: base ? base.date : null,
  };
}

/** Whole packs needed to cover `order_cover_days` at today's usage, e.g. 90 days x 4 / 64 = 5.6 -> 6. */
export function suggestPacks(medication: MedicationSettings, dosesPerDay: number | null): number | null {
  if (dosesPerDay === null || dosesPerDay <= 0 || medication.order_cover_days === null) return null;
  // The small epsilon stops floating point noise turning an exact 6.0000000001 into 7.
  return Math.ceil((dosesPerDay * medication.order_cover_days) / medication.pack_size - 1e-9);
}
