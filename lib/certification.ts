// Certification engine: decide whether a skill graduates to `certified`. Owned by feat/certification.
//
// One successful run is not enough. A skill becomes trusted only when a *different* agent,
// given only the recalled procedure, passes an *unseen* exam case and the artifact passes
// every required deterministic verifier check.
//
//   candidate Skill + TransferResult + VerificationResult
//                         |
//                certification policy (RULES, all deterministic, no LLM)
//                         |
//         CertificationRecord (schemas/certification-record.schema.json)
//
// Canonical record schema: schemas/certification-record.schema.json. `npm test` fails if
// CertificationRecord's fields drift from it. Nothing in ./types (the frozen contracts) changes.
//
// Where the UI reads records:
//   registry/index.json            RegistryIndex: one row per certified skill
//   registry/skills/<id>.json      CertificationRecord: the canonical record of a certified skill
//   registry/ledger.jsonl          CertificationRecord per line: every decision, pass or fail
//   demo/fixtures/certification-record{,-failed}.json   demo mode

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentIdentity,
  AgentUniversityEvent,
  ArtifactType,
  Skill,
  SkillStatus,
  TransferResult,
  VerificationResult,
} from "./types.ts";
import { COMPANY_CHECKS, verifyCompanyFile } from "./verifiers/company.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const POLICY_ID = "au-transfer-v1";
export const RECORD_VERSION = 1;

// Stable rule ids of policy au-transfer-v1, in evaluation order.
export type CertificationRule =
  | "teacher_run_verified"
  | "procedure_recalled"
  | "exam_case_unseen"
  | "student_distinct_from_teacher"
  | "artifact_matches_skill"
  | "verifier_checks_complete"
  | "verifier_checks_passed"
  | "isolation_attested";

export const RULES: CertificationRule[] = [
  "teacher_run_verified",
  "procedure_recalled",
  "exam_case_unseen",
  "student_distinct_from_teacher",
  "artifact_matches_skill",
  "verifier_checks_complete",
  "verifier_checks_passed",
  "isolation_attested",
];

// The rules that must hold for an exam to have *happened* (status `transferred`).
const TRANSFER_RULES: CertificationRule[] = [
  "teacher_run_verified",
  "exam_case_unseen",
  "student_distinct_from_teacher",
  "artifact_matches_skill",
];

// Per artifact type: the deterministic verifier and the check names it must report. A
// verifier that silently drops a check cannot certify anything.
export const VERIFIERS: Partial<Record<ArtifactType, { requiredChecks: readonly string[]; verifyFile: (path: string) => VerificationResult }>> = {
  "company.json": { requiredChecks: COMPANY_CHECKS, verifyFile: verifyCompanyFile },
};

export interface Ruling {
  rule: CertificationRule;
  passed: boolean;
  reason: string; // human-readable, show it verbatim
  evidence: Record<string, unknown>;
}

export interface CertificationRecord {
  recordVersion: number;
  skill: Skill; // status is the decision's outcome
  teacher: AgentIdentity;
  procedureId?: string;
  transfer: {
    student: AgentIdentity;
    examCase: string;
    examCompany?: string;
    runId?: string;
    artifact: { type?: ArtifactType; path?: string };
    passed: boolean;
  };
  verification: VerificationResult;
  decision: {
    certified: boolean;
    status: SkillStatus;
    policy: { id: string; rules: CertificationRule[]; requireIsolation?: boolean };
    summary: string; // "CERTIFIED: all 8 rules passed" | "NOT CERTIFIED (transferred): failed …"
    failedRules: CertificationRule[];
    rulings: Ruling[];
    decidedAt: string;
    inputsDigest: string;
  };
  events: AgentUniversityEvent[]; // exam.passed and/or skill.certified, when earned
  metrics?: { durationMs?: number; toolCalls?: number; turns?: number; costUsd?: number };
}

export interface RegistryIndex {
  skills: {
    id: string;
    name: string;
    status: SkillStatus;
    artifactType: ArtifactType;
    teacher: AgentIdentity;
    student: AgentIdentity;
    examCase: string;
    procedureId?: string;
    certifiedAt: string;
    policy: string;
    record: string; // repo path of the canonical CertificationRecord
    // The trusted Memorable flow, when a flow tournament promoted it.
    procedure?: { procedureId: string; title: string; passRate: number; runs: number; judgeScore: number | null;
      tournamentId: string; record: string };
  }[];
}

export interface Case {
  id: string;
  role: "teacher" | "exam";
  skillId: string;
  company: string;
  artifactType: ArtifactType;
  fixtureOnly?: boolean;
}

/** A Skill as the runtime stores it: optionally with its lifecycle events attached. */
export type CandidateSkill = Skill & { events?: AgentUniversityEvent[] };

export interface CertifyOptions {
  cases?: Case[];
  events?: AgentUniversityEvent[];
  isolation?: Record<string, boolean> | null;
  reverify?: boolean;
  requireIsolation?: boolean;
  decidedAt?: string;
}

export function loadCases(path = join(ROOT, "demo", "cases.json")): Case[] {
  return JSON.parse(readFileSync(path, "utf8")).cases;
}

