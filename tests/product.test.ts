// The product layer: /api/skills, /api/exam, /api/run (the real route handlers), the composite run,
// the frozen final demo, and the page's data adapter in live and demo modes. Offline.
//
// Two stories, one contract:
//   demo  is frozen: Linear teacher -> the real Vercel exam -> certified -> Fresh Intern. Exact values.
//   live  follows whatever registry/skills/research-company.json is canonical NOW (a flow tournament
//         can replace it). Its expectations are derived from that record at test time, never hardcoded.
// Failure cases use a throwaway registry.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { loadLifecycle } from "../app/_lib/data.ts";
import { POST as examRoute } from "../app/api/exam/route.ts";
import { POST as runRoute } from "../app/api/run/route.ts";
import { GET as skillsRoute } from "../app/api/skills/route.ts";
import { certify, ROOT } from "../lib/certification.ts";
import { DILIGENCE_PLAN } from "../lib/composite.ts";
import type { CompositeRun } from "../lib/composite.ts";
import type { CertificationRecord } from "../lib/certification.ts";
import { buildFinalDemo, DEMO_DECIDED_AT, getSkills, runComposite, vercelHandoff } from "../lib/product.ts";
import type { ExamResponse, SkillsResponse } from "../lib/product.ts";
import * as registry from "../lib/registry.ts";
import { errorsAgainst } from "../lib/schema.ts";

const read = (...p: string[]) => JSON.parse(readFileSync(join(ROOT, ...p), "utf8"));
const call = async <T>(handler: (r: Request) => Promise<Response>, url: string, body?: unknown) => {
  const res = await handler(new Request(`http://localhost${url}`, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body),
  }));
  return { status: res.status, json: (await res.json()) as T };
};
const shape = (run: CompositeRun) => run.steps.map((s) => [s.seq, s.skillId, s.status, s.source, s.inherited]);
/** The same response contract: the same keys, recursively (values may differ). A null (nullable field)
 *  or undefined (optional field, e.g. CertificationView.metrics on a record without metrics) is a valid
 *  value of that field, so it matches whatever the other side holds. */
const keysOf = (v: unknown): unknown => v === null || v === undefined ? null : Array.isArray(v) ? (v.length ? keysOf(v[0]) : []) :
  typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, keysOf((v as Record<string, unknown>)[k])])) : typeof v;
const nullable = (a: unknown, b: unknown): [unknown, unknown] => {
  if (a === null || b === null) return [null, null];
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ks = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const pairs = ks.map((k) => [k, nullable((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])] as const);
    return [Object.fromEntries(pairs.map(([k, [x]]) => [k, x])), Object.fromEntries(pairs.map(([k, [, y]]) => [k, y]))];
  }
  return [a, b];
};
const sameContract = (a: unknown, b: unknown, msg = "response contracts differ") => {
  const [x, y] = nullable(keysOf(a), keysOf(b));
  assert.deepEqual(x, y, msg);
};
const canonical = (): CertificationRecord & { metrics?: { durationMs?: number; toolCalls?: number } } =>
  read("registry", "skills", "research-company.json");
const ledgerVercel = (): CertificationRecord => readFileSync(join(ROOT, "registry", "ledger.jsonl"), "utf8").split("\n")
  .filter(Boolean).map((l) => JSON.parse(l) as CertificationRecord)
  .find((r) => r.transfer.runId === vercelHandoff().transfer.runId)!;
const VERCEL_RUN = "5e30ec98-4e35-48eb-9460-d40b8ded3bc3";
const VERCEL_TEACHER_RUN = "9f8d36da-12d3-4d42-bd7d-924fce932f46";
const PROCEDURE = "procedures/37196e61-add-company-data-to-company-json-file";

