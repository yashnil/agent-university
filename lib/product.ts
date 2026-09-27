// The product API behind /api/skills, /api/exam and /api/run, and behind the page's data adapter,
// so the UI and the HTTP API always return the same contracts.
//
//   live  reads the company registry (registry/, via lib/registry.ts) and runs the real engine
//   demo  reads demo/fixtures/final-demo.json: the same responses, frozen, produced by this module
//         (node scripts/final_demo.ts), and labelled demo
//
// No second registry: skills come from registry/index.json and registry/skills/<id>.json only, and
// a record is exposed as certified only when its own decision says so. Nothing here writes.
//
// Live follows whatever record is canonical now (a flow tournament may have replaced the Vercel exam);
// demo stays the frozen Vercel story, whose decision lives in registry/ledger.jsonl. Both return the
// same response contracts; their values differ, and `provenance.canonical` says which one you have.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, relative } from "node:path";
import { certify, ROOT } from "./certification.ts";
import type { CandidateSkill, CertificationRecord, RegistryIndex } from "./certification.ts";
import { composeRun } from "./composite.ts";
import type { CompositeRun } from "./composite.ts";
import * as registry from "./registry.ts";
import type { AgentUniversityEvent, SkillStatus, TransferResult, VerificationResult } from "./types.ts";

export type ApiMode = "live" | "demo";

export interface SkillsResponse {
  mode: ApiMode;
  source: string;
  skills: (RegistryIndex["skills"][number] & {
    verification: string; // "6/6" from the record
    provenance: {
      teacherRunId: string | null; examRunId: string | null; examCase: string; examCompany: string | null; realRun: boolean;
      /** True for the registry's current canonical record; false for the frozen demo's ledger decision. */
      canonical: boolean;
    };
  })[];
  ledger: { decisions: number; certified: number };
}

export interface ExamResponse {
  mode: ApiMode;
  source: string;
  policy: { id: string; reverify: true; requireIsolation: true };
  statusBefore: SkillStatus;
  status: SkillStatus;
  certified: boolean;
  checklist: { rule: string; passed: boolean; reason: string }[];
  checks: VerificationResult["checks"];
  events: AgentUniversityEvent[];
  record: CertificationRecord;
  /** Promotion is a separate, reviewed step (`node scripts/certify.ts ... --promote`); the API never writes. */
  promoted: false;
}

export type RunResponse = CompositeRun & { mode: ApiMode; source: string };

