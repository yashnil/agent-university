// Folds the Arena event stream into a view model. Pure, so the page can rebuild the whole
// tournament from a replayed stream after a reload.
//
// The tournament evaluates Memorable FLOWS: each column ("heat" on the wire) is one candidate
// flow, handed to fresh students on different unseen companies. The flow-specific fields are
// read through the loose Wire* types below, every one optional, so the page still renders the
// older heat-only events (and any backend mid-change) by falling back to the heat display.

import type { ArenaEvent } from "@/app/_lib/arena-jobs";

export type Student = { id: string; name: string; harness: string };
type Metrics = { durationMs?: number; toolCalls?: number; turns?: number; costUsd?: number };
export type FlowSource = "recall" | "given" | "fixture";
export interface FlowInfo {
  procedureId: string;
  title: string;
  source: FlowSource | string;
  rank: number | null;
}

interface FlowFields {
  procedureId?: string;
  title?: string;
  passRate?: number;
}

export interface StudentResult {
  at: string;
  runId: string | null;
  certified: boolean;
  status: "observed" | "transferred" | "certified";
  summary: string;
  failedRules: string[];
  failedChecks: string[];
  metrics: Metrics;
  error: string | null;
  rulings: { rule: string; passed: boolean; reason: string }[];
}

type Wire =
  | {
      type: "tournament.started";
      at: string;
      tournamentId: string;
      dry: boolean;
      perHeat: number;
      perFlow?: number;
      judgeModel: string | null;
      threshold?: number;
      rejected?: { procedureId: string; title: string; reason: string }[];
      heats: {
        heat: number;
        examCase: string;
        examCompany: string | null;
        flow?: FlowInfo | null;
        students: { i: number; student: Student; examCase?: string; examCompany?: string | null }[];
      }[];
    }
  | { type: "student.started"; at: string; heat: number; i: number; student: Student; examCase?: string; examCompany?: string | null; procedureId?: string }
  | ({ type: "student.finished"; heat: number; i: number; student: Student; examCase?: string; examCompany?: string | null; procedureId?: string } & StudentResult)
  | {
      type: "heat.finished";
      at: string;
      heat: number;
      examCase: string;
      certifiedCount: number;
      winner: { i: number; student: Student; runId: string | null } | null;
      procedureId?: string;
      passRate?: number;
      runs?: number;
      advances?: boolean;
    }
  | { type: "final.started"; at: string; judgeModel: string | null; finalists: ({ heat: number; i: number; student: Student; runId: string | null; examCase: string } & FlowFields)[] }
  | {
      type: "final.finished";
      at: string;
      judge: { status: string; model?: string; reason?: string };
      ranking: ({ place: number; heat: number; i: number; student: Student; runId: string | null; examCase: string; score: number | null; rationale: string | null } & FlowFields)[];
    }
  | {
      type: "tournament.finished";
      at: string;
      champion: ({ heat: number; i: number; student: Student; runId: string | null; examCase: string; summary: string; score: number | null } & FlowFields) | null;
      promoted: boolean | null;
      registry: string;
      record: unknown;
      procedure?: ProcedureRecord | null;
    }
  | { type: "error"; at: string; message: string };

export interface ProcedureRecord {
  skillId?: string;
  procedureId?: string;
  title?: string;
  source?: string;
  flow?: string;
  tournamentId?: string;
  evaluatedAt?: string;
  examCases?: string[];
  runs?: number;
  certified?: number;
  passRate?: number;
  advanced?: boolean;
  judge?: unknown;
  champion?: boolean;
  bestRunId?: string | null;
  runIds?: (string | null)[];
  [k: string]: unknown;
}

type W<T extends Wire["type"]> = Extract<Wire, { type: T }>;
export type FinalistView = W<"final.started">["finalists"][number];
export type RankingView = W<"final.finished">["ranking"][number];
export type FinishedView = W<"tournament.finished">;

export interface StudentView {
  i: number;
  student: Student;
  examCase: string | null;
  examCompany: string | null;
  state: "pending" | "running" | "done";
  startedAt: string | null;
  result: StudentResult | null;
}

export interface HeatResult {
  certifiedCount: number;
  runs: number;
  passRate: number;
  /** true when the flow (or, on the old wire, the heat's best record) goes to the final */
  advances: boolean;
  winner: { i: number; student: Student; runId: string | null } | null;
}

export interface HeatView {
  heat: number;
  examCase: string;
  examCompany: string | null;
  flow: FlowInfo | null;
  students: StudentView[];
  finished: HeatResult | null;
}

