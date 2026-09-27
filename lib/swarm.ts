// Swarm exam: N fresh, isolated students take the same unseen exam. One success is not enough.
//
//   launchStudent(i) x N (bounded concurrency, per-student timeout)
//        -> TransferResult + metrics + isolation facts (+ artifact content)
//        -> certify()                  deterministic CertificationRecord per student
//        -> judge (optional, Jev)      advisory 0-10 score, certified records only
//        -> winner                     certified first, then judge score, then registry rankKey
//        -> recordDecision() for all   every record in the ledger, winner last
//
// Pure orchestration: the launcher and the judge are injected, so tests run offline. A student
// that throws or times out never stops the swarm; it becomes a failed TransferResult.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { certify, loadCases } from "./certification.ts";
import type { CandidateSkill, Case, CertificationRecord } from "./certification.ts";
import { judgeKey } from "./jev.ts";
import type { JudgeFn, JudgedRecord } from "./jev.ts";
import { agentIdentity, RECORD_DIR } from "./qm.ts";
import { errorsAgainst } from "./schema.ts";
import * as registry from "./registry.ts";
import type { ProcedureRecord } from "./registry.ts";
import type { AgentIdentity, AgentUniversityEvent, ArtifactType, TransferResult } from "./types.ts";

export type Metrics = { durationMs?: number; toolCalls?: number; turns?: number; costUsd?: number };
export interface StudentOutcome {
  transfer: TransferResult;
  metrics: Metrics;
  isolation: Record<string, boolean>;
  artifact?: string | null; // artifact content, for the judge
}
export type LaunchStudent = (i: number, signal: AbortSignal) => Promise<StudentOutcome>;

export interface SwarmOptions {
  isolationFor?: (i: number, transfer: TransferResult, facts: Record<string, boolean>) => Record<string, boolean> | null;
  decidedAt?: string;
  maxParallel?: number;
  examCase?: string;
  events?: AgentUniversityEvent[];
  cases?: Case[];
  studentFor?: (i: number) => AgentIdentity;
  swarmId?: string;
  timeoutMs?: number; // per student
  promote?: boolean; // recordDecision() for every record (default true)
  artifactsDir?: string; // when set, a newly canonical winner's artifact is copied to <dir>/<examCase>/<type> for the UI
  judge?: JudgeFn | null;
  onEvent?: (e: ArenaEvent) => void; // live progress (the website's Arena); must not throw
  heat?: number; // heat number reported in events (default 1)
  caseFor?: (i: number) => string; // student i's exam case when students take different cases (default: examCase)
  limiter?: Limiter; // shared slot pool, e.g. across concurrent tournament heats (acquired before a student starts)
}

type Id = AgentIdentity;

/** A candidate Memorable flow (procedure) in a tournament. */
export interface FlowRef { procedureId: string; title: string; source: "recall" | "given" | "fixture"; rank: number | null }
type Where = { examCase: string; examCompany: string | null };
type FlowFields = { procedureId: string; title: string; passRate: number };

/** Live progress of a swarm or tournament, in order. Consumed by the website's Arena (SSE).
 *  In a flow tournament each "heat" is one candidate flow; its students take different exam cases. */
export type ArenaEvent =
  | { type: "tournament.started"; at: string; tournamentId: string; dry: boolean; perHeat: number; perFlow: number;
      judgeModel: string | null; threshold: number;
      heats: ({ heat: number; flow: FlowRef | null; students: ({ i: number; student: Id } & Where)[] } & Where)[];
      rejected: { procedureId: string; title: string; reason: string }[] }
  | ({ type: "student.started"; at: string; heat: number; i: number; student: Id; procedureId: string | null } & Where)
  | ({ type: "student.finished"; at: string; heat: number; i: number; student: Id; procedureId: string | null;
      runId: string | null; certified: boolean; status: "observed" | "transferred" | "certified"; summary: string;
      failedRules: string[]; failedChecks: string[]; metrics: Metrics; error: string | null;
      rulings: { rule: string; passed: boolean; reason: string }[] } & Where)
  | { type: "heat.finished"; at: string; heat: number; examCase: string; examCases: string[]; certifiedCount: number;
      procedureId: string | null; passRate: number; runs: number; advances: boolean;
      winner: { i: number; student: Id; runId: string | null; examCase: string } | null }
  | { type: "final.started"; at: string; judgeModel: string | null;
      finalists: ({ heat: number; i: number; student: Id; runId: string | null; examCase: string } & FlowFields)[] }
  | { type: "final.finished"; at: string; judge: { status: string; model?: string; reason?: string };
      ranking: ({ place: number; heat: number; i: number; student: Id; runId: string | null; examCase: string;
        score: number | null; rationale: string | null } & FlowFields)[] }
  | { type: "tournament.finished"; at: string; champion: ({ heat: number; i: number; student: Id; runId: string | null;
      examCase: string; summary: string; score: number | null } & FlowFields) | null;
      promoted: boolean | null; registry: string; record: unknown; procedure: ProcedureRecord | null }
  | { type: "error"; at: string; message: string };

