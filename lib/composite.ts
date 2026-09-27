// Composite run: a brand-new Intern (0 prior runs, 0 personal skills) takes one end-to-end
// diligence task and composes it from what the organization has certified.
//
//   certified records (registry) + the diligence plan  ->  ordered steps, plan.composed, gap.discovered,
//                                                           and a new candidate for each missing capability
//
// Deterministic and offline. It never executes an agent, so no step is `live`: a certified step
// reuses the verified output of the certified exam run (re-verified here), and the two specialist
// steps that are not implemented live run from hand-written stand-ins labelled `fixture`. A step
// with no capability at all is a GAP, which becomes a candidate, never trusted knowledge.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./certification.ts";
import type { CertificationRecord } from "./certification.ts";
import type { AgentIdentity, AgentUniversityEvent, ArtifactType, EventPayloads } from "./types.ts";
import { verifyCompanyFile } from "./verifiers/company.ts";

export type StepSource = "live" | "certified-registry" | "fixture" | "gap";
/** certified: reused from the registry. uncertified: a labelled stand-in ran. missing: no capability
 *  exists (the GAP). blocked: an input comes from a missing step. */
export type StepStatus = "certified" | "uncertified" | "missing" | "blocked";
/** `technical_contact` is an intermediate input to outreach.md, not one of the 4 pipeline artifacts. */
export type StepOutput = ArtifactType | "technical_contact";

export interface PlanStep {
  skillId: string;
  name: string;
  inputs: StepOutput[];
  output: StepOutput;
  /** A hand-written stand-in for a skill that is not implemented live (repo-relative path), or
   *  `true` when a stand-in exists but has no output for this task. Absent: no capability at all. */
  standIn?: string | true;
}

const PIPELINE: ArtifactType[] = ["company.json", "repo_analysis.json", "score.json", "outreach.md"];
const isArtifactType = (o: StepOutput): o is ArtifactType => (PIPELINE as string[]).includes(o);

export const DILIGENCE_COMPANY = "Vercel";
export const DILIGENCE_GOAL =
  `Diligence on ${DILIGENCE_COMPANY}: research the company, analyze its repository, evaluate the ` +
  "opportunity, find a technical contact, and draft outreach";

export const DILIGENCE_PLAN: PlanStep[] = [
  { skillId: "research-company", name: "Research Company", inputs: [], output: "company.json" },
  { skillId: "analyze-repository", name: "Analyze Repository", inputs: ["company.json"], output: "repo_analysis.json",
    standIn: "demo/fixtures/composite/repo_analysis-vercel.json" },
  { skillId: "evaluate-opportunity", name: "Evaluate Opportunity", inputs: ["company.json", "repo_analysis.json"],
    output: "score.json", standIn: "demo/fixtures/composite/score-vercel.json" },
  { skillId: "find-technical-contact", name: "Find Technical Contact", inputs: ["company.json", "repo_analysis.json"],
    output: "technical_contact" },
  { skillId: "draft-outreach", name: "Draft Outreach", inputs: ["company.json", "score.json", "technical_contact"],
    output: "outreach.md", standIn: true },
];

export interface CompositeStep {
  seq: number;
  skillId: string;
  skillName: string;
  status: StepStatus;
  source: StepSource;
  /** True only when the Intern inherited a certified skill for this step. */
  inherited: boolean;
  certifiedSkillId?: string;
  procedureId?: string;
  record?: string;
  evidence?: { examRunId?: string; examCase: string; teacherRunId?: string; policy: string; verification: string };
  inputs: StepOutput[];
  output: StepOutput;
  artifact: { type: StepOutput; path: string; content: unknown } | null;
  startedAt: string;
  finishedAt: string;
  note: string;
}

export interface CandidateSkill {
  id: string;
  name: string;
  status: "candidate";
  certified: false;
  produces: StepOutput;
  neededBy: string[];
  discoveredIn: string;
  discoveredAt: string;
  next: string[];
}