export interface ArenaView {
  started: { at: string; tournamentId: string; dry: boolean; perHeat: number; judgeModel: string | null } | null;
  /** true once the backend emits flow fields; drives flow vs heat copy */
  flowMode: boolean;
  /** pass rate a flow needs to reach the final */
  threshold: number;
  /** flows dropped before the heats (e.g. failed the leak check) */
  rejected: { procedureId: string; title: string; reason: string }[];
  heats: HeatView[];
  finalStarted: W<"final.started"> | null;
  finalFinished: W<"final.finished"> | null;
  finished: FinishedView | null;
  error: W<"error"> | null;
}

export function foldEvents(events: readonly ArenaEvent[]): ArenaView {
  const v: ArenaView = { started: null, flowMode: false, threshold: 0.5, rejected: [], heats: [], finalStarted: null, finalFinished: null, finished: null, error: null };
  const student = (heat: number, i: number) => v.heats.find((h) => h.heat === heat)?.students.find((s) => s.i === i);
  const place = (s: StudentView, e: { examCase?: string; examCompany?: string | null }) => {
    if (e.examCase) s.examCase = e.examCase;
    if (e.examCompany !== undefined) s.examCompany = e.examCompany;
  };
  for (const raw of events) {
    const e = raw as unknown as Wire;
    switch (e.type) {
      case "tournament.started":
        v.started = { at: e.at, tournamentId: e.tournamentId, dry: e.dry, perHeat: e.perFlow ?? e.perHeat, judgeModel: e.judgeModel };
        v.flowMode = e.heats.some((h) => Boolean(h.flow)) || e.perFlow !== undefined;
        v.threshold = typeof e.threshold === "number" ? e.threshold : 0.5;
        v.rejected = e.rejected ?? [];
        v.heats = e.heats.map((h) => ({
          heat: h.heat,
          examCase: h.examCase,
          examCompany: h.examCompany,
          flow: h.flow ?? null,
          finished: null,
          students: h.students.map((s) => ({
            i: s.i,
            student: s.student,
            examCase: s.examCase ?? null,
            examCompany: s.examCompany ?? null,
            state: "pending",
            startedAt: null,
            result: null,
          })),
        }));
        break;
      case "student.started": {
        const s = student(e.heat, e.i);
        if (s) {
          place(s, e);
          if (s.state === "pending") Object.assign(s, { state: "running", startedAt: e.at });
        }
        break;
      }
      case "student.finished": {
        const s = student(e.heat, e.i);
        if (s) {
          place(s, e);
          s.state = "done";
          s.student = e.student;
          s.result = {
            at: e.at, runId: e.runId, certified: e.certified, status: e.status, summary: e.summary,
            failedRules: e.failedRules ?? [], failedChecks: e.failedChecks ?? [], metrics: e.metrics ?? {},
            error: e.error, rulings: e.rulings ?? [],
          };
        }
        break;
      }
      case "heat.finished": {
        const h = v.heats.find((x) => x.heat === e.heat);
        if (h) {
          const runs = e.runs ?? h.students.length;
          h.finished = {
            certifiedCount: e.certifiedCount,
            runs,
            passRate: e.passRate ?? (runs ? e.certifiedCount / runs : 0),
            advances: e.advances ?? e.winner !== null,
            winner: e.winner,
          };
        }
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

/** Where the registry keeps a flow's ProcedureRecord (mirrors lib/registry.ts procedureSlug). */
export function procedurePath(registry: string, skillId: string | undefined, procedureId: string | undefined): string | null {
  if (!skillId || !procedureId || !registry || registry.endsWith(".json")) return null;
  const slug = procedureId.replace(/^procedures\//, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120);
  return `${registry.replace(/\/+$/, "")}/procedures/${skillId}/${slug}.json`;
}

/** Short, stable-looking form of a Memorable procedure id for headers and chips. */
export function shortId(id: string | null | undefined): string {
  if (!id) return "";
  const tail = id.includes(":") || id.includes("/") ? id.split(/[:/]/).pop() ?? id : id;
  return tail.length > 14 ? `${tail.slice(0, 12)}…` : tail;
}

export function sourceLabel(flow: FlowInfo): string {
  if (flow.source === "recall") return flow.rank !== null && flow.rank !== undefined ? `Memorable rank #${flow.rank}` : "Memorable recall";
  return String(flow.source);
}

export const pct = (x: number | undefined | null) => (x === undefined || x === null ? "–" : `${Math.round(x * 100)}%`);

export function fmtDuration(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms)) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

export function fmtTime(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleTimeString([], { hour12: false });
}
