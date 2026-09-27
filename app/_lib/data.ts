// UI-only data access. Owned by feat/ui-demo.
//
// Sources, in order of authority:
//   registry/skills/<id>.json                     canonical CertificationRecord (committed by
//                                                 feat/certification's `certify.ts --promote`)
//   .agent-university/skills/<id>.json            the live runtime record (gitignored)
//   demo/fixtures/**                              committed, fictional; the demo-mode default
//
// Demo mode never needs QM, Docker, secrets or the network.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CertificationRecord, RegistryIndex } from "@/lib/certification";
import type {
  AgentIdentity,
  AgentUniversityEvent,
  EventPayloads,
  Skill,
  SkillStatus,
  TransferResult,
  VerificationResult,
} from "@/lib/types";

export type Mode = "demo" | "live";
/**
 * Which recorded story to present. `northwind` is the fictional end-to-end lifecycle (certified,
 * with the composition GAP). `vercel` is the real, sanitized Linear -> Vercel transfer exam that
 * feat/runtime produced, which stops at `transferred` until certification promotes it.
 */
export type DemoCaseId = "northwind" | "vercel";
/** Demo mode can present either recorded outcome. Live mode shows whatever the record says. */
export type Outcome = "certified" | "failed";

export interface DemoCase {
  id: string;
  role: "teacher" | "exam";
  skillId: string;
  company: string;
  artifactType: string;
  fixtureOnly?: boolean;
}

export interface Artifacts {
  company: Record<string, unknown>;
  repoAnalysis: Record<string, unknown>;
  score: Record<string, unknown>;
  outreach: string;
}

/** One rule of the certification policy, flattened for display. */
export interface RulingView {
  rule: string;
  passed: boolean;
  reason: string;
  evidence?: Record<string, unknown>;
}

export interface RegistryView {
  rows: RegistryIndex["skills"];
  source: string;
}

export interface CertificationView {
  policyId: string;
  /** From policy.requireIsolation: whether isolation facts were required, not just recorded. */
  requireIsolation: boolean;
  summary: string;
  certified: boolean;
  status: SkillStatus;
  failedRules: string[];
  rulings: RulingView[];
  decidedAt?: string;
  inputsDigest?: string;
  /** Optional in the contract, and absent on hand-certified records. */
  metrics?: { durationMs?: number; toolCalls?: number; turns?: number; costUsd?: number };
  /** Where this decision was read from, for the footer. */
  from: string;
}

export interface LifecycleData {
  mode: Mode;
  outcome: Outcome;
  demoCase: DemoCaseId;
  /** True when the data on screen came from a real QM run (sanitized), not invented fixtures. */
  fromRealRun: boolean;
  /** What actually produced the data on screen. */
  source: string;
  /** Set when the requested source was unavailable or incomplete. */
  liveNote: string | null;
  events: AgentUniversityEvent[];
  skillObserved: Skill;
  skillCertified: Skill | null;
  transfer: TransferResult;
  certification: CertificationView | null;
  /** registry/index.json: what the organization actually trusts. Null when nothing is promoted. */
  registry: RegistryView | null;
  cases: DemoCase[];
  artifacts: Artifacts;
  plan: EventPayloads["plan.composed"] | null;
  gap: EventPayloads["gap.discovered"] | null;
}

/** A live runtime record: a Skill with the events emitted for it so far. */
type LiveRecord = Skill & { events?: AgentUniversityEvent[]; transferResult?: TransferResult };

const ROOT = process.cwd();
const FIXTURES = path.join(ROOT, "demo", "fixtures");

async function readJson<T>(...segments: string[]): Promise<T> {
  return JSON.parse(await readFile(path.join(...segments), "utf8")) as T;
}

async function readJsonOrNull<T>(...segments: string[]): Promise<T | null> {
  try {
    return await readJson<T>(...segments);
  } catch {
    return null;
  }
}

function firstPayload<T extends keyof EventPayloads>(
  events: AgentUniversityEvent[],
  type: T,
): EventPayloads[T] | null {
  const found = events.find((event) => event.type === type);
  return found ? (found.payload as EventPayloads[T]) : null;
}

/**
 * QM scope slugs embed the operator's email: a real sandbox is named
 * `qm-sbx-personal-<slugified-admin-email>-<hash>` and live artifact paths carry it. None of that
 * belongs on a projector or a stream, so every live path is redacted for display.
 */
export function redactPath(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "<redacted>")
    .replace(/(personal-)(.+?)(-[0-9a-f]{6,})/g, "$1<redacted>$3");
}

