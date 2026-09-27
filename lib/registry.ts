// Company skill registry: the source of truth for what the organization trusts.
//
// Lives in the repo under registry/ so it is versioned, reviewable and shared:
//   registry/ledger.jsonl       every certification decision, pass or fail, append-only (audit trail)
//   registry/skills/<id>.json   the canonical CertificationRecord of each *certified* skill
//   registry/index.json         one summary row per certified skill (what the UI lists)
//
// Only a certified record can become canonical, and a certified skill is never replaced by a
// worse one (see rankKey). Failed exams stay in the ledger so a judge can see why.

import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
export function recordDecision(record: RankedRecord): boolean {
  mkdirSync(dir, { recursive: true });
  appendFileSync(p("ledger.jsonl"), JSON.stringify(record) + "\n");
  if (!record.decision.certified) return false;
  const current = load(record.skill.id);
  if (current && compareRecords(current, record) >= 0) return false;
  writeJson(p("skills", `${record.skill.id}.json`), record);
  const rows = index().skills.filter((s) => s.id !== record.skill.id).concat(summary(record));
  writeJson(p("index.json"), { skills: rows.sort((a, b) => a.id.localeCompare(b.id)) });
  return true;
}
