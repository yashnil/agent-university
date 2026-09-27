// End to end, on the REAL runtime handoff: the sanitized Linear -> Vercel transfer exam that
// feat/runtime ran on QM + Memorable (demo/fixtures/*-vercel*.json)
//   -> certification engine (lib/certification.ts, strictest mode: --reverify --require-isolation)
//   -> CertificationRecord -> company registry (lib/registry.ts) -> retrieval of Research Company.
// Offline and deterministic: no QM, Memorable or network. The live run itself is evidenced in
// PROGRESS.md (Milestone 2); this replays its recorded outputs through production code.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { certify, explain, ROOT, RULES } from "../lib/certification.ts";
import type { CandidateSkill, CertificationRecord, CertifyOptions } from "../lib/certification.ts";
import * as registry from "../lib/registry.ts";
import { errorsAgainst } from "../lib/schema.ts";
import type { AgentUniversityEvent, EventType, TransferResult } from "../lib/types.ts";

const read = (...p: string[]) => JSON.parse(readFileSync(join(ROOT, ...p), "utf8"));
const fixture = (name: string) => read("demo", "fixtures", name);
const clone = <T>(v: T): T => structuredClone(v);

type RuntimeTransfer = TransferResult & { teacher: CandidateSkill["teacher"]; sourceCase: string; isolation: Record<string, boolean> };
const skill: CandidateSkill = fixture("skill-transferred-vercel.json");
const transfer: RuntimeTransfer = fixture("transfer-result-vercel.json");
const runtimeEvents: AgentUniversityEvent[] = fixture("events-vercel-transferred.json");
// The strictest policy mode: recompute the verifier from the artifact, and require runtime isolation facts.
const STRICT: CertifyOptions = { events: runtimeEvents, reverify: true, requireIsolation: true, decidedAt: "2026-09-27T21:10:00Z" };

// artifact.path is repo-relative in the shared fixture; resolve it wherever the test runs from.
const withAbsArtifact = <T extends Partial<TransferResult>>(t: T): T =>
  ({ ...t, artifact: { ...t.artifact!, path: join(ROOT, t.artifact!.path) } });
const decide = (t: Partial<RuntimeTransfer> = transfer, opts: CertifyOptions = {}, s: CandidateSkill = skill) =>
  certify(s, withAbsArtifact(t), { ...STRICT, ...opts });

const LIFECYCLE: EventType[] = ["skill.observed", "skill.recalled", "exam.started", "exam.passed", "skill.certified"];

describe("runtime handoff (real Vercel transfer)", () => {
  test("validates against the frozen contracts and is at `transferred`", () => {
    assert.deepEqual(errorsAgainst(transfer, "contracts/transfer-result.schema.json"), []);
    assert.deepEqual(errorsAgainst(skill, "contracts/skill.schema.json"), []);
    for (const e of runtimeEvents) assert.deepEqual(errorsAgainst(e, "contracts/event.schema.json"), [], e.type);
    assert.equal(skill.status, "transferred");
  });

  test("carries the evidence certification needs", () => {
    assert.notEqual(transfer.student.id, transfer.teacher.id);
    assert.equal(transfer.teacher.id, skill.teacher.id);
    assert.deepEqual([transfer.sourceCase, transfer.examCase], ["teach-linear", "exam-vercel"]);
    assert.ok(transfer.procedureId && transfer.procedureId === skill.procedureId);
    assert.equal(transfer.passed, true);
    assert.equal(transfer.verification.passed, true);
    assert.ok(transfer.verification.checks.length === 6 && transfer.verification.checks.every((c) => c.passed));
    assert.ok(Object.keys(transfer.isolation).length >= 13 && Object.values(transfer.isolation).every((v) => v === true));
  });

  test("runtime did not promote the skill itself", () => {
    const types = runtimeEvents.map((e) => e.type);
    assert.ok(!types.includes("exam.passed") && !types.includes("skill.certified"));
    assert.notEqual(skill.status, "certified");
  });
});

describe("certification of the real transfer", () => {
  const r = decide();

  test("is certified on every rule, in strict mode", () => {
    assert.equal(r.decision.certified, true, explain(r));
    assert.deepEqual(r.decision.rulings.map((x) => x.rule), RULES);
    assert.deepEqual(r.decision.failedRules, []);
    assert.equal(r.skill.status, "certified");
    assert.equal(r.decision.policy.requireIsolation, true);
  });

  test("used the runtime's isolation facts and re-ran the verifier", () => {
    const iso = r.decision.rulings.find((x) => x.rule === "isolation_attested")!;
    assert.deepEqual(iso.evidence.facts, transfer.isolation);
    const complete = r.decision.rulings.find((x) => x.rule === "verifier_checks_complete")!;
    assert.equal(complete.evidence.source, "re-run");
    assert.deepEqual(r.verification, transfer.verification); // the recomputed result equals the runtime's
  });

  test("emits exam.passed and skill.certified, and every output matches its schema", () => {
    assert.deepEqual(r.events.map((e) => e.type), ["exam.passed", "skill.certified"]);
    assert.deepEqual(errorsAgainst(r, "certification-record.schema.json"), []);
    assert.deepEqual(errorsAgainst(r.skill, "contracts/skill.schema.json"), []);
    for (const e of r.events) assert.deepEqual(errorsAgainst(e, "contracts/event.schema.json"), [], e.type);
  });

  test("the record agrees with the transfer result", () => {
    assert.deepEqual(r.teacher, transfer.teacher);
    assert.equal(r.procedureId, transfer.procedureId);
    assert.deepEqual(r.transfer.student, transfer.student);
    assert.equal(r.transfer.examCase, transfer.examCase);
    assert.equal(r.transfer.examCompany, "Vercel");
    assert.equal(r.transfer.runId, transfer.runId);
    assert.equal(r.transfer.artifact.type, transfer.artifact.type);
    assert.equal(r.transfer.passed, transfer.passed);
    assert.deepEqual(r.skill.transfer, { student: transfer.student, examCase: transfer.examCase, passed: true });
    const [passed, certified] = r.events.map((e) => e.payload as Record<string, unknown>);
    assert.deepEqual([passed.student, passed.examCase], [transfer.student, transfer.examCase]);
    assert.deepEqual([certified.teacher, certified.student, certified.procedureId],
      [transfer.teacher, transfer.student, transfer.procedureId]);
  });

  test("the full lifecycle is consistent: runtime events, then certification events", () => {
    const all = [...runtimeEvents, ...r.events];
    const types = all.map((e) => e.type);
    assert.deepEqual([...new Set(types)], LIFECYCLE);
    assert.deepEqual(types, [...types].sort((a, b) => LIFECYCLE.indexOf(a) - LIFECYCLE.indexOf(b)));
    const times = all.map((e) => e.at);
    assert.deepEqual(times, [...times].sort()); // certified after the exam started
    // `transferred` is the status between exam.started and the decision; certified comes after.
    assert.deepEqual([skill.status, r.skill.status], ["transferred", "certified"]);
  });
});

