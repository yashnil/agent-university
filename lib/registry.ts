// Company skill registry: the source of truth for what the organization trusts.
//
// Lives in the repo under registry/ so it is versioned, reviewable and shared:
//   registry/ledger.jsonl       every certification decision, pass or fail, append-only (audit trail)
//   registry/skills/<id>.json   the canonical CertificationRecord of each *certified* skill
//   registry/index.json         one summary row per certified skill (what the UI lists)
//
//   registry/procedures/<skillId>/<slug>.json   one ProcedureRecord per Memorable flow ever evaluated
//
// The unit the organization trusts is a Memorable *flow* (procedure). A tournament tests each
// candidate flow with fresh students on unseen cases; the champion flow is promoted with
// promoteProcedure(), which makes its best certified run the skill's canonical record.
//
// Only a certified record can become canonical, and a certified skill is never replaced by a
// worse one (see rankKey). Failed exams stay in the ledger so a judge can see why.

import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "./certification.ts";
import type { CertificationRecord, RegistryIndex } from "./certification.ts";

/** A record as the swarm stores it: optionally scored by the Jev judge (advisory, ranking only). */
export type RankedRecord = CertificationRecord & {
  judge?: { model?: string; score?: number; rationale?: string; status?: string };
};

let dir = process.env.AU_REGISTRY_DIR || join(ROOT, "registry");
export const registryDir = () => dir;
export const setRegistryDir = (d: string) => {
  dir = d;
};

const p = (...parts: string[]) => join(dir, ...parts);

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n");
  renameSync(path + ".tmp", path);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export const RANK =
  "certified > rules passed > checks passed > higher Jev judge score > lower costUsd > fewer toolCalls > lower durationMs > runId";

/** Higher is better, compared element by element. Everything but the judge score is
 *  deterministic, and the judge score only counts on records the engine already certified. */
export function rankKey(record: RankedRecord): (number | string)[] {
  const d = record.decision;
  const checks = d.rulings.find((r) => r.rule === "verifier_checks_passed")?.evidence.passedCount;
  const judge = d.certified ? record.judge?.score : undefined;
  const m = record.metrics ?? {};
  return [
    d.certified ? 1 : 0,
    d.rulings.filter((r) => r.passed).length,
    typeof checks === "number" ? checks : 0,
    typeof judge === "number" ? judge : -1,
    -(m.costUsd ?? Infinity),
    -(m.toolCalls ?? Infinity),
    -(m.durationMs ?? Infinity),
    String(record.transfer.runId ?? ""),
  ];
}

/** > 0 when a ranks above b. */
export function compareRecords(a: RankedRecord, b: RankedRecord): number {
  const ka = rankKey(a);
  const kb = rankKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] === kb[i]) continue;
    return ka[i] > kb[i] ? 1 : -1;
  }
  return 0;
}

/** The best record of a batch (e.g. a swarm of students), or null if the batch is empty. */
export function best<T extends RankedRecord>(records: T[]): T | null {
  return records.reduce<T | null>((top, r) => (top === null || compareRecords(r, top) > 0 ? r : top), null);
}

export const load = (skillId: string) => readJson<RankedRecord>(p("skills", `${skillId}.json`));

export function ledger(skillId?: string): RankedRecord[] {
  let raw: string;
  try {
    raw = readFileSync(p("ledger.jsonl"), "utf8");
  } catch {
    return [];
  }
  return raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as RankedRecord)
    .filter((r) => !skillId || r.skill.id === skillId);
}

export const index = (): RegistryIndex => readJson<RegistryIndex>(p("index.json")) ?? { skills: [] };