/** Call a progress listener without letting it break the run. */
export function emit(onEvent: ((e: ArenaEvent) => void) | undefined, e: ArenaEvent) {
  if (!onEvent) return;
  try {
    onEvent(e);
  } catch {
    /* a broken listener must not fail the exam */
  }
}

/** A counting semaphore: at most n holders at once. acquire() resolves to a release function. */
export interface Limiter { acquire(): Promise<() => void> }

export function createLimiter(n: number): Limiter {
  let free = Math.max(1, n);
  const waiting: (() => void)[] = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else free++;
  };
  return {
    acquire: () => new Promise((resolve) => {
      const grant = () => resolve(once(release));
      if (free > 0) { free--; grant(); } else waiting.push(grant);
    }),
  };
}

const once = (f: () => void) => {
  let done = false;
  return () => { if (!done) { done = true; f(); } };
};

export interface JudgeInfo { status: "ok" | "unavailable" | "skipped" | "disabled"; model?: string; reason?: string; judged?: number; certified?: number; promptDigest?: string }

export interface LeaderboardRow {
  rank: number; student: string; studentId: string; runId: string | null; certified: boolean; status: string;
  failedRules: string[]; failedChecks: string[]; error: string | null; metrics: Metrics;
  judge: JudgedRecord["judge"] | null;
}

export interface SwarmSummary {
  swarmId: string; skillId: string; examCase: string; n: number; startedAt: string; finishedAt: string;
  certifiedCount: number; passRate: number; rankedBy: string; judge: JudgeInfo;
  winner: null | { studentId: string; student: string; runId: string | null; certified: boolean; summary: string;
    judgeScore: number | null; promoted: boolean | null };
  canonical: null | { runId: string | null; student: string; isWinner: boolean };
  leaderboard: LeaderboardRow[];
  students: { student: number; transfer: TransferResult; isolation: Record<string, boolean>; events: AgentUniversityEvent[] }[];
  records: JudgedRecord[];
  artifacts: Record<string, string | null>; // judgeKey -> artifact content (not saved to disk)
}

export const RANKED_BY = "certified > Jev judge score (certified only, advisory) > registry rankKey " +
  "(rules passed > checks passed > judge score > lower costUsd > fewer toolCalls > lower durationMs > runId)";

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export const defaultStudent = (i: number, swarmId = "swarm") => agentIdentity(`swarm:${swarmId}:${i}`, `Agent #${i}`);

export function newSwarmId(tag: string) {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `swarm-${tag}-${ts}-${crypto.randomUUID().slice(0, 6)}`;
}

/** A schema-valid TransferResult for a student with no judgeable outcome (crash, timeout, bad output). */
export function failedTransfer(skill: CandidateSkill, examCase: string, student: AgentIdentity, message: string,
                               runId?: string | null): TransferResult {
  return {
    skillId: skill.id,
    ...(skill.procedureId ? { procedureId: skill.procedureId } : {}),
    examCase, student,
    ...(runId ? { runId } : {}),
    artifact: { type: skill.artifactType as ArtifactType, path: "(no artifact)" },
    verification: { passed: false, checks: [
      { name: "file_exists", passed: false, message: "no artifact: the student did not finish" },
      { name: "run_completed", passed: false, message },
    ] },
    passed: false,
  };
}

export function cleanMetrics(m: Metrics = {}): Metrics {
  const out: Metrics = {};
  const int = (v: unknown) => Math.max(0, Math.round(Number(v)));
  if (m.durationMs != null && Number.isFinite(Number(m.durationMs))) out.durationMs = int(m.durationMs);
  if (m.toolCalls != null && Number.isFinite(Number(m.toolCalls))) out.toolCalls = int(m.toolCalls);
  if (m.turns != null && Number.isFinite(Number(m.turns))) out.turns = int(m.turns);
  if (m.costUsd != null && Number.isFinite(Number(m.costUsd))) out.costUsd = Math.max(0, Number(m.costUsd));
  return out;
}