describe("GET /api/skills", () => {
  test("live: the registry's current canonical Research Company, with its own provenance", async () => {
    const { status, json } = await call<SkillsResponse>(skillsRoute, "/api/skills");
    const c = canonical();
    assert.equal(status, 200);
    assert.equal(json.mode, "live");
    assert.deepEqual(json.skills.map((s) => [s.id, s.status]), [["research-company", "certified"]]);
    const s = json.skills[0];
    const checks = c.verification.checks;
    assert.equal(s.verification, `${checks.filter((x) => x.passed).length}/${checks.length}`);
    assert.deepEqual(s.provenance, {
      teacherRunId: c.decision.rulings.find((r) => r.rule === "teacher_run_verified")!.evidence.runId,
      examRunId: c.transfer.runId, examCase: c.transfer.examCase, examCompany: c.transfer.examCompany,
      realRun: true, canonical: true,
    });
    assert.equal(s.record, "registry/skills/research-company.json");
    const row = read("registry", "index.json").skills.find((r: { id: string }) => r.id === "research-company");
    assert.deepEqual(s.procedure, row.procedure); // the tournament flow it came from, when there is one
  });

  test("demo: the frozen Vercel decision, marked as not canonical", async () => {
    const { json } = await call<SkillsResponse>(skillsRoute, "/api/skills?mode=demo");
    assert.equal(json.mode, "demo");
    const s = json.skills[0];
    assert.deepEqual([s.id, s.status, s.verification, s.examCase, s.record], ["research-company", "certified", "6/6", "exam-vercel", "registry/ledger.jsonl"]);
    assert.deepEqual(s.provenance, { teacherRunId: VERCEL_TEACHER_RUN, examRunId: VERCEL_RUN, examCase: "exam-vercel",
      examCompany: "Vercel", realRun: true, canonical: false });
  });

  test("live and demo satisfy the same response contract", async () => {
    const live = (await call<SkillsResponse>(skillsRoute, "/api/skills?mode=live")).json;
    const demo = (await call<SkillsResponse>(skillsRoute, "/api/skills?mode=demo")).json;
    const { procedure: _flow, ...liveSkill } = live.skills[0]; // the optional flow is live-only provenance
    sameContract({ ...live, skills: [liveSkill] }, demo);
    for (const r of [live, demo]) assert.ok(r.skills.every((s) => s.status === "certified"));
  });
});

describe("POST /api/exam", () => {
  test("certifies the real sanitized Vercel transfer, strictly", async () => {
    const { status, json } = await call<ExamResponse>(examRoute, "/api/exam", { case: "vercel" });
    assert.equal(status, 200);
    assert.deepEqual([json.statusBefore, json.status, json.certified, json.promoted], ["transferred", "certified", true, false]);
    assert.deepEqual(json.policy, { id: "au-transfer-v1", reverify: true, requireIsolation: true });
    assert.equal(json.checklist.length, 8);
    assert.ok(json.checklist.every((c) => c.passed));
    assert.equal(json.checklist.find((c) => c.rule === "isolation_attested")!.reason, "all 13 isolation facts hold");
    assert.equal(json.checks.filter((c) => c.passed).length, 6);
    assert.deepEqual(json.events.map((e) => e.type), ["exam.passed", "skill.certified"]);
    assert.deepEqual(errorsAgainst(json.record, "certification-record.schema.json"), []);
  });

  test("it certifies that transfer, not whatever is canonical: the Vercel decision the ledger keeps", async () => {
    const { json } = await call<ExamResponse>(examRoute, "/api/exam", {});
    const r = json.record;
    assert.deepEqual([r.transfer.examCase, r.transfer.examCompany, r.transfer.runId, r.procedureId],
      ["exam-vercel", "Vercel", VERCEL_RUN, PROCEDURE]);
    assert.equal(r.decision.rulings.find((x) => x.rule === "teacher_run_verified")!.evidence.runId, VERCEL_TEACHER_RUN);
    assert.equal(r.decision.rulings.find((x) => x.rule === "verifier_checks_complete")!.evidence.source, "re-run");
    // Reproducible: the engine gives the same decision the ledger recorded for this transfer; only the time differs.
    const kept = ledgerVercel();
    const at = kept.decision.decidedAt;
    assert.deepEqual({ ...r, decision: { ...r.decision, decidedAt: at }, events: r.events.map((e) => ({ ...e, at })) }, kept);
    assert.equal(r.decision.inputsDigest, kept.decision.inputsDigest);
  });

  test("a failed certification is never reported as certified", async () => {
    const h = vercelHandoff();
    const { json } = await call<ExamResponse>(examRoute, "/api/exam", { ...h, transfer: { ...h.transfer, student: h.skill.teacher } });
    assert.equal(json.certified, false);
    assert.notEqual(json.status, "certified");
    assert.ok(!json.events.some((e) => e.type === "skill.certified"));
    const broken = structuredClone(h.transfer) as typeof h.transfer & { isolation: Record<string, boolean> };
    broken.isolation.no_source_answer_in_prompt = false;
    const iso = (await call<ExamResponse>(examRoute, "/api/exam", { ...h, transfer: broken })).json;
    assert.deepEqual([iso.certified, iso.status], [false, "transferred"]);
  });

  test("rejects bad input and artifacts outside demo/fixtures", async () => {
    const h = vercelHandoff();
    assert.equal((await call(examRoute, "/api/exam", "{not json")).status, 400);
    assert.equal((await call(examRoute, "/api/exam", { case: "stripe" })).status, 400);
    for (const path of ["/etc/passwd", "../../etc/passwd", "registry/skills/research-company.json"]) {
      const t = { ...h.transfer, artifact: { ...h.transfer.artifact, path } };
      assert.equal((await call(examRoute, "/api/exam", { ...h, transfer: t })).status, 400, path);
    }
  });
});

