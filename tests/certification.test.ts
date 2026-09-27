// Certification engine (lib/certification.ts) and company registry (lib/registry.ts).
//
// The invariant under test: one successful run is not enough. A skill is certified only when a
// different agent passes an unseen exam from the recalled procedure and every required
// deterministic verifier check passes. Offline. Run with `npm run test:ts`.
// UPDATE_FIXTURES=1 regenerates demo/fixtures/certification-record{,-failed}.json.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { certify, explain, ROOT, RULES } from "../lib/certification.ts";
import type { CandidateSkill, CertificationRecord, CertifyOptions } from "../lib/certification.ts";
import * as registry from "../lib/registry.ts";
import type { RankedRecord } from "../lib/registry.ts";
import { errorsAgainst } from "../lib/schema.ts";
import type { AgentUniversityEvent, TransferResult } from "../lib/types.ts";
import { verifyCompanyFile } from "../lib/verifiers/company.ts";
import { main as certifyCli } from "../scripts/certify.ts";

const FIX = join(ROOT, "demo", "fixtures");
const fixture = (name: string) => JSON.parse(readFileSync(join(FIX, name), "utf8"));
const clone = <T>(v: T): T => structuredClone(v);
const AT = "2026-01-01T00:04:01Z";
const ISOLATED = { different_scope: true, different_sandbox: true, no_answer_leak_in_prompt: true };
// The isolation facts the committed record fixtures were decided with.
const FIXTURE_ISOLATION = {
  different_scope: true, different_sandbox: true, different_session: true,
  no_teacher_artifact_in_sandbox: true, no_answer_leak_in_prompt: true,
};

const skill: CandidateSkill = fixture("skill-observed.json");
const events: AgentUniversityEvent[] = fixture("events.json");
const transfer: TransferResult = fixture("transfer-result.json");
const failedTransfer: TransferResult = fixture("transfer-result-failed.json");

const decide = (t: Partial<TransferResult> = transfer, opts: CertifyOptions = {}, s: CandidateSkill = skill) =>
  certify(s, t, { events, isolation: ISOLATED, decidedAt: AT, ...opts });

function assertFailsOnly(r: CertificationRecord, rules: string[], status: string) {
  assert.equal(r.decision.certified, false);
  assert.deepEqual(r.decision.failedRules, rules, explain(r));
  assert.equal(r.skill.status, status);
  assert.ok(!r.events.some((e) => e.type === "skill.certified"));
  assert.deepEqual(errorsAgainst(r, "certification-record.schema.json"), []);
}

describe("certifies", () => {
  test("a valid transfer is certified", () => {
    const r = decide();
    assert.equal(r.decision.certified, true, explain(r));
    assert.equal(r.skill.status, "certified");
    assert.deepEqual(r.decision.failedRules, []);
    assert.deepEqual(r.decision.rulings.map((x) => x.rule), RULES);
    assert.deepEqual(r.events.map((e) => e.type), ["exam.passed", "skill.certified"]);
  });

  test("the record answers the provenance questions", () => {
    const r = decide();
    assert.equal(r.skill.id, "research-company"); // what skill
    assert.equal(r.teacher.id, "agent-teacher-0001"); // who taught it
    assert.equal(r.procedureId, transfer.procedureId); // what memory
    assert.equal(r.transfer.examCase, "exam-northwind"); // which unseen case
    assert.equal(r.transfer.student.id, "agent-student-0002"); // which student
    assert.equal(r.verification.checks.length, 6); // which checks
    assert.ok(r.verification.checks.every((c) => c.passed)); // did they pass
  });

  test("outputs match the frozen contracts", () => {
    const r = decide();
    assert.deepEqual(errorsAgainst(r, "certification-record.schema.json"), []);
    assert.deepEqual(errorsAgainst(r.skill, "contracts/skill.schema.json"), []);
    for (const e of r.events) assert.deepEqual(errorsAgainst(e, "contracts/event.schema.json"), [], e.type);
  });

  test("its skill equals the skill-certified fixture", () => {
    assert.deepEqual(decide().skill, fixture("skill-certified.json"));
  });

  test("deterministic", () => {
    assert.deepEqual(decide(), decide());
    assert.match(decide().decision.inputsDigest, /^sha256:[0-9a-f]{64}$/);
  });

  test("teacher evidence can come from the runtime record's own events", () => {
    const s = { ...skill, events: events.filter((e) => e.type === "skill.observed") };
    assert.equal(decide(transfer, { events: [] }, s).decision.certified, true);
  });

  test("--reverify recomputes the verification from the artifact", () => {
    const t = clone(transfer);
    t.artifact.path = join(FIX, "company.json");
    const r = decide(t, { reverify: true });
    assert.equal(r.decision.certified, true);
    assert.equal(r.decision.rulings.find((x) => x.rule === "verifier_checks_complete")!.evidence.source, "re-run");
  });
});