/** The runtime's side of each exam: skill.recalled (procedure handed over) and exam.started. */
export function runtimeEvents(skill: CandidateSkill, t: TransferResult, at: string): AgentUniversityEvent[] {
  const evs: AgentUniversityEvent[] = [];
  if (t.procedureId)
    evs.push({ type: "skill.recalled", at, payload: {
      skillId: skill.id, procedureId: t.procedureId, query: `${skill.name ?? skill.id}: ${t.examCase}`, rank: 1, agent: t.student } });
  evs.push({ type: "exam.started", at, payload: {
    skillId: skill.id, examCase: t.examCase, student: t.student,
    ...(t.procedureId ? { procedureId: t.procedureId } : {}), ...(t.runId ? { runId: t.runId } : {}) } });
  return evs;
}

const judgeScore = (r: JudgedRecord) => {
  const s = r.decision.certified ? r.judge?.score : undefined;
  return typeof s === "number" && Number.isFinite(s) ? s : -1;
};

/** > 0 when a ranks above b: certified first; among certified the judge score; then registry.compareRecords. */
export function compareSwarm(a: JudgedRecord, b: JudgedRecord): number {
  if (a.decision.certified !== b.decision.certified) return a.decision.certified ? 1 : -1;
  const d = judgeScore(a) - judgeScore(b);
  return d !== 0 ? d : registry.compareRecords(a, b);
}

/** Ask the judge to score certified records only and attach record.judge. Never throws. */
/** Copy a canonical record's artifact onto the host where the UI reads it:
 *  <dir>/<examCase>/<artifactType> (the UI's .agent-university/artifacts convention). */
export function publishArtifact(dir: string, record: CertificationRecord, content: string | null | undefined): string | null {
  const type = record.transfer.artifact.type;
  if (!content || !type) return null;
  const path = join(dir, record.transfer.examCase, type);
  mkdirSync(join(dir, record.transfer.examCase), { recursive: true });
  writeFileSync(path, content.endsWith("\n") ? content : content + "\n");
  return path;
}

export async function applyJudge(judge: JudgeFn, certified: JudgedRecord[], artifacts: Record<string, string | null>): Promise<JudgeInfo> {
  const model = judge.model ?? (judge.name || "judge");
  if (!certified.length) return { status: "skipped", model, reason: "no certified record to rank" };
  let scores: unknown;
  try {
    scores = await judge(certified, Object.fromEntries(certified.map((r) => [judgeKey(r), artifacts[judgeKey(r)] ?? null])));
  } catch (e) {
    return { status: "unavailable", model, reason: `${(e as Error)?.name ?? "Error"}: ${(e as Error)?.message ?? e}`.slice(0, 300) };
  }
  if (!scores || typeof scores !== "object") return { status: "unavailable", model, reason: "judge returned no rankings" };
  let judged = 0;
  let digest: string | undefined;
  for (const r of certified) {
    const v = (scores as Record<string, any>)[judgeKey(r)];
    const score = v?.score;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    r.judge = {
      model: v.model ?? model, score: Math.max(0, Math.min(10, score)), rationale: String(v.rationale ?? "").slice(0, 1000),
      ...(v.promptDigest ? { promptDigest: v.promptDigest } : {}), ...(v.servedBy ? { servedBy: v.servedBy } : {}),
    };
    digest ??= v.promptDigest;
    judged++;
  }
  if (!judged) return { status: "unavailable", model, reason: "judge scored none of the certified records" };
  return { status: "ok", model, judged, certified: certified.length, ...(digest ? { promptDigest: digest } : {}) };
}

type Outcome = { transfer: TransferResult; metrics: Metrics; isolation: Record<string, boolean>; error: string | null; artifact: string | null };