/** What holds for any composite run, live or demo. */
function commonRunChecks(run: CompositeRun) {
  assert.deepEqual([run.intern.priorRuns, run.intern.personalSkills], [0, 0]);
  assert.deepEqual(run.steps.map((s) => s.skillId), DILIGENCE_PLAN.map((p) => p.skillId));
  assert.deepEqual(run.steps.map((s) => s.seq), [1, 2, 3, 4, 5]);
  for (let i = 1; i < run.steps.length; i++) assert.ok(run.steps[i].startedAt > run.steps[i - 1].finishedAt);
  assert.ok(!run.steps.some((s) => s.source === "live")); // nothing in the composite runs an agent
  // Only certified steps are inherited; fixture steps say so and are never trusted.
  for (const s of run.steps) {
    assert.equal(s.inherited, s.status === "certified", s.skillId);
    if (s.source === "fixture") {
      assert.equal(s.status, "uncertified");
      assert.ok(s.artifact!.path.startsWith("demo/fixtures/composite/"));
      assert.match(s.note, /stand-in/);
    }
  }
  // Find Technical Contact is a real gap.discovered and a candidate, never certified; Draft Outreach is blocked.
  const gap = run.gaps.find((g) => g.payload.skillId === "find-technical-contact")!;
  assert.deepEqual(errorsAgainst(gap, "contracts/event.schema.json"), []);
  assert.deepEqual([gap.type, gap.payload.status, gap.payload.missingArtifactType, gap.payload.blocks],
    ["gap.discovered", "candidate", "outreach.md", ["draft-outreach"]]);
  assert.deepEqual(run.candidates.map((c) => [c.id, c.status, c.certified]), [["find-technical-contact", "candidate", false]]);
  assert.deepEqual([run.steps[3].status, run.steps[4].status, run.steps[4].artifact], ["missing", "blocked", null]);
  for (const e of run.events) assert.deepEqual(errorsAgainst(e, "contracts/event.schema.json"), [], e.type);
  assert.deepEqual(run.events.map((e) => e.type), ["plan.composed", "gap.discovered"]);
  // Metrics: every number comes from the run it is attributed to; no tokens are invented.
  assert.ok(run.metrics.comparison.every((c) => c.tokens === null));
  const recorded = read("demo", "fixtures", "run-metrics.json").runs as { runId: string; wallClockMs: number }[];
  for (const row of run.metrics.comparison) {
    if (row.wallClockMs === null) continue;
    const own = recorded.find((r) => r.runId === row.runId);
    assert.ok(own || row.note.includes("certification record"), `${row.role}: metrics not from its own run`);
    if (own) assert.equal(row.wallClockMs, own.wallClockMs);
  }
}