/** JSON with sorted keys, so equal values always hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export const digest = (...values: unknown[]) =>
  "sha256:" + createHash("sha256").update(canonicalJson(values)).digest("hex");

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** The latest `skill.observed` payload for this skill by its teacher, or null. */
export function teacherObservation(skill: CandidateSkill, events: AgentUniversityEvent[] = []) {
  let found: AgentUniversityEvent<"skill.observed">["payload"] | null = null;
  for (const e of [...(skill.events ?? []), ...events]) {
    if (e.type !== "skill.observed") continue;
    const p = e.payload as AgentUniversityEvent<"skill.observed">["payload"];
    if (p.skillId === skill.id && p.teacher?.id === skill.teacher?.id) found = p;
  }
  return found;
}

export function certify(skill: CandidateSkill, transfer: Partial<TransferResult>, opts: CertifyOptions = {}): CertificationRecord {
  const cases = opts.cases ?? loadCases();
  const rulings: Ruling[] = [];
  const rule = (id: CertificationRule, ok: boolean, reason: string, evidence: Record<string, unknown> = {}) => {
    rulings.push({ rule: id, passed: ok, reason, evidence });
    return ok;
  };

  const teacher = (skill.teacher ?? {}) as AgentIdentity;
  const student = (transfer.student ?? {}) as AgentIdentity;
  const artifact = (transfer.artifact ?? {}) as CertificationRecord["transfer"]["artifact"];
  const artifactType = skill.artifactType as ArtifactType;
  let verification: VerificationResult = transfer.verification ?? { passed: false, checks: [] };

  // 1. The skill was observed: a teacher produced an artifact that passed its verifier.
  const obs = teacherObservation(skill, opts.events);
  if (!teacher.id) rule("teacher_run_verified", false, "skill has no teacher");
  else if (!obs) rule("teacher_run_verified", false, `no skill.observed event by teacher ${teacher.id}`, { teacher });
  else {
    const ok = obs.verification?.passed === true;
    rule("teacher_run_verified", ok, `teacher run ${obs.runId} ${ok ? "passed" : "did not pass"} its verifier`,
      { teacher, runId: obs.runId, artifactPath: obs.artifactPath });
  }

  // 2. The student worked from the stored procedure (Memorable), not from the teacher's answer.
  const proc = transfer.procedureId;
  const want = skill.procedureId;
  const procOk = !!proc && (!want || proc === want);
  rule("procedure_recalled", procOk,
    !proc ? "no procedureId on the transfer"
      : procOk ? `student used procedure ${proc}`
      : `student used ${proc} but the skill's procedure is ${want}`,
    { procedureId: proc ?? null, skillProcedureId: want ?? null });

  // 3. The exam case is a known exam case for this skill and differs from what the teacher saw.
  const exam = cases.find((c) => c.id === transfer.examCase);
  const taught = cases.filter((c) => c.role === "teacher" && c.skillId === skill.id).map((c) => c.company);
  if (!exam) rule("exam_case_unseen", false, `exam case ${JSON.stringify(transfer.examCase ?? null)} is not in demo/cases.json`);
  else if (exam.role !== "exam" || exam.skillId !== skill.id)
    rule("exam_case_unseen", false, `${exam.id} is not an exam case for ${skill.id}`, { examCase: exam });
  else {
    const ok = !taught.includes(exam.company);
    rule("exam_case_unseen", ok,
      ok ? `exam company ${exam.company} differs from teacher case ${taught.join(", ") || "(none)"}`
        : `exam company ${exam.company} is the case the teacher learned from`,
      { examCase: exam.id, examCompany: exam.company, teacherCases: taught });
  }

  // 4. A different agent took the exam.
  const distinct = !!student.id && student.id !== teacher.id;
  rule("student_distinct_from_teacher", distinct,
    distinct ? `student ${student.id} (${student.harness}) != teacher ${teacher.id} (${teacher.harness})`
      : student.id ? "student and teacher are the same agent" : "transfer has no student",
    { student, teacher, crossHarness: student.harness !== teacher.harness });

  // 5. The exam is for this skill and actually produced this skill's artifact.
  const produced = verification.checks?.some((c) => c.name === "file_exists" && c.passed) ?? false;
  const matches = transfer.skillId === skill.id && artifact.type === artifactType;
  rule("artifact_matches_skill", matches && produced,
    !matches ? `transfer is ${transfer.skillId}/${artifact.type}, skill is ${skill.id}/${artifactType}`
      : !produced ? `the student produced no ${artifactType}`
      : `${artifact.type} at ${artifact.path}`,
    { artifact, produced });

  // Optional: do not trust the reported verification; recompute it from the artifact.
  const spec = VERIFIERS[artifactType];
  let reverified: VerificationResult | null = null;
  if (opts.reverify && artifact.path && spec) {
    reverified = spec.verifyFile(artifact.path);
    verification = reverified;
  }

  // 6. Every required check ran.
  const names = (verification.checks ?? []).map((c) => c.name);
  if (!spec) rule("verifier_checks_complete", false, `no deterministic verifier registered for ${artifactType}`);
  else {
    const missing = spec.requiredChecks.filter((n) => !names.includes(n));
    rule("verifier_checks_complete", missing.length === 0,
      missing.length ? `missing required checks: ${missing.join(", ")}` : `all ${spec.requiredChecks.length} required checks reported`,
      { required: [...spec.requiredChecks], reported: names, source: reverified ? "re-run" : "reported" });
  }

  // 7. Every check passed, and the pass flags agree with each other.
  const checks = verification.checks ?? [];
  const failed = checks.filter((c) => !c.passed).map((c) => c.name);
  const consistent = verification.passed === (checks.length > 0 && failed.length === 0)
    && (reverified !== null || transfer.passed === verification.passed);
  const checksOk = checks.length > 0 && failed.length === 0 && consistent;
  rule("verifier_checks_passed", checksOk,
    checksOk ? `${checks.length}/${checks.length} checks passed`
      : failed.length ? `failed checks: ${failed.join(", ")}`
      : !checks.length ? "no checks reported" : "passed flags disagree with the checks",
    { passedCount: checks.length - failed.length, total: checks.length, failed });

  // 8. Isolation facts from the runtime (different scope/sandbox/session, no leak), if any: the
  // explicit option, else the `isolation` key runtime adds to its TransferResult (transfer_run.py).
  const reported = (transfer as { isolation?: unknown }).isolation;
  const facts = opts.isolation
    ?? (reported && typeof reported === "object" && !Array.isArray(reported) ? reported as Record<string, boolean> : {});
  const broken = Object.keys(facts).filter((k) => facts[k] !== true).sort();
  const requireIsolation = opts.requireIsolation ?? false;
  if (!Object.keys(facts).length)
    rule("isolation_attested", !requireIsolation,
      `no isolation facts supplied${requireIsolation ? " but the policy requires them" : "; distinct agent identity only"}`);
  else
    rule("isolation_attested", broken.length === 0,
      broken.length ? `isolation broken: ${broken.join(", ")}` : `all ${Object.keys(facts).length} isolation facts hold`,
      { facts });

  const passed = Object.fromEntries(rulings.map((r) => [r.rule, r.passed])) as Record<CertificationRule, boolean>;
  const certified = rulings.every((r) => r.passed);
  const transferred = TRANSFER_RULES.every((r) => passed[r]);
  const status: SkillStatus = certified ? "certified" : transferred ? "transferred" : "observed";
  const failedRules = rulings.filter((r) => !r.passed).map((r) => r.rule);
  const examPassed = transferred && passed.verifier_checks_complete && passed.verifier_checks_passed;

  const at = opts.decidedAt ?? now();
  const examCase = transfer.examCase as string;
  const contractSkill: Skill = {
    id: skill.id,
    name: skill.name,
    status,
    teacher: skill.teacher,
    artifactType: skill.artifactType,
    ...(skill.procedureId ? { procedureId: skill.procedureId } : {}),
    ...(transferred ? { transfer: { student, examCase, passed: certified } } : {}),
  };

  const events: AgentUniversityEvent[] = [];
  if (examPassed)
    events.push({ type: "exam.passed", at, payload: {
      skillId: skill.id, examCase, student, verification, ...(artifact.path ? { artifactPath: artifact.path } : {}),
    } });
  if (certified)
    events.push({ type: "skill.certified", at, payload: {
      skillId: skill.id, teacher, student, examCase, ...(transfer.procedureId ? { procedureId: transfer.procedureId } : {}),
    } });

  const procedureId = transfer.procedureId ?? skill.procedureId;
  return {
    recordVersion: RECORD_VERSION,
    skill: contractSkill,
    teacher,
    ...(procedureId ? { procedureId } : {}),
    transfer: {
      student,
      examCase,
      ...(exam ? { examCompany: exam.company } : {}),
      ...(transfer.runId ? { runId: transfer.runId } : {}),
      artifact,
      passed: certified,
    },
    verification,
    decision: {
      certified,
      status,
      policy: { id: POLICY_ID, rules: RULES, requireIsolation },
      summary: certified ? `CERTIFIED: all ${rulings.length} rules passed`
        : `NOT CERTIFIED (${status}): failed ${failedRules.join(", ")}`,
      failedRules,
      rulings,
      decidedAt: at,
      inputsDigest: digest(skill, transfer, opts.isolation ?? null, reverified),
    },
    events,
  };
}

/** The decision as a judge reads it: one line per rule, then the verdict. */
export function explain(record: CertificationRecord): string {
  const { teacher, transfer, decision } = record;
  return [
    `skill:   ${record.skill.id} (${record.skill.name})`,
    `teacher: ${teacher.name} [${teacher.id}]`,
    `student: ${transfer.student.name} [${transfer.student.id}]`,
    `exam:    ${transfer.examCase} (${transfer.examCompany ?? "unknown case"})`,
    `policy:  ${decision.policy.id}`,
    ...decision.rulings.map((r) => `  [${r.passed ? "ok" : "FAIL"}] ${r.rule}: ${r.reason}`),
    decision.summary,
  ].join("\n");
}