export async function runSwarm(skill: CandidateSkill, n: number, launchStudent: LaunchStudent, opts: SwarmOptions = {}): Promise<SwarmSummary> {
  if (n < 1) throw new Error("a swarm needs at least one student");
  const cases = opts.cases ?? loadCases();
  const examCase = opts.examCase ?? cases.find((c) => c.role === "exam" && c.skillId === skill.id && !c.fixtureOnly)?.id ?? "unknown-exam";
  const swarmId = opts.swarmId ?? newSwarmId(examCase);
  const studentFor = opts.studentFor ?? ((i: number) => defaultStudent(i, swarmId));
  const isolationFor = opts.isolationFor ?? ((_i, _t, facts) => facts);
  const startedAt = opts.decidedAt ?? now();
  const caseOf = (i: number) => opts.caseFor?.(i) ?? examCase;
  const where = (c: string) => ({ examCase: c, examCompany: cases.find((x) => x.id === c)?.company ?? null });

  const fail = (i: number, msg: string, t0: number, student?: AgentIdentity, runId?: string | null): Outcome => ({
    transfer: failedTransfer(skill, caseOf(i), student ?? studentFor(i), msg, runId),
    metrics: { durationMs: Date.now() - t0, toolCalls: 0, turns: 0 }, isolation: {}, error: msg, artifact: null,
  });

  async function attempt(i: number): Promise<Outcome> {
    const t0 = Date.now();
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const launched = Promise.resolve().then(() => launchStudent(i, ctl.signal));
      const out = opts.timeoutMs == null ? await launched : await Promise.race([launched, new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const e = Object.assign(new Error(`student timed out after ${opts.timeoutMs! / 1000}s`), { name: "TimeoutError" });
          ctl.abort(e);
          reject(e);
        }, opts.timeoutMs);
      })]);
      const errs = contractErrors(out?.transfer, "contracts/transfer-result.schema.json");
      if (errs.length) {
        const student = contractErrors(out?.transfer?.student, "contracts/agent-identity.schema.json").length ? undefined : out.transfer.student;
        return fail(i, `launcher returned an invalid TransferResult: ${errs.slice(0, 3).join("; ")}`, t0, student, out?.transfer?.runId);
      }
      const metrics = { ...(out.metrics ?? {}) };
      metrics.durationMs ??= Date.now() - t0;
      return { transfer: out.transfer, metrics, isolation: out.isolation ?? {}, error: null, artifact: out.artifact ?? null };
    } catch (e) {
      const kind = (e as Error)?.name === "TimeoutError" ? "timed out" : "crashed";
      return fail(i, `student ${kind}: ${(e as Error)?.name ?? "Error"}: ${(e as Error)?.message ?? e}`, t0);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Bounded concurrency: at most maxParallel students in flight.
  // Each student is certified the moment it finishes, so progress can be streamed.
  const outcomes: Outcome[] = new Array(n + 1);
  const decided: JudgedRecord[] = new Array(n + 1);
  const heat = opts.heat ?? 1;
  const decide = (i: number, o: Outcome) => {
    const iso = isolationFor(i, o.transfer, o.isolation);
    const record: JudgedRecord = certify(skill, o.transfer, {
      cases, events: opts.events, isolation: iso && Object.keys(iso).length ? iso : null, decidedAt: opts.decidedAt });
    record.metrics = cleanMetrics(o.metrics);
    record.swarm = { swarmId, student: i }; // extra key; consumers ignore unknown keys
    decided[i] = record;
    emit(opts.onEvent, {
      type: "student.finished", at: now(), heat, i, student: record.transfer.student, ...where(record.transfer.examCase),
      procedureId: record.procedureId ?? null, runId: record.transfer.runId ?? null,
      certified: record.decision.certified, status: record.decision.status, summary: record.decision.summary,
      failedRules: record.decision.failedRules, failedChecks: record.verification.checks.filter((c) => !c.passed).map((c) => c.name),
      metrics: record.metrics ?? {}, error: o.error,
      rulings: record.decision.rulings.map(({ rule, passed, reason }) => ({ rule, passed, reason })),
    });
    return iso;
  };
  const isolations: (Record<string, boolean> | null)[] = new Array(n + 1);
  let next = 1;
  const workers = Array.from({ length: Math.max(1, Math.min(opts.maxParallel ?? 10, n)) }, async () => {
    while (next <= n) {
      const i = next++;
      const release = opts.limiter ? await opts.limiter.acquire() : null;
      try {
        emit(opts.onEvent, { type: "student.started", at: now(), heat, i, student: studentFor(i), ...where(caseOf(i)),
          procedureId: skill.procedureId ?? null });
        outcomes[i] = await attempt(i);
      } finally {
        release?.();
      }
      isolations[i] = decide(i, outcomes[i]);
    }
  });
  await Promise.all(workers);

  const records: JudgedRecord[] = [];
  const students: SwarmSummary["students"] = [];
  const artifacts: Record<string, string | null> = {};
  const errors: Record<number, string | null> = {};
  for (let i = 1; i <= n; i++) {
    const o = outcomes[i];
    const iso = isolations[i];
    const record = decided[i];
    records.push(record);
    artifacts[judgeKey(record)] = o.artifact;
    errors[i] = o.error;
    students.push({ student: i, transfer: o.transfer, isolation: iso ?? {},
      events: [...runtimeEvents(skill, o.transfer, startedAt), ...record.events] });
  }

  const certified = records.filter((r) => r.decision.certified);
  const judge: JudgeInfo = opts.judge ? await applyJudge(opts.judge, certified, artifacts) : { status: "disabled" };
  const winner = records.reduce((best, r) => (compareSwarm(r, best) > 0 ? r : best));

  let promoted: boolean | null = null;
  let canonical: SwarmSummary["canonical"] = null;
  if (opts.promote ?? true) {
    promoted = false;
    for (const r of [...records.filter((r) => r !== winner), winner])
      if (registry.recordDecision(r) && r === winner) promoted = true;
    if (promoted && opts.artifactsDir) publishArtifact(opts.artifactsDir, winner, artifacts[judgeKey(winner)]);
    const current = registry.load(skill.id) as CertificationRecord | null;
    if (current) canonical = {
      runId: current.transfer.runId ?? null, student: current.transfer.student.name,
      isWinner: current.transfer.runId === winner.transfer.runId && current.transfer.student.id === winner.transfer.student.id,
    };
  }

  const ranked = [...records].sort((a, b) => compareSwarm(b, a));
  const count = certified.length;
  return {
    swarmId, skillId: skill.id, examCase, n, startedAt, finishedAt: opts.decidedAt ?? now(),
    certifiedCount: count, passRate: Math.round((count / n) * 1000) / 1000, rankedBy: RANKED_BY, judge,
    winner: {
      studentId: winner.transfer.student.id, student: winner.transfer.student.name, runId: winner.transfer.runId ?? null,
      certified: winner.decision.certified, summary: winner.decision.summary, judgeScore: winner.judge?.score ?? null, promoted,
    },
    canonical,
    leaderboard: ranked.map((r, k) => ({
      rank: k + 1, student: r.transfer.student.name, studentId: r.transfer.student.id, runId: r.transfer.runId ?? null,
      certified: r.decision.certified, status: r.decision.status, failedRules: r.decision.failedRules,
      failedChecks: r.verification.checks.filter((c) => !c.passed).map((c) => c.name),
      error: errors[r.swarm!.student], metrics: r.metrics ?? {}, judge: r.judge ?? null,
    })),
    students, records, artifacts,
  };
}