describe("POST /api/run, demo: the frozen Vercel story", () => {
  let run: CompositeRun & { mode: string };
  before(async () => {
    run = (await call<CompositeRun & { mode: string }>(runRoute, "/api/run?mode=demo", {})).json;
  });

  test("is a valid composite run", () => {
    assert.equal(run.mode, "demo");
    commonRunChecks(run);
  });

  test("reuses the frozen Vercel certified output, re-verified, from the ledger decision", () => {
    assert.deepEqual(shape(run), [
      [1, "research-company", "certified", "certified-registry", true],
      [2, "analyze-repository", "uncertified", "fixture", false],
      [3, "evaluate-opportunity", "uncertified", "fixture", false],
      [4, "find-technical-contact", "missing", "gap", false],
      [5, "draft-outreach", "blocked", "gap", false],
    ]);
    const s = run.steps[0];
    assert.deepEqual([s.procedureId, s.record, s.artifact!.path], [PROCEDURE, "registry/ledger.jsonl", "demo/fixtures/company-vercel.json"]);
    assert.deepEqual(s.evidence, { examRunId: VERCEL_RUN, examCase: "exam-vercel", policy: "au-transfer-v1", verification: "6/6" });
    assert.match(s.note, /re-verified now 6\/6/);
    assert.deepEqual(run.recalled.map((r) => [r.skillId, r.record]), [["research-company", "registry/ledger.jsonl"]]);
  });

  test("its metrics are the recorded Vercel runs", () => {
    const m = run.metrics;
    assert.deepEqual([m.certifiedSkillsReused, m.stepsFromCertified, m.stepsTotal, m.stepsFromFixtures, m.gapsDiscovered, m.candidatesCreated],
      [1, 1, 5, 2, 1, 1]);
    assert.deepEqual(m.verifiedChecks, { passed: 6, total: 6, source: "registry/ledger.jsonl" });
    assert.deepEqual(m.teacherChecks, { passed: 6, total: 6 });
    const byRole = Object.fromEntries(m.comparison.map((c) => [c.role, c]));
    assert.deepEqual([byRole.teacher.runId, byRole.teacher.wallClockMs, byRole.teacher.shellToolCalls], [VERCEL_TEACHER_RUN, 49971, 4]);
    assert.deepEqual([byRole.student.runId, byRole.student.wallClockMs, byRole.student.shellToolCalls], [VERCEL_RUN, 16611, 2]);
    assert.equal(byRole.intern.wallClockMs, null);
  });
});