export type GapEvent = AgentUniversityEvent<"gap.discovered"> & {
  payload: EventPayloads["gap.discovered"] & {
    skillId: string; skillName: string; status: "candidate"; message: string; missingOutput: StepOutput; blocks: string[];
  };
};

export interface RunMetric {
  role: "teacher" | "student" | "intern";
  label: string;
  runId: string | null;
  wallClockMs: number | null;
  shellToolCalls: number | null;
  failedShellToolCalls: number | null;
  tokens: number | null;
  verification: string | null;
  note: string;
}

export interface CompositeMetrics {
  verifiedChecks: { passed: number; total: number; source: string } | null;
  teacherChecks: { passed: number; total: number } | null;
  certifiedSkillsReused: number;
  stepsFromCertified: number;
  stepsFromFixtures: number;
  stepsTotal: number;
  gapsDiscovered: number;
  candidatesCreated: number;
  blockedSteps: number;
  comparison: RunMetric[];
  sources: string[];
}

export interface CompositeRun {
  planId: string;
  goal: string;
  company: string;
  intern: { agent: AgentIdentity; priorRuns: 0; personalSkills: 0; inheritedSkills: string[] };
  recalled: { skillId: string; procedureId?: string; record: string; status: "certified" }[];
  steps: CompositeStep[];
  events: AgentUniversityEvent[];
  gaps: GapEvent[];
  candidates: CandidateSkill[];
  metrics: CompositeMetrics;
}

export interface ComposeOptions {
  /** Only certified records are used; anything else passed in is ignored (never trusted). */
  certified: { record: CertificationRecord; path: string }[];
  at: string; // ISO time of the run's first step; later steps are 1s apart (orchestration order, not agent time)
  planId: string;
  internId: string;
  runMetrics?: { runs: { role: string; case: string; runId: string; wallClockMs: number; shellToolCalls: number; failedShellToolCalls: number; tokens: number | null }[] } | null;
  /** Runtime events carrying the teacher's `skill.observed` (its verifier result), if available. */
  observed?: AgentUniversityEvent[];
}