export interface FinalDemo {
  description: string;
  generatedBy: string;
  labels: { live: string[]; registry: string[]; fixture: string[] };
  exam: ExamResponse;
  skills: SkillsResponse;
  run: RunResponse;
  lifecycle: AgentUniversityEvent[];
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const FIX = join(ROOT, "demo", "fixtures");
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const readJsonOrNull = <T>(path: string): T | null => (existsSync(path) ? readJson<T>(path) : null);
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export const parseMode = (v: unknown): ApiMode => (v === "demo" ? "demo" : "live");

/** The real, sanitized Linear -> Vercel transfer: runtime's handoff to certification. */
export function vercelHandoff() {
  return {
    skill: readJson<CandidateSkill>(join(FIX, "skill-transferred-vercel.json")),
    transfer: readJson<TransferResult>(join(FIX, "transfer-result-vercel.json")),
    events: readJson<AgentUniversityEvent[]>(join(FIX, "events-vercel-transferred.json")),
  };
}

export const loadFinalDemo = (): FinalDemo => readJson<FinalDemo>(join(FIX, "final-demo.json"));

// ---- GET /api/skills -------------------------------------------------------------------------

type Certified = { record: CertificationRecord; path: string; canonical: boolean; procedure?: RegistryIndex["skills"][number]["procedure"] };

function certifiedRecords(): Certified[] {
  return registry.index().skills.flatMap((row) => {
    const record = registry.load(row.id);
    // The index is a cache; the record's own decision is authoritative.
    return record?.decision?.certified === true && record.skill.status === "certified"
      ? [{ record, path: row.record, canonical: true, ...(row.procedure ? { procedure: row.procedure } : {}) }] : [];
  });
}

export function skillsFrom(records: Certified[], mode: ApiMode, source: string,
  ledger: { decisions: number; certified: number }): SkillsResponse {
  return {
    mode, source, ledger,
    skills: records.map(({ record, path, canonical, procedure }) => {
      const teacherRunId = record.decision.rulings.find((r) => r.rule === "teacher_run_verified")?.evidence.runId;
      const checks = record.verification.checks;
      return {
        ...registry.summary(record),
        record: path, // where this record actually is: registry/skills/<id>.json, or the ledger for the frozen demo
        ...(procedure ? { procedure } : {}),
        verification: `${checks.filter((c) => c.passed).length}/${checks.length}`,
        provenance: {
          teacherRunId: typeof teacherRunId === "string" ? teacherRunId : null,
          examRunId: record.transfer.runId ?? null,
          examCase: record.transfer.examCase,
          examCompany: record.transfer.examCompany ?? null,
          realRun: typeof record.transfer.runId === "string" && !record.transfer.runId.startsWith("run-fixture"),
          canonical,
        },
      };
    }),
  };
}

export function getSkills(mode: ApiMode): SkillsResponse {
  if (mode === "demo") return loadFinalDemo().skills;
  const all = registry.ledger();
  return skillsFrom(certifiedRecords(), "live", "registry/ (index.json, skills/<id>.json)",
    { decisions: all.length, certified: all.filter((r) => r.decision.certified).length });
}

// ---- POST /api/exam --------------------------------------------------------------------------

/** Strict mode only: re-run the verifier on the artifact, and require the runtime's isolation facts. */
export function examOf(input: { skill: CandidateSkill; transfer: Partial<TransferResult>; events: AgentUniversityEvent[] },
  mode: ApiMode, source: string, decidedAt: string): ExamResponse {
  const record = certify(input.skill, input.transfer, { events: input.events, reverify: true, requireIsolation: true, decidedAt });
  return {
    mode, source,
    policy: { id: record.decision.policy.id, reverify: true, requireIsolation: true },
    statusBefore: input.skill.status,
    status: record.skill.status,
    certified: record.decision.certified,
    checklist: record.decision.rulings.map(({ rule, passed, reason }) => ({ rule, passed, reason })),
    checks: record.verification.checks,
    events: record.events,
    record,
    promoted: false,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The artifact is re-verified from disk, so only files under demo/fixtures/ may be named. */
function safeArtifactPath(path: unknown): string {
  if (typeof path !== "string" || !path || isAbsolute(path)) throw new ApiError(400, "transfer.artifact.path must be a repo-relative path under demo/fixtures/");
  const rel = relative(FIX, join(ROOT, normalize(path)));
  if (rel.startsWith("..") || isAbsolute(rel)) throw new ApiError(400, "transfer.artifact.path must be under demo/fixtures/");
  return path;
}

export function runExam(mode: ApiMode, body: unknown): ExamResponse {
  const b = isObj(body) ? body : {};
  if (b.skill === undefined && b.transfer === undefined) {
    if (b.case !== undefined && b.case !== "vercel") throw new ApiError(400, 'case must be "vercel", or pass skill + transfer + events');
    if (mode === "demo") return loadFinalDemo().exam;
    return examOf(vercelHandoff(), "live", "demo/fixtures/*-vercel*.json (real QM transfer, sanitized) → lib/certification.ts", nowIso());
  }
  if (!isObj(b.skill) || !isObj(b.transfer) || !Array.isArray(b.events)) throw new ApiError(400, "skill and transfer must be objects and events an array");
  const transfer = b.transfer as Partial<TransferResult>;
  safeArtifactPath(transfer.artifact?.path);
  return examOf({ skill: b.skill as unknown as CandidateSkill, transfer, events: b.events as AgentUniversityEvent[] },
    mode, "request body → lib/certification.ts", nowIso());
}

// ---- POST /api/run ---------------------------------------------------------------------------

const runMetrics = () => readJsonOrNull<{ runs: never[] }>(join(FIX, "run-metrics.json"));

export function runComposite(mode: ApiMode, at = nowIso()): RunResponse {
  if (mode === "demo") return loadFinalDemo().run;
  const stamp = at.replace(/[-:TZ]/g, "").slice(0, 14);
  const run = composeRun({ certified: certifiedRecords(), at, planId: `plan-${stamp}`, internId: `intern-${stamp}`,
    runMetrics: runMetrics(), observed: vercelHandoff().events });
  return { ...run, mode: "live", source: "registry/ (certified skills) + labelled stand-ins in demo/fixtures/composite/" };
}

// ---- the frozen demo state -------------------------------------------------------------------

export const DEMO_DECIDED_AT = "2026-09-27T21:58:23Z"; // the committed registry decision's timestamp
export const DEMO_RUN_AT = "2026-09-27T22:00:00Z";

/** Candidate -> exam -> certified -> composite -> GAP -> new candidate, from production code only. */
export function buildFinalDemo(): FinalDemo {
  const handoff = vercelHandoff();
  const src = "demo/fixtures/final-demo.json (frozen output of lib/product.ts)";
  const exam = { ...examOf(handoff, "demo", src, DEMO_DECIDED_AT) };
  // The frozen Vercel decision is kept in the ledger; the canonical record may have moved on since.
  const certified = [{ record: exam.record, path: "registry/ledger.jsonl", canonical: false }];
  const run = composeRun({ certified, at: DEMO_RUN_AT, planId: "plan-final-demo-0001", internId: "intern-final-demo-0001",
    runMetrics: runMetrics(), observed: handoff.events });
  return {
    description: "The final demo path, frozen: the real Vercel transfer is certified by the production engine, a fresh " +
      "Intern composes a diligence task from the certified skill, and the missing capability becomes a GAP and a candidate.",
    generatedBy: "node scripts/final_demo.ts (lib/product.ts buildFinalDemo)",
    labels: {
      live: ["teacher run 9f8d36da (Linear) and student run 5e30ec98 (Vercel) were real QM + Memorable runs, recorded"],
      registry: ["Research Company certification: production engine, strict mode, the same decision as the real Vercel entry in registry/ledger.jsonl (the canonical record in registry/skills/ may since have been replaced by a newer certified run)"],
      fixture: ["Analyze Repository and Evaluate Opportunity outputs are hand-written stand-ins (demo/fixtures/composite/)",
        "the composite run is orchestration only: no agent is executed, timestamps are step order"],
    },
    exam,
    skills: skillsFrom(certified, "demo", src, { decisions: 1, certified: 1 }),
    run: { ...run, mode: "demo", source: src },
    lifecycle: [...handoff.events, ...exam.events, ...run.events],
  };
}