describe("POST /api/run, live: the current canonical record", () => {
  let run: CompositeRun & { mode: string };
  before(async () => {
    run = (await call<CompositeRun & { mode: string }>(runRoute, "/api/run", {})).json;
  });

  test("is a valid composite run", () => {
    assert.equal(run.mode, "live");
    commonRunChecks(run);
  });

  test("inherits the canonical certified skill, with that record's own provenance", () => {
    const c = canonical();
    assert.deepEqual(run.intern.inheritedSkills, ["research-company"]);
    assert.deepEqual(run.recalled.map((r) => [r.skillId, r.status, r.procedureId, r.record]),
      [["research-company", "certified", c.procedureId, "registry/skills/research-company.json"]]);
    const s = run.steps[0];
    assert.deepEqual([s.status, s.source, s.inherited, s.record], ["certified", "certified-registry", true, "registry/skills/research-company.json"]);
    assert.deepEqual(s.evidence, { examRunId: c.transfer.runId, examCase: c.transfer.examCase, policy: c.decision.policy.id,
      verification: `${c.verification.checks.filter((x) => x.passed).length}/${c.verification.checks.length}` });
  });

  test("reuses an output only if the canonical exam produced a verified one for this task; otherwise dependents are blocked", () => {
    const c = canonical();
    const s = run.steps[0];
    const reusable = c.transfer.examCompany === run.company && !!c.transfer.artifact.path
      && existsSync(join(ROOT, c.transfer.artifact.path));
    if (reusable) {
      assert.ok(s.artifact);
    } else {
      assert.equal(s.artifact, null); // no other company's output, and no fixture, stands in for it
      assert.match(s.note, /no company\.json was produced in this run/);
      for (const dep of run.steps.filter((x) => x.inputs.includes("company.json") && x.status !== "missing")) {
        assert.equal(dep.status, "blocked", dep.skillId);
        assert.match(dep.note, /company\.json, which was not produced in this run/);
      }
      assert.equal(run.metrics.stepsFromCertified, 0); // inherited, but nothing solved from it here
    }
    assert.equal(run.metrics.certifiedSkillsReused, 1);
  });

  test("never attributes another run's metrics to the canonical run", () => {
    const c = canonical();
    const teacherRunId = c.decision.rulings.find((r) => r.rule === "teacher_run_verified")!.evidence.runId;
    const byRole = Object.fromEntries(run.metrics.comparison.map((r) => [r.role, r]));
    assert.equal(byRole.teacher.runId, teacherRunId);
    assert.equal(byRole.student.runId, c.transfer.runId);
    const recorded = read("demo", "fixtures", "run-metrics.json").runs as { runId: string; wallClockMs: number }[];
    if (!recorded.some((r) => r.runId === c.transfer.runId)) {
      // Only the canonical record's own metrics may appear, or nothing.
      assert.equal(byRole.student.wallClockMs, c.metrics?.durationMs ?? null);
      assert.equal(byRole.student.toolCalls, c.metrics?.toolCalls ?? null);
      assert.equal(byRole.student.shellToolCalls, null);
    }
    if (!recorded.some((r) => r.runId === teacherRunId)) {
      assert.deepEqual([byRole.teacher.wallClockMs, byRole.teacher.shellToolCalls, byRole.teacher.toolCalls], [null, null, null]);
      assert.match(byRole.teacher.note, /not recorded/);
    }
    assert.equal(run.metrics.verifiedChecks!.source, "registry/skills/research-company.json");
  });

  test("live and demo satisfy the same response contract", async () => {
    const demo = (await call<CompositeRun>(runRoute, "/api/run?mode=demo", {})).json;
    const strip = (r: CompositeRun) => ({ ...r, steps: [] as unknown[], metrics: { ...r.metrics, comparison: [] as unknown[] } });
    sameContract(strip(run), strip(demo));
    sameContract(run.metrics.comparison, demo.metrics.comparison);
    sameContract(run.steps[0], demo.steps[0]); // a certified step, with or without an artifact
  });
});