const readJson = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const tick = (at: string, s: number) => new Date(Date.parse(at) + s * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const ratio = (checks: { passed: boolean }[]) => `${checks.filter((c) => c.passed).length}/${checks.length}`;

export function composeRun(opts: ComposeOptions): CompositeRun {
  const trusted = new Map(opts.certified
    .filter(({ record }) => record.decision?.certified === true && record.skill?.status === "certified")
    .map((c) => [c.record.skill.id, c]));
  const intern: AgentIdentity = { id: opts.internId, name: "Intern (fresh)", harness: "agent-university" };
  const produced = new Map<StepOutput, StepStatus>();
  const steps: CompositeStep[] = [];

  DILIGENCE_PLAN.forEach((plan, i) => {
    const base = {
      seq: i + 1, skillId: plan.skillId, skillName: plan.name, inputs: plan.inputs, output: plan.output,
      startedAt: tick(opts.at, 2 * i), finishedAt: tick(opts.at, 2 * i + 1),
    };
    const missingInputs = plan.inputs.filter((inp) => {
      const s = produced.get(inp);
      return s === "missing" || s === "blocked";
    });
    const cert = trusted.get(plan.skillId);
    let step: CompositeStep;
    if (missingInputs.length) {
      step = { ...base, status: "blocked", source: "gap", inherited: false, artifact: null,
        note: `Blocked: needs ${missingInputs.join(", ")}, which no capability produces. Not attempted.` };
    } else if (cert) {
      const r = cert.record;
      const path = r.transfer.artifact.path;
      const sameCase = r.transfer.examCompany === DILIGENCE_COMPANY && path && r.transfer.artifact.type === plan.output;
      // Reuse the certified exam's output only after re-verifying it now; otherwise nothing is reused.
      const check = sameCase ? verifyCompanyFile(join(ROOT, path)) : null;
      const reusable = !!check?.passed;
      step = { ...base, status: "certified", source: "certified-registry", inherited: true,
        certifiedSkillId: r.skill.id, procedureId: r.procedureId, record: cert.path,
        evidence: { examRunId: r.transfer.runId, examCase: r.transfer.examCase, policy: r.decision.policy.id,
          verification: ratio(r.verification.checks) },
        artifact: reusable ? { type: plan.output, path: path!, content: readJson(path!) } : null,
        note: reusable
          ? `Inherited certified skill ${r.skill.id}. Output reused from the certified exam run ${r.transfer.runId} ` +
            `(real QM run, recorded), re-verified now ${ratio(check!.checks)}. Not re-executed.`
          : `Inherited certified skill ${r.skill.id}; no verified output for ${DILIGENCE_COMPANY} to reuse, and the composite does not run agents live.` };
    } else if (typeof plan.standIn === "string") {
      step = { ...base, status: "uncertified", source: "fixture", inherited: false,
        artifact: { type: plan.output, path: plan.standIn, content: readJson(plan.standIn) },
        note: `Not certified and not implemented live: a hand-written stand-in (${plan.standIn}) produced ${plan.output}. Not trusted, not inherited.` };
    } else if (plan.standIn === true) {
      step = { ...base, status: "uncertified", source: "fixture", inherited: false, artifact: null,
        note: "Not certified; a stand-in exists but produced nothing for this task." };
    } else {
      step = { ...base, status: "missing", source: "gap", inherited: false, artifact: null,
        note: `No certified skill, and no procedure at all, produces ${plan.output}. Reported as a GAP; a candidate skill was created.` };
    }
    produced.set(plan.output, step.status);
    steps.push(step);
  });

  const planComposed: AgentUniversityEvent<"plan.composed"> = {
    type: "plan.composed", at: opts.at,
    payload: {
      planId: opts.planId, goal: DILIGENCE_GOAL, agent: intern,
      // The frozen PlanComposed step lists pipeline artifacts only, by the availability of a skill for each.
      steps: steps.filter((s) => isArtifactType(s.output)).map((s) => ({
        artifactType: s.output as ArtifactType,
        ...(s.status !== "missing" ? { skillId: s.skillId } : {}),
        status: s.status === "certified" ? "certified" : s.status === "missing" ? "missing" : "uncertified",
      })),
    },
  };

  const gaps: GapEvent[] = [];
  const candidates: CandidateSkill[] = [];
  for (const gap of steps.filter((s) => s.status === "missing")) {
    const blocks = steps.filter((s) => s.status === "blocked" && s.inputs.includes(gap.output));
    const missingArtifact = isArtifactType(gap.output) ? gap.output
      : (blocks.map((b) => b.output).find(isArtifactType) ?? "outreach.md");
    const message = `No certified capability for ${gap.skillName}. ${blocks.map((b) => b.skillName).join(", ") || "The plan"} ` +
      `cannot complete, so ${missingArtifact} cannot be produced from trusted skills. ${gap.skillName} is now a candidate skill.`;
    gaps.push({
      type: "gap.discovered", at: gap.finishedAt,
      payload: {
        planId: opts.planId, goal: DILIGENCE_GOAL, missingArtifactType: missingArtifact,
        ...(isArtifactType(gap.output) && blocks[0] && isArtifactType(blocks[0].output) ? { neededBy: blocks[0].output } : {}),
        reason: `${missingArtifact} needs ${gap.output}, and no skill (certified or not) produces it: ${gap.skillId} does not exist yet.`,
        skillId: gap.skillId, skillName: gap.skillName, status: "candidate", message,
        missingOutput: gap.output, blocks: blocks.map((b) => b.skillId),
      },
    });
    candidates.push({
      id: gap.skillId, name: gap.skillName, status: "candidate", certified: false, produces: gap.output,
      neededBy: blocks.map((b) => b.skillId), discoveredIn: opts.planId, discoveredAt: gap.finishedAt,
      next: ["a teacher run produces the output and passes a verifier (observed)", "Memorable captures the procedure",
        "a fresh student passes an unseen exam (transferred)", "the certification engine certifies it"],
    });
  }

  const research = steps.find((s) => s.source === "certified-registry");
  const researchRecord = research ? trusted.get(research.skillId)!.record : null;
  const rm = opts.runMetrics?.runs ?? [];
  const teacherRun = rm.find((r) => r.role === "teacher");
  const studentRun = rm.find((r) => r.role === "student");
  const teacher = researchRecord ? teacherObservation(researchRecord, opts.observed ?? []) : null;
  const reused = steps.filter((s) => s.inherited);
  const reverified = research?.artifact ? research.note.match(/re-verified now (\d+\/\d+)/)?.[1] ?? null : null;
  const metrics: CompositeMetrics = {
    verifiedChecks: researchRecord ? {
      passed: researchRecord.verification.checks.filter((c) => c.passed).length,
      total: researchRecord.verification.checks.length, source: research!.record!,
    } : null,
    teacherChecks: teacher,
    certifiedSkillsReused: new Set(reused.map((s) => s.certifiedSkillId)).size,
    stepsFromCertified: reused.length,
    stepsFromFixtures: steps.filter((s) => s.source === "fixture").length,
    stepsTotal: steps.length,
    gapsDiscovered: gaps.length,
    candidatesCreated: candidates.length,
    blockedSteps: steps.filter((s) => s.status === "blocked").length,
    comparison: [
      { role: "teacher", label: "Teacher · Linear · authored Scout skill, no recalled memory",
        runId: teacherRun?.runId ?? null, wallClockMs: teacherRun?.wallClockMs ?? null,
        shellToolCalls: teacherRun?.shellToolCalls ?? null, failedShellToolCalls: teacherRun?.failedShellToolCalls ?? null,
        tokens: null, verification: teacher ? `${teacher.passed}/${teacher.total}` : null, note: "real QM run" },
      { role: "student", label: "Student · Vercel · recalled Memorable procedure",
        runId: studentRun?.runId ?? null, wallClockMs: studentRun?.wallClockMs ?? null,
        shellToolCalls: studentRun?.shellToolCalls ?? null, failedShellToolCalls: studentRun?.failedShellToolCalls ?? null,
        tokens: null, verification: researchRecord ? ratio(researchRecord.verification.checks) : null, note: "real QM run" },
      { role: "intern", label: "Intern · Vercel · certified reuse",
        runId: null, wallClockMs: null, shellToolCalls: 0, failedShellToolCalls: 0, tokens: null,
        verification: reverified, note: "the research step was inherited, not re-run: no agent time to report" },
    ],
    sources: [...(research?.record ? [research.record] : []), ...(opts.runMetrics ? ["demo/fixtures/run-metrics.json"] : [])],
  };

  return {
    planId: opts.planId, goal: DILIGENCE_GOAL, company: DILIGENCE_COMPANY,
    intern: { agent: intern, priorRuns: 0, personalSkills: 0, inheritedSkills: [...trusted.keys()] },
    recalled: [...trusted.values()].map(({ record, path }) => ({
      skillId: record.skill.id, ...(record.procedureId ? { procedureId: record.procedureId } : {}), record: path,
      status: "certified" as const,
    })),
    steps,
    events: [planComposed, ...gaps],
    gaps,
    candidates,
    metrics,
  };
}

/** The teacher's verifier result, from its skill.observed event (the one teacher_run_verified cites). */
function teacherObservation(record: CertificationRecord, events: AgentUniversityEvent[]) {
  const runId = record.decision.rulings.find((r) => r.rule === "teacher_run_verified" && r.passed)?.evidence.runId;
  const obs = events.find((e) => e.type === "skill.observed"
    && (e.payload as EventPayloads["skill.observed"]).runId === runId);
  if (!obs) return null;
  const checks = (obs.payload as EventPayloads["skill.observed"]).verification.checks;
  return { passed: checks.filter((c) => c.passed).length, total: checks.length };
}
