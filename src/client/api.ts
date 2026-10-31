// Thin typed client for the Worker's JSON API.

import type { CalendarView, DayView, MedicationView, Task, TimeOfDay } from "../shared/types.ts";

export class ApiFailure extends Error {
  status: number;
  /** True when we probably couldn't reach the app at all (offline, or the Access login expired). */
  unreachable: boolean;
  constructor(message: string, status: number, unreachable = false) {
    super(message);
    this.name = "ApiFailure";
    this.status = status;
    this.unreachable = unreachable;
  }
}

const UNREACHABLE =
  "Can't reach the server. Check your connection. If you've been away a while, reload the page to sign in again.";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Offline, or Cloudflare Access redirected to its login page (which the browser blocks).
    throw new ApiFailure(UNREACHABLE, 0, true);
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson) throw new ApiFailure(UNREACHABLE, res.status, true);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new ApiFailure(data.error ?? `Something went wrong (${res.status})`, res.status);
  return data;
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const api = {
  day: (date: string) => request<DayView>("GET", `/api/day?${q({ date })}`),
  setDone: (taskId: number, date: string, done: boolean) =>
    request<DayView>("PUT", "/api/completions", { task_id: taskId, date, done }),
  calendar: (month: string) => request<CalendarView>("GET", `/api/calendar?${q({ month })}`),

  tasks: () => request<Task[]>("GET", "/api/tasks"),
  createTask: (b: {
    name: string;
    time_of_day: TimeOfDay;
    reminder_text?: string | null;
    done_text?: string | null;
    medication_id?: number | null;
    active_from: string;
  }) => request<Task>("POST", "/api/tasks", b),
  patchTask: (
    id: number,
    b: Partial<{
      name: string;
      time_of_day: TimeOfDay;
      reminder_text: string | null;
      done_text: string | null;
      active_to: string | null;
    }>,
  ) => request<Task>("PATCH", `/api/tasks/${id}`, b),
  deleteTask: (id: number) => request<{ ok: true }>("DELETE", `/api/tasks/${id}`),

  medications: (date: string) => request<MedicationView[]>("GET", `/api/medications?${q({ date })}`),
  createMedication: (b: Record<string, unknown>) => request<MedicationView>("POST", "/api/medications", b),
  patchMedication: (id: number, date: string, b: Record<string, unknown>) =>
    request<MedicationView>("PATCH", `/api/medications/${id}?${q({ date })}`, b),
  addStock: (id: number, date: string, b: Record<string, unknown>) =>
    request<MedicationView>("POST", `/api/medications/${id}/stock?${q({ date })}`, b),
  deleteStock: (id: number, eventId: number, date: string) =>
    request<MedicationView>("DELETE", `/api/medications/${id}/stock/${eventId}?${q({ date })}`),
  setDose: (id: number, date: string, b: { amount: number; effective_from: string }) =>
    request<MedicationView>("POST", `/api/medications/${id}/dose?${q({ date })}`, b),
};