describe("the frozen final demo", () => {
  test("demo/fixtures/final-demo.json is what production code produces", () => {
    assert.deepEqual(read("demo", "fixtures", "final-demo.json"), JSON.parse(JSON.stringify(buildFinalDemo())),
      "stale: node scripts/final_demo.ts");
  });

  test("its exam is the real Vercel decision kept in the ledger, and its lifecycle is in contract order", () => {
    const demo = read("demo", "fixtures", "final-demo.json");
    assert.deepEqual(demo.exam.record, ledgerVercel());
    assert.equal(demo.exam.record.decision.decidedAt, DEMO_DECIDED_AT);
    const order = ["skill.observed", "skill.recalled", "exam.started", "exam.passed", "skill.certified", "plan.composed", "gap.discovered"];
    const types: string[] = demo.lifecycle.map((e: { type: string }) => e.type);
    assert.deepEqual([...new Set(types)], order);
    assert.deepEqual(types, [...types].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    for (const e of demo.lifecycle) assert.deepEqual(errorsAgainst(e, "contracts/event.schema.json"), [], e.type);
  });
});

describe("a registry without the certified skill", () => {
  let tmp: string;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "au-product-"));
    registry.setRegistryDir(tmp);
    const h = vercelHandoff();
    // A failed decision in the ledger, and a tampered index row claiming it is certified.
    const failed = certify(h.skill, { ...h.transfer, student: h.skill.teacher }, { events: h.events, decidedAt: DEMO_DECIDED_AT });
    assert.equal(registry.recordDecision(failed), false);
    mkdirSync(join(tmp, "skills"), { recursive: true });
    writeFileSync(join(tmp, "skills", "research-company.json"), JSON.stringify(failed));
    writeFileSync(join(tmp, "index.json"), JSON.stringify({ skills: [{ ...registry.summary(failed), status: "certified" }] }));
  });
  after(() => {
    registry.setRegistryDir(join(ROOT, "registry"));
    rmSync(tmp, { recursive: true, force: true });
  });

  test("exposes nothing as certified, and the Intern inherits nothing", () => {
    assert.deepEqual(getSkills("live").skills, []);
    const run = runComposite("live", "2026-01-01T00:00:00Z");
    assert.deepEqual(run.intern.inheritedSkills, []);
    assert.deepEqual([run.steps[0].status, run.steps[0].source, run.steps[0].inherited], ["missing", "gap", false]);
    assert.ok(run.gaps.some((g) => g.payload.skillId === "research-company"));
    assert.ok(!run.steps.some((s) => s.status === "certified"));
  });
});

describe("the page's data adapter", () => {
  test("demo: the complete frozen Vercel lifecycle", async () => {
    const d = await loadLifecycle("demo", "certified", "vercel");
    assert.equal(d.mode, "demo");
    assert.equal(d.transfer.examCase, "exam-vercel");
    assert.equal(d.certification!.certified, true);
    assert.deepEqual([...new Set(d.events.map((e) => e.type))],
      ["skill.observed", "skill.recalled", "exam.started", "exam.passed", "skill.certified", "plan.composed", "gap.discovered"]);
  });

  test("live: the canonical record, and only the events it supports", async () => {
    const d = await loadLifecycle("live", "certified", "vercel");
    const c = canonical();
    assert.equal(d.mode, "live");
    assert.deepEqual([d.transfer.examCase, d.transfer.runId], [c.transfer.examCase, c.transfer.runId]);
    assert.equal(d.certification!.certified, true);
    assert.equal(d.skillCertified!.status, "certified");
    const hasRuntimeHistory = c.transfer.runId === VERCEL_RUN;
    const expected = [...(hasRuntimeHistory ? vercelHandoff().events.map((e) => e.type) : []),
      ...c.events.map((e) => e.type), ...d.composite!.events.map((e) => e.type)];
    assert.deepEqual(d.events.map((e) => e.type), expected);
    if (!hasRuntimeHistory) assert.ok(!d.events.some((e) => e.type === "skill.observed" || e.type === "exam.started"));
    // The student's artifact is the real one, or an explicit "unavailable", never another run's file.
    const company = d.artifacts.company as Record<string, unknown>;
    assert.ok("unavailable" in company || company.company_name === c.transfer.examCompany, JSON.stringify(company).slice(0, 120));
  });

  test("live and demo consume the same contracts", async () => {
    const live = await loadLifecycle("live", "certified", "vercel");
    const demo = await loadLifecycle("demo", "certified", "vercel");
    for (const k of ["composite", "skills", "certification", "transfer", "skillCertified"] as const) {
      assert.ok(live[k] && demo[k], k);
    }
    sameContract(live.certification, demo.certification);
    sameContract(live.skills!.skills.map(({ procedure: _p, ...s }) => s), demo.skills!.skills);
    assert.deepEqual(live.composite!.steps.map((s) => s.skillId), demo.composite!.steps.map((s) => s.skillId));
  });

  test("the fictional case keeps its own lifecycle and no composite", async () => {
    const d = await loadLifecycle("demo", "certified", "northwind");
    assert.equal(d.demoCase, "northwind");
    assert.equal(d.composite, null);
  });
});
