// Folds the Arena event stream into a view model. Pure, so the page can rebuild the whole
// tournament from a replayed stream after a reload.

import type { ArenaEvent } from "@/app/_lib/arena-jobs";

type Ev<T extends ArenaEvent["type"]> = Extract<ArenaEvent, { type: T }>;
export type StudentFinished = Ev<"student.finished">;
export type Student = Ev<"student.started">["student"];

export interface StudentView {
  i: number;
  student: Student;
  state: "pending" | "running" | "done";
  startedAt: string | null;
  result: StudentFinished | null;
}

export interface HeatView {
  heat: number;
  examCase: string;
  examCompany: string | null;
  students: StudentView[];
  finished: Ev<"heat.finished"> | null;
}

export interface ArenaView {
  started: Ev<"tournament.started"> | null;
  heats: HeatView[];
  finalStarted: Ev<"final.started"> | null;
  finalFinished: Ev<"final.finished"> | null;
  finished: Ev<"tournament.finished"> | null;
  error: Ev<"error"> | null;
}

export function foldEvents(events: ArenaEvent[]): ArenaView {
  const v: ArenaView = { started: null, heats: [], finalStarted: null, finalFinished: null, finished: null, error: null };
  const student = (heat: number, i: number) => v.heats.find((h) => h.heat === heat)?.students.find((s) => s.i === i);
  for (const e of events) {
    switch (e.type) {
      case "tournament.started":
        v.started = e;
        v.heats = e.heats.map((h) => ({
          heat: h.heat,
          examCase: h.examCase,
          examCompany: h.examCompany,
          finished: null,
          students: h.students.map((s) => ({ i: s.i, student: s.student, state: "pending", startedAt: null, result: null })),
        }));
        break;
      case "student.started": {
        const s = student(e.heat, e.i);
        if (s && s.state === "pending") Object.assign(s, { state: "running", startedAt: e.at });
        break;
      }
      case "student.finished": {
        const s = student(e.heat, e.i);
        if (s) Object.assign(s, { state: "done", result: e, student: e.student });
        break;
      }
      case "heat.finished": {
        const h = v.heats.find((x) => x.heat === e.heat);
        if (h) h.finished = e;
        break;
      }
      case "final.started":
        v.finalStarted = e;
        break;
      case "final.finished":
        v.finalFinished = e;
        break;
      case "tournament.finished":
        v.finished = e;
        break;
      case "error":
        v.error = e;
        break;
    }
  }
  return v;
}

export const isTerminal = (e: ArenaEvent) => e.type === "tournament.finished" || e.type === "error";

export function fmtDuration(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms)) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

export function fmtTime(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleTimeString([], { hour12: false });
}