describe("certification refuses a broken handoff", () => {
  const fails = (r: CertificationRecord, rule: string) => {
    assert.equal(r.decision.certified, false, explain(r));
    assert.ok(r.decision.failedRules.includes(rule as never), `${rule} not failed: ${r.decision.failedRules}`);
    assert.notEqual(r.skill.status, "certified");
    assert.ok(!r.events.some((e) => e.type === "skill.certified"));
  };

  test("the verifier fails on the artifact", () => {
    const t = clone(transfer);
    t.artifact.path = "demo/fixtures/company-invalid.json"; // re-verified from disk, not trusted
    fails(decide(t), "verifier_checks_passed");
  });

  test("a failed check in the report", () => {
    const t = clone(transfer);
    t.verification.checks[5].passed = false;
    fails(decide(t, { reverify: false }), "verifier_checks_passed");
  });

  test("teacher == student", () => fails(decide({ ...clone(transfer), student: skill.teacher }), "student_distinct_from_teacher"));

  test("the exam case is the source case", () => fails(decide({ ...clone(transfer), examCase: "teach-linear" }), "exam_case_unseen"));

  test("no procedure id", () => {
    const { procedureId: _, ...t } = clone(transfer);
    fails(decide(t), "procedure_recalled");
  });

  test("no isolation evidence", () => {
    const { isolation: _, ...t } = clone(transfer);
    fails(decide(t), "isolation_attested");
  });

  test("one isolation fact broken", () => {
    const t = clone(transfer);
    t.isolation.student_home_volume_new = false;
    fails(decide(t), "isolation_attested");
  });

  test("no teacher observation", () => fails(decide(transfer, { events: runtimeEvents.filter((e) => e.type !== "skill.observed") }), "teacher_run_verified"));

  test("a required check is missing", () => {
    const t = clone(transfer);
    t.verification.checks = t.verification.checks.slice(0, 5);
    fails(decide(t, { reverify: false }), "verifier_checks_complete");
  });
});

describe("registry", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "au-integration-"));
    registry.setRegistryDir(tmp);
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const certified = decide();
  const failed = decide({ ...clone(transfer), artifact: { ...transfer.artifact, path: "demo/fixtures/company-invalid.json" } });
  const transferredOnly = (() => {
    const t = clone(transfer);
    t.isolation.no_source_answer_in_prompt = false;
    return decide(t);
  })();

  test("failed and merely transferred records are ledgered, never canonical", () => {
    assert.equal(transferredOnly.skill.status, "transferred");
    assert.equal(registry.recordDecision(failed), false);
    assert.equal(registry.recordDecision(transferredOnly), false);
    assert.equal(registry.load("research-company"), null);
    assert.deepEqual(registry.index(), { skills: [] });
    assert.equal(registry.ledger("research-company").length, 2);
  });

  test("the certified Vercel record is promoted, indexed and retrievable", () => {
    assert.equal(registry.recordDecision(failed), false);
    assert.equal(registry.recordDecision(certified), true);
    assert.equal(registry.recordDecision(transferredOnly), false); // a worse record never replaces it
    const canonical = registry.load("research-company")!;
    assert.deepEqual(canonical, certified);
    assert.equal(canonical.skill.status, "certified");
    assert.deepEqual(errorsAgainst(canonical, "certification-record.schema.json"), []);
    const rows = registry.index().skills;
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].id, rows[0].name, rows[0].status, rows[0].examCase, rows[0].procedureId],
      ["research-company", "Research Company", "certified", "exam-vercel", transfer.procedureId]);
    assert.equal(registry.ledger("research-company").length, 3);
  });

  test("the certified record outranks failed and transferred candidates", () => {
    assert.equal(registry.best([failed, transferredOnly, certified]), certified);
    assert.ok(registry.compareRecords(certified, transferredOnly) > 0);
    assert.ok(registry.compareRecords(transferredOnly, failed) >= 0);
  });
});

describe("committed registry", () => {
  test("registry/skills/research-company.json is what the engine produces from the real fixture", () => {
    const committed: CertificationRecord = read("registry", "skills", "research-company.json");
    const again = certify(skill, transfer, { ...STRICT, decidedAt: committed.decision.decidedAt });
    assert.deepEqual(committed, again, "stale: re-run the certify command in docs/REPO_OVERVIEW.md");
    const row = read("registry", "index.json").skills.find((s: { id: string }) => s.id === "research-company");
    assert.deepEqual(row, registry.summary(committed));
  });
});