function redactEvents(events: AgentUniversityEvent[]): AgentUniversityEvent[] {
  return events.map((event) => {
    const payload = event.payload as Record<string, unknown>;
    if (typeof payload.artifactPath !== "string") return event;
    return {
      ...event,
      payload: { ...payload, artifactPath: redactPath(payload.artifactPath) },
    } as AgentUniversityEvent;
  });
}

/**
 * The live artifact is written inside the QM sandbox container, so the UI can only show it once
 * runtime copies it onto the host. Convention:
 * .agent-university/artifacts/<examCase>/<artifactType>.
 */
async function readLiveArtifact(examCase: string, name: string): Promise<Record<string, unknown> | null> {
  return readJsonOrNull<Record<string, unknown>>(ROOT, ".agent-university", "artifacts", examCase, name);
}

/**
 * A promoted record's artifact path is either a sandbox path (only readable inside the QM
 * container) or a repo-relative path that certification committed. Read the latter, so the page
 * shows the artifact that was actually certified rather than a stand-in.
 */
async function readArtifactAtPath(artifactPath: string | undefined): Promise<Record<string, unknown> | null> {
  if (!artifactPath || artifactPath.startsWith("/") || artifactPath.includes("..")) return null;
  return readJsonOrNull<Record<string, unknown>>(ROOT, artifactPath);
}

/** registry/index.json is committed, so it is real in every mode. */
async function readRegistry(): Promise<RegistryView | null> {
  const index = await readJsonOrNull<RegistryIndex>(ROOT, "registry", "index.json");
  if (!index?.skills) return null;
  return { rows: index.skills, source: "registry/index.json" };
}

function toCertificationView(record: CertificationRecord, from: string): CertificationView {
  return {
    policyId: record.decision.policy?.id ?? "unknown",
    requireIsolation: record.decision.policy?.requireIsolation === true,
    summary: record.decision.summary,
    certified: record.decision.certified,
    status: record.decision.status,
    failedRules: record.decision.failedRules ?? [],
    rulings: record.decision.rulings ?? [],
    decidedAt: record.decision.decidedAt,
    inputsDigest: record.decision.inputsDigest,
    metrics: record.metrics,
    from,
  };
}

function toTransferResult(record: CertificationRecord, fallback: TransferResult): TransferResult {
  return {
    skillId: record.skill.id,
    procedureId: record.procedureId ?? record.skill.procedureId,
    examCase: record.transfer.examCase,
    student: record.transfer.student,
    runId: record.transfer.runId,
    artifact: {
      type: record.transfer.artifact.type ?? fallback.artifact.type,
      path: redactPath(record.transfer.artifact.path ?? fallback.artifact.path),
    },
    verification: record.verification,
    passed: record.transfer.passed && record.verification.passed,
  };
}

/** A failed exam never emitted exam.passed or skill.certified, so the timeline must not show them. */
function eventsForOutcome(events: AgentUniversityEvent[], certified: boolean): AgentUniversityEvent[] {
  if (certified) return events;
  return events.filter((event) => event.type !== "exam.passed" && event.type !== "skill.certified");
}