export function summary(record: CertificationRecord): RegistryIndex["skills"][number] {
  const { transfer, decision } = record;
  return {
    id: record.skill.id,
    name: record.skill.name,
    status: record.skill.status,
    artifactType: record.skill.artifactType as RegistryIndex["skills"][number]["artifactType"],
    teacher: record.teacher,
    student: transfer.student,
    examCase: transfer.examCase,
    ...(record.procedureId ? { procedureId: record.procedureId } : {}),
    certifiedAt: decision.decidedAt,
    policy: decision.policy.id,
    record: `registry/skills/${record.skill.id}.json`,
  };
}

/** Append the decision to the ledger; promote it if it is certified and beats the current one.
 *  Returns true when the record became the skill's canonical record. */
export function recordDecision(record: RankedRecord, opts: { promote?: boolean } = {}): boolean {
  mkdirSync(dir, { recursive: true });
  appendFileSync(p("ledger.jsonl"), JSON.stringify(record) + "\n");
  if (!record.decision.certified || opts.promote === false) return false;
  const current = load(record.skill.id);
  if (current && compareRecords(current, record) >= 0) return false;
  writeJson(p("skills", `${record.skill.id}.json`), record);
  const rows = index().skills.filter((s) => s.id !== record.skill.id).concat(summary(record));
  writeJson(p("index.json"), { skills: rows.sort((a, b) => a.id.localeCompare(b.id)) });
  return true;
}

/** One Memorable flow's evaluation: how fresh agents did with it on unseen cases. */
export interface ProcedureRecord {
  skillId: string;
  procedureId: string; // Memorable procedure slug
  title: string;
  source: "recall" | "given" | "fixture";
  flow: string; // the procedure text agents were given (memorable show), leak-checked
  tournamentId: string;
  evaluatedAt: string;
  examCases: string[];
  runs: number;
  certified: number;
  passRate: number; // certified / runs
  advanced: boolean; // made the final
  judge: { model?: string; score?: number; rationale?: string; status?: string } | null;
  champion: boolean;
  bestRunId: string | null;
  runIds: (string | null)[];
}

export const procedureSlug = (procedureId: string) =>
  procedureId.replace(/^procedures\//, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120);

const procPath = (skillId: string, procedureId: string) => p("procedures", skillId, `${procedureSlug(procedureId)}.json`);

export const loadProcedure = (skillId: string, procedureId: string) => readJson<ProcedureRecord>(procPath(skillId, procedureId));

/** Record a flow's evaluation (every candidate, champion or not). Latest evaluation wins. */
export function recordProcedure(proc: ProcedureRecord): string {
  const path = procPath(proc.skillId, proc.procedureId);
  writeJson(path, proc);
  return path;
}

/** Make the champion flow the skill's trusted procedure: its best certified run becomes canonical
 *  and the index row points at the flow. A tournament decides between flows, so this replaces the
 *  previous canonical record even if an older run had better metrics. Refuses uncertified runs. */
export function promoteProcedure(proc: ProcedureRecord, bestRun: RankedRecord): boolean {
  if (!bestRun.decision.certified || bestRun.procedureId !== proc.procedureId) return false;
  recordProcedure({ ...proc, champion: true });
  writeJson(p("skills", `${bestRun.skill.id}.json`), bestRun);
  const row = { ...summary(bestRun), procedure: {
    procedureId: proc.procedureId, title: proc.title, passRate: proc.passRate, runs: proc.runs,
    judgeScore: proc.judge?.score ?? null, tournamentId: proc.tournamentId,
    record: `registry/procedures/${proc.skillId}/${procedureSlug(proc.procedureId)}.json`,
  } };
  const rows = index().skills.filter((s) => s.id !== bestRun.skill.id).concat(row);
  writeJson(p("index.json"), { skills: rows.sort((a, b) => a.id.localeCompare(b.id)) });
  return true;
}

export function procedures(skillId: string): ProcedureRecord[] {
  try {
    return readdirSync(p("procedures", skillId)).filter((f) => f.endsWith(".json"))
      .map((f) => readJson<ProcedureRecord>(p("procedures", skillId, f))!).filter(Boolean);
  } catch {
    return [];
  }
}
