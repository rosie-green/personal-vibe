// Types shared between the Worker (API) and the React app.

import type { StockSummary } from "../medicine/stock.ts";

export type TimeOfDay = "morning" | "evening" | "any";

export interface Task {
  id: number;
  name: string;
  time_of_day: TimeOfDay;
  medication_id: number | null;
  reminder_text: string | null;
  done_text: string | null;
  sort_order: number;
  active_from: string;
  active_to: string | null;
}

export interface DayTask extends Task {
  done: boolean;
  completed_at: string | null;
}

export interface DayView {
  date: string;
  tasks: DayTask[];
  total: number;
  done: number;
  complete: boolean;
  /** Stars earned on this day (done + bonus when the whole day is complete). */
  stars: number;
  /** Stars earned over all time. */
  totalStars: number;
}

export interface CalendarDay {
  date: string;
  total: number;
  done: number;
  complete: boolean;
  stars: number;
}

export interface CalendarView {
  month: string;
  days: CalendarDay[];
  stars: number;
  completeDays: number;
  trackedDays: number;
  totalStars: number;
}

export interface DoseScheduleRow {
  id: number;
  amount: number;
  every_n_days: number;
  effective_from: string;
}

export interface Medication {
  id: number;
  name: string;
  unit: string;
  pack_size: number;
  pack_label: string;
  reorder_lead_days: number | null;
  order_cover_days: number | null;
  auto_supplied: boolean;
  notes: string | null;
}

export interface StockEventRow {
  id: number;
  date: string;
  kind: "delivery" | "adjustment" | "recount";
  doses: number;
  note: string | null;
}

export interface MedicationView extends Medication {
  /** Dose schedule in force today (null if none yet). */
  currentDose: DoseScheduleRow | null;
  linkedTaskIds: number[];
  stock: StockSummary;
  recentEvents: StockEventRow[];
}

export interface ApiError {
  error: string;
}

export type { StockSummary };