describe("does not certify", () => {
  test("one successful run is not enough: the teacher replaying its own case", () => {
    const t = { ...clone(transfer), student: skill.teacher, examCase: "teach-linear" };
    const r = decide(t);
    assertFailsOnly(r, ["exam_case_unseen", "student_distinct_from_teacher"], "observed");
    assert.deepEqual(r.events, []);
  });

  test("the student is the teacher", () => {
    assertFailsOnly(decide({ ...transfer, student: skill.teacher }), ["student_distinct_from_teacher"], "observed");
  });

  test("the exam case is the teacher's case", () => {
    assertFailsOnly(decide({ ...transfer, examCase: "teach-linear" }), ["exam_case_unseen"], "observed");
  });

  test("an unknown exam case", () => {
    assertFailsOnly(decide({ ...transfer, examCase: "exam-nowhere" }), ["exam_case_unseen"], "observed");
  });

  test("no teacher observation", () => {
    assertFailsOnly(decide(transfer, { events: [] }), ["teacher_run_verified"], "observed");
  });

  test("the teacher run failed its verifier", () => {
    const ev = clone(events);
    (ev[0].payload as { verification: { passed: boolean } }).verification.passed = false;
    assertFailsOnly(decide(transfer, { events: ev }), ["teacher_run_verified"], "observed");
  });

  test("a failed verifier check leaves the skill transferred", () => {
    const r = decide(failedTransfer);
    assertFailsOnly(r, ["verifier_checks_passed"], "transferred");
    assert.equal(r.skill.transfer!.passed, false);
    assert.deepEqual(r.events, []);
    assert.deepEqual(r.decision.rulings.find((x) => x.rule === "verifier_checks_passed")!.evidence.failed, ["source_urls_min_two"]);
  });

  test("a crashed student produced no artifact: no exam happened", () => {
    const t = clone(failedTransfer);
    t.verification = { passed: false, checks: [
      { name: "run_completed", passed: false, message: "student timed out" },
      { name: "file_exists", passed: false, message: "file exists" },
    ] };
    const r = decide(t);
    assert.equal(r.skill.status, "observed");
    assert.ok(r.decision.failedRules.includes("artifact_matches_skill"));
  });

  test("a required check is missing", () => {
    const t = clone(transfer);
    t.verification.checks = t.verification.checks.filter((c) => c.name !== "source_urls_min_two");
    assertFailsOnly(decide(t), ["verifier_checks_complete"], "transferred");
  });

  test("the reported pass contradicts the checks", () => {
    const t = clone(transfer);
    t.verification.checks[1].passed = false; // the checks fail but the passed flags still say true
    assertFailsOnly(decide(t), ["verifier_checks_passed"], "transferred");
  });

  test("--reverify catches a false report", () => {
    const t = clone(transfer); // the report says PASS, the artifact on disk does not
    t.artifact.path = join(FIX, "company-invalid.json");
    assertFailsOnly(decide(t, { reverify: true }), ["verifier_checks_passed"], "transferred");
  });

  test("no procedure", () => {
    const { procedureId: _, ...t } = transfer;
    assertFailsOnly(decide(t), ["procedure_recalled"], "transferred");
  });

  test("a different procedure", () => {
    assertFailsOnly(decide({ ...transfer, procedureId: "procedures/ffff-other" }), ["procedure_recalled"], "transferred");
  });

  test("the wrong artifact type", () => {
    const t = clone(transfer);
    t.artifact.type = "score.json";
    assertFailsOnly(decide(t), ["artifact_matches_skill"], "observed");
  });

  test("isolation broken", () => {
    const r = decide(transfer, { isolation: { ...ISOLATED, no_answer_leak_in_prompt: false } });
    assertFailsOnly(r, ["isolation_attested"], "transferred");
  });

  test("isolation required but not supplied", () => {
    assertFailsOnly(decide(transfer, { isolation: null, requireIsolation: true }), ["isolation_attested"], "transferred");
  });

  test("isolation is optional by default", () => {
    assert.equal(decide(transfer, { isolation: null }).decision.certified, true);
  });
});