export async function loadLifecycle(
  mode: Mode,
  outcome: Outcome = "certified",
  demoCase: DemoCaseId = "northwind",
  skillId = "research-company",
): Promise<LifecycleData> {
  const [events, skillObserved, skillCertified, transfer, casesFile, company, repoAnalysis, score, outreach] =
    await Promise.all([
      readJson<AgentUniversityEvent[]>(FIXTURES, "events.json"),
      readJson<Skill>(FIXTURES, "skill-observed.json"),
      readJson<Skill>(FIXTURES, "skill-certified.json"),
      readJson<TransferResult>(FIXTURES, "transfer-result.json"),
      readJson<{ cases: DemoCase[] }>(ROOT, "demo", "cases.json"),
      readJson<Record<string, unknown>>(FIXTURES, "company.json"),
      readJson<Record<string, unknown>>(FIXTURES, "repo_analysis.json"),
      readJson<Record<string, unknown>>(FIXTURES, "score.json"),
      readFile(path.join(FIXTURES, "outreach.md"), "utf8"),
    ]);

  const registry = await readRegistry();

  const base: LifecycleData = {
    mode: "demo",
    outcome: "certified",
    demoCase: "northwind",
    fromRealRun: false,
    source: "demo/fixtures (committed, fictional data)",
    liveNote: null,
    events,
    skillObserved,
    skillCertified,
    transfer,
    certification: null,
    registry,
    cases: casesFile.cases,
    artifacts: { company, repoAnalysis, score, outreach },
    plan: firstPayload(events, "plan.composed"),
    gap: firstPayload(events, "gap.discovered"),
  };

  if (mode === "demo") {
    if (demoCase === "vercel") return await realTransferCase(base);
    return await withDemoCertification(base, outcome);
  }

  // Live: the promoted registry record first, then the runtime's working record.
  const registryRecord = await readJsonOrNull<CertificationRecord>(
    ROOT,
    "registry",
    "skills",
    `${skillId}.json`,
  );
  if (registryRecord?.decision) {
    const liveTransfer = toTransferResult(registryRecord, base.transfer);
    const liveCompany =
      (await readArtifactAtPath(registryRecord.transfer.artifact.path)) ??
      (await readLiveArtifact(liveTransfer.examCase, liveTransfer.artifact.type));
    const certification = toCertificationView(registryRecord, `registry/skills/${skillId}.json`);
    const recordEvents = registryRecord.events?.length ? registryRecord.events : base.events;
    return {
      ...base,
      mode: "live",
      outcome: certification.certified ? "certified" : "failed",
      source: `registry/skills/${skillId}.json (certified by policy ${certification.policyId})`,
      liveNote: liveCompany ? null : missingArtifactNote(liveTransfer),
      events: redactEvents(eventsForOutcome(recordEvents, certification.certified)),
      skillObserved: registryRecord.skill,
      skillCertified: registryRecord.skill.status === "certified" ? registryRecord.skill : null,
      transfer: liveTransfer,
      certification,
      artifacts: { ...base.artifacts, company: liveCompany ?? base.artifacts.company },
    };
  }

  const record = await readJsonOrNull<LiveRecord>(ROOT, ".agent-university", "skills", `${skillId}.json`);
  if (!record) {
    return {
      ...await withDemoCertification(base, outcome),
      liveNote:
        `No record at registry/skills/${skillId}.json or .agent-university/skills/${skillId}.json yet. ` +
        "Promote a transfer with `node scripts/certify.ts ... --promote` (see docs/REPO_OVERVIEW.md); " +
        "until then this view is showing fixtures.",
      source: "demo/fixtures (no live record found)",
    };
  }

  const liveEvents = record.events ?? [];
  const examPassed = firstPayload(liveEvents, "exam.passed");
  const examStarted = firstPayload(liveEvents, "exam.started");
  const liveTransfer: TransferResult = record.transferResult ?? {
    skillId: record.id,
    procedureId: record.procedureId,
    examCase: record.transfer?.examCase ?? examStarted?.examCase ?? "unknown",
    student: record.transfer?.student ?? examStarted?.student ?? unknownAgent(),
    runId: examStarted?.runId,
    artifact: { type: "company.json", path: redactPath(examPassed?.artifactPath ?? "(inside the sandbox)") },
    verification: examPassed?.verification ?? emptyVerification(),
    passed: record.transfer?.passed ?? false,
  };
  const liveCompany = await readLiveArtifact(liveTransfer.examCase, liveTransfer.artifact.type);

  return {
    ...base,
    mode: "live",
    outcome: liveTransfer.passed ? "certified" : "failed",
    source: `.agent-university/skills/${skillId}.json (live runtime record, not yet promoted)`,
    liveNote: liveCompany ? null : missingArtifactNote(liveTransfer),
    events: redactEvents(liveEvents.length > 0 ? liveEvents : base.events),
    skillObserved: record,
    skillCertified: record.status === "certified" ? record : null,
    transfer: liveTransfer,
    artifacts: { ...base.artifacts, company: liveCompany ?? base.artifacts.company },
    plan: firstPayload(liveEvents, "plan.composed") ?? base.plan,
    gap: firstPayload(liveEvents, "gap.discovered") ?? base.gap,
  };
}

/**
 * The real transfer exam, from the sanitized fixtures feat/runtime committed:
 * Linear taught it, a fresh QM agent researched Vercel from the recalled Memorable procedure, and
 * the verifier passed 6/6. Runtime ends at `transferred`; certification owns promotion, so this
 * view shows a proven-but-not-yet-certified skill unless a registry record exists.
 */
async function realTransferCase(base: LifecycleData): Promise<LifecycleData> {
  const [skill, transfer, events, company] = await Promise.all([
    readJsonOrNull<Skill>(FIXTURES, "skill-transferred-vercel.json"),
    readJsonOrNull<TransferResult>(FIXTURES, "transfer-result-vercel.json"),
    readJsonOrNull<AgentUniversityEvent[]>(FIXTURES, "events-vercel-transferred.json"),
    readJsonOrNull<Record<string, unknown>>(FIXTURES, "company-vercel.json"),
  ]);

  if (!skill || !transfer) {
    // Fall back to the complete fictional lifecycle (decision included) rather than a half-populated
    // page, and say why.
    return {
      ...(await withDemoCertification(base, "certified")),
      liveNote:
        "The real Linear → Vercel transfer fixtures (demo/fixtures/*-vercel*.json) are not on this " +
        "branch yet; they arrive with feat/runtime's Milestone 2. Showing the fictional lifecycle.",
    };
  }

  return {
    ...base,
    demoCase: "vercel",
    fromRealRun: true,
    outcome: transfer.passed ? "certified" : "failed",
    source: "demo/fixtures/*-vercel*.json (real QM transfer exam, sanitized)",
    liveNote:
      skill.status === "certified"
        ? null
        : "This is the real run, and it stops at `transferred` on purpose: runtime proves the " +
          "transfer, certification decides. Promote it with the certification engine (or open live " +
          "mode once registry/skills/research-company.json exists) to see it certified.",
    events: events?.length ? events : base.events,
    skillObserved: skill,
    skillCertified: skill.status === "certified" ? skill : null,
    transfer,
    artifacts: { ...base.artifacts, company: company ?? base.artifacts.company },
  };
}