// ------------------------------------------------------------------ output

export function saveSummary(s: SwarmSummary, outDir = join(RECORD_DIR, "swarms")): string {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${s.swarmId}.json`);
  const { records: _full, artifacts: _a, ...lean } = s; // full records live in the registry ledger
  writeFileSync(path, JSON.stringify(lean, null, 2) + "\n");
  return path;
}

/** Plain-text table; the last column is left unpadded. */
export function textTable(head: string[], rows: string[][]): string {
  const widths = head.slice(0, -1).map((_, c) => Math.max(...[head, ...rows].map((r) => r[c].length)));
  const fmt = (r: string[]) => r.slice(0, -1).map((v, c) => v.padEnd(widths[c])).join("  ") + "  " + r[r.length - 1];
  return [fmt(head), fmt([...widths.map((w) => "-".repeat(w)), "-".repeat(Math.max(3, head[head.length - 1].length))]),
    ...rows.map(fmt)].join("\n");
}

export const fmtMetrics = (m: Metrics) => [String(m.toolCalls ?? "-"), String(m.turns ?? "-"),
  m.durationMs != null ? `${(m.durationMs / 1000).toFixed(1)}s` : "-", m.costUsd != null ? `$${m.costUsd.toFixed(3)}` : "-"];

/** The per-student rows of a swarm leaderboard (with the jev column). */
export function boardTable(board: LeaderboardRow[]): string {
  const head = ["#", "student", "run", "cert", "status", "jev", "tools", "turns", "time", "cost", "why not"];
  const rows = board.map((e) => {
    let why = e.failedRules.join(", ");
    if (e.failedChecks.length && e.failedRules.includes("verifier_checks_passed")) why += ` [${e.failedChecks.join(", ")}]`;
    return [String(e.rank), e.student ?? "?", e.runId ?? "-", e.certified ? "YES" : "no", e.status,
      e.judge ? String(e.judge.score) : "-", ...fmtMetrics(e.metrics), why || "-"];
  });
  return textTable(head, rows);
}

export function leaderboardTable(s: SwarmSummary): string {
  const lines = [boardTable(s.leaderboard), ""];
  const { winner: w, judge: j, canonical: c } = s;
  lines.push(`${s.certifiedCount}/${s.n} students certified (pass rate ${Math.round(s.passRate * 100)}%); ` +
    "certification is deterministic, the judge only orders certified records");
  lines.push(j.status === "ok"
    ? `judge: ${j.model} scored ${j.judged}/${j.certified} certified records${j.promptDigest ? ` (prompt ${j.promptDigest.slice(0, 19)}...)` : ""}`
    : `judge: ${j.status}${j.reason ? ` (${j.reason}); deterministic ranking used` : ""}`);
  if (w?.certified) {
    lines.push(`winner: ${w.student} [${w.studentId}] run ${w.runId}: ${w.summary}${w.judgeScore != null ? `, jev ${w.judgeScore}` : ""}`);
    if (c?.isWinner) lines.push(`canonical: the winner${w.promoted ? " (newly promoted)" : ""}`);
    else if (c) lines.push(`canonical: NOT the winner; the registry kept ${c.student} run ${c.runId} (its rankKey is higher)`);
    const rationale = s.leaderboard.find((e) => e.runId === w.runId)?.judge?.rationale;
    if (rationale) lines.push(`jev: ${rationale}`);
  } else lines.push("winner: none. No student was certified, so nothing was promoted.");
  return lines.join("\n");
}

// ------------------------------------------------------------------ run metrics (QM run object)

const ts = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v > 1e11 ? v : v * 1000;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
};
const START_KEYS = ["startedAt", "started_at", "createdAt", "created_at"];
const END_KEYS = ["finishedAt", "finished_at", "completedAt", "completed_at", "endedAt", "ended_at", "updatedAt"];
const COST_KEYS = ["costUsd", "cost_usd", "totalCostUsd", "total_cost_usd"];

/**
 * Metrics from GET /api/runs/<id>. toolCalls: activity entries of type tool_call. turns: model
 * round trips (text/thinking/tool_call runs split by tool_result), or run.turns. durationMs: run
 * start/end timestamps, else first/last activity timestamps, else wall clock. costUsd: only when
 * the run reports a cost; token counts alone are not priced.
 */
export function runMetrics(runObj: any, wallMs: number): Metrics {
  const activity: any[] = Array.isArray(runObj?.activity) ? runObj.activity : [];
  const toolCalls = activity.filter((a) => a?.type === "tool_call").length;
  let turns = 0;
  let inStep = false;
  for (const a of activity) {
    if (["text", "thinking", "tool_call"].includes(a?.type)) {
      if (!inStep) { turns++; inStep = true; }
    } else if (a?.type === "tool_result") inStep = false;
  }
  if (Number.isInteger(runObj?.turns)) turns = runObj.turns;
  const result = runObj?.result && typeof runObj.result === "object" ? runObj.result : {};
  const first = (o: any, keys: string[]) => { for (const k of keys) { const t = ts(o?.[k]); if (t != null) return t; } return null; };
  let start = first(runObj, START_KEYS) ?? first(result, START_KEYS);
  let end = first(runObj, END_KEYS) ?? first(result, END_KEYS);
  if (start == null || end == null || end < start) {
    const stamps = activity.map((a) => first(a, ["at", "ts", "timestamp", "createdAt"])).filter((t): t is number => t != null);
    [start, end] = stamps.length >= 2 ? [Math.min(...stamps), Math.max(...stamps)] : [null, null];
  }
  const m: Metrics = { durationMs: Math.round(start != null && end != null ? end - start : wallMs), toolCalls, turns };
  for (const src of [runObj, result, runObj?.usage, result?.usage]) {
    const c = src && typeof src === "object" ? COST_KEYS.map((k) => src[k]).find((v) => typeof v === "number") : undefined;
    if (c !== undefined) { m.costUsd = c; break; }
  }
  return m;
}

/** Errors of `value` against schemas/<rel>, e.g. "contracts/event.schema.json". Empty when valid. */
export const contractErrors = (value: unknown, rel: string) => errorsAgainst(value, rel);