describe("registry", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "au-registry-"));
    registry.setRegistryDir(tmp);
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const student = (i: number, metrics?: RankedRecord["metrics"], t: TransferResult = transfer): RankedRecord => {
    const s = { ...clone(t), runId: `run-${i}`, student: { id: `agent-student-${i}`, name: `Freshman #${i}`, harness: "qm" } };
    return { ...decide(s), ...(metrics ? { metrics } : {}) };
  };

  test("a failed exam is ledgered, not promoted", () => {
    assert.equal(registry.recordDecision(decide(failedTransfer)), false);
    assert.equal(registry.load("research-company"), null);
    assert.deepEqual(registry.index(), { skills: [] });
    assert.equal(registry.ledger().length, 1);
  });

  test("a certified record becomes canonical with an index row", () => {
    const r = decide();
    assert.equal(registry.recordDecision(r), true);
    assert.deepEqual(registry.load("research-company"), r);
    const row = registry.index().skills[0];
    assert.deepEqual([row.id, row.status, row.examCase], ["research-company", "certified", "exam-northwind"]);
  });

  test("a better record replaces a worse one, never the reverse", () => {
    const slow = student(1, { toolCalls: 30, durationMs: 90000 });
    const fast = student(2, { toolCalls: 12, durationMs: 40000 });
    assert.equal(registry.recordDecision(slow), true);
    assert.equal(registry.recordDecision(fast), true);
    assert.equal(registry.recordDecision(slow), false);
    assert.equal(registry.load("research-company")!.transfer.runId, "run-2");
    assert.equal(registry.ledger().length, 3);
  });

  test("the Jev score outranks metrics but never certification", () => {
    const cheap = student(1, { toolCalls: 5 });
    const judged = { ...student(2, { toolCalls: 40 }), judge: { model: "typesafe/jev-router", score: 9 } };
    const failed = { ...student(3, { toolCalls: 1 }, failedTransfer), judge: { model: "typesafe/jev-router", score: 10 } };
    assert.equal(registry.best([cheap, judged, failed]), judged);
    assert.equal(registry.recordDecision(cheap), true);
    assert.equal(registry.recordDecision(judged), true);
    assert.equal(registry.load("research-company")!.transfer.runId, "run-2");
  });

  test("best prefers a certified record over a cheaper failure", () => {
    const failed = student(1, { toolCalls: 1 }, failedTransfer);
    const ok = student(2, { toolCalls: 50 });
    assert.equal(registry.best([failed, ok]), ok);
    assert.equal(registry.best([]), null);
  });
});

describe("fixtures and CLIs", () => {
  const cases: [string, TransferResult][] = [
    ["certification-record.json", transfer],
    ["certification-record-failed.json", failedTransfer],
  ];
  const stamps: Record<string, string> = {
    "certification-record.json": "2026-01-01T00:04:01Z",
    "certification-record-failed.json": "2026-01-01T00:05:01Z",
  };

  test("the committed record fixtures are what the engine produces today", () => {
    for (const [name, t] of cases) {
      const r = certify(skill, t, { events, isolation: FIXTURE_ISOLATION, decidedAt: stamps[name] });
      if (process.env.UPDATE_FIXTURES) writeFileSync(join(FIX, name), JSON.stringify(r, null, 2) + "\n");
      assert.deepEqual(fixture(name), r, `${name} is stale: UPDATE_FIXTURES=1 npm run test:ts`);
    }
  });

  test("the TS verifier agrees with scripts/verify_company.py", () => {
    for (const f of ["company.json", "company-invalid.json", "does-not-exist.json"]) {
      const path = join(FIX, f);
      const py = spawnSync("python3", [join(ROOT, "scripts", "verify_company.py"), "--json", path], { encoding: "utf8" });
      assert.deepEqual(verifyCompanyFile(path), JSON.parse(py.stdout), f);
    }
  });

  test("certify CLI exit codes", () => {
    const base = ["--skill", join(FIX, "skill-observed.json"), "--events", join(FIX, "events.json")];
    const log = console.log;
    console.log = () => {};
    try {
      assert.equal(certifyCli([...base, "--transfer", join(FIX, "transfer-result.json")]), 0);
      assert.equal(certifyCli([...base, "--transfer", join(FIX, "transfer-result-failed.json")]), 1);
    } finally {
      console.log = log;
    }
  });
});