/**
 * Demo mode prefers the committed certification fixtures, so the 8 policy rulings are real engine
 * output rather than UI prose. They arrive with feat/certification; until then the page falls back
 * to derived isolation facts.
 */
async function withDemoCertification(base: LifecycleData, outcome: Outcome): Promise<LifecycleData> {
  const file = outcome === "failed" ? "certification-record-failed.json" : "certification-record.json";
  const record = await readJsonOrNull<CertificationRecord>(FIXTURES, file);
  if (!record?.decision) {
    return {
      ...base,
      outcome: "certified",
      liveNote:
        outcome === "failed"
          ? `demo/fixtures/${file} is not in this branch yet (it arrives with the certification engine), ` +
            "so the certified outcome is shown."
          : base.liveNote,
    };
  }

  const certification = toCertificationView(record, `demo/fixtures/${file}`);
  return {
    ...base,
    outcome: certification.certified ? "certified" : "failed",
    source: `demo/fixtures (decision from ${file}, policy ${certification.policyId})`,
    events: eventsForOutcome(base.events, certification.certified),
    skillObserved: record.skill,
    skillCertified: record.skill.status === "certified" ? record.skill : null,
    transfer: toTransferResult(record, base.transfer),
    certification,
  };
}

function missingArtifactNote(transfer: TransferResult): string {
  return (
    "Live lifecycle loaded, but the artifact body is still only inside the QM sandbox. Copy it to " +
    `.agent-university/artifacts/${transfer.examCase}/${transfer.artifact.type} to show the real file; ` +
    "the fixture is standing in below."
  );
}

function unknownAgent(): AgentIdentity {
  return { id: "unknown", name: "unknown", harness: "qm" };
}

function emptyVerification(): VerificationResult {
  return { passed: false, checks: [] };
}

/**
 * Isolation facts, derived from the data on screen rather than asserted. Used only when no
 * certification record is available; the engine's rulings supersede these.
 */
/**
 * Runtime reports the isolation facts it actually checked as `TransferResult.isolation`, a
 * producer-added key (docs/HANDOFF.md §2). Those beat anything the UI can derive, so prefer them.
 */
function reportedIsolation(transfer: TransferResult): { name: string; passed: boolean; detail: string }[] | null {
  const reported = (transfer as TransferResult & { isolation?: Record<string, unknown> }).isolation;
  if (!reported || typeof reported !== "object") return null;
  const rows = Object.entries(reported)
    .filter(([, value]) => typeof value === "boolean")
    .map(([name, value]) => ({
      name,
      passed: value === true,
      detail: value === true ? "checked by the runtime during the trial" : "runtime reported this as false",
    }));
  return rows.length > 0 ? rows : null;
}

export function isolationFacts(data: LifecycleData) {
  const reported = reportedIsolation(data.transfer);
  if (reported) return reported;

  const teacher = data.skillObserved.teacher;
  const student = data.transfer.student;
  const recalled = firstPayload(data.events, "skill.recalled");
  const teacherCase = data.cases.find((c) => c.role === "teacher" && c.skillId === data.skillObserved.id);

  return [
    {
      name: "different_agent",
      passed: teacher.id !== student.id,
      detail: `origin ${teacher.id} ≠ replica ${student.id}`,
    },
    {
      name: "recalled_procedure_only",
      passed: Boolean(recalled?.procedureId) && recalled?.procedureId === data.transfer.procedureId,
      detail: recalled?.procedureId ? `the replica ran from ${recalled.procedureId}` : "no skill.recalled event",
    },
    {
      name: "unseen_exam_case",
      passed: Boolean(teacherCase) && teacherCase?.id !== data.transfer.examCase,
      detail: teacherCase
        ? `learned on ${teacherCase.id}, retried on ${data.transfer.examCase}`
        : `retried on ${data.transfer.examCase}`,
    },
  ];
}

export const STATUS_ORDER = ["observed", "transferred", "certified"] as const;
