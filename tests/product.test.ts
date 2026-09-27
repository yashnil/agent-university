// The product layer: /api/skills, /api/exam, /api/run (the real route handlers), the composite run,
// the frozen final demo, and the page's data adapter in live and demo modes. Offline.
// The live mode reads the committed registry/ (read-only); failure cases use a throwaway registry.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("GET /api/skills", () => {
  test("live: the certified Research Company skill from the registry, with provenance", async () => {
    const { status, json } = await call<SkillsResponse>(skillsRoute, "/api/skills");
    assert.equal(status, 200);
    assert.equal(json.mode, "live");
    assert.deepEqual(json.skills.map((s) => [s.id, s.status]), [["research-company", "certified"]]);
    const s = json.skills[0];
    assert.equal(s.verification, "6/6");
    assert.deepEqual(s.provenance, { teacherRunId: "9f8d36da-12d3-4d42-bd7d-924fce932f46",
      examRunId: "5e30ec98-4e35-48eb-9460-d40b8ded3bc3", examCase: "exam-vercel", examCompany: "Vercel", realRun: true });
    assert.equal(s.record, "registry/skills/research-company.json");
  });

  test("demo returns the same contract", async () => {
    const live = (await call<SkillsResponse>(skillsRoute, "/api/skills?mode=live")).json;
    const demo = (await call<SkillsResponse>(skillsRoute, "/api/skills?mode=demo")).json;
    assert.equal(demo.mode, "demo");
    assert.deepEqual(demo.skills, live.skills); // the demo state is the registry's decision, frozen
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

  test("it is the production engine: same decision as the committed registry record", async () => {
    const { json } = await call<ExamResponse>(examRoute, "/api/exam", {});
    const committed = read("registry", "skills", "research-company.json");
    const at = committed.decision.decidedAt; // the only difference allowed is when it was decided
    assert.deepEqual({ ...json.record, decision: { ...json.record.decision, decidedAt: at },
      events: json.record.events.map((e) => ({ ...e, at })) }, committed);
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

describe("POST /api/run", () => {
  let run: CompositeRun;
  before(async () => {
    run = (await call<CompositeRun>(runRoute, "/api/run", {})).json;
  });

  test("the Intern is brand new and inherits only certified skills", () => {
    assert.deepEqual([run.intern.priorRuns, run.intern.personalSkills], [0, 0]);
    assert.deepEqual(run.intern.inheritedSkills, ["research-company"]);
    assert.deepEqual(run.recalled.map((r) => [r.skillId, r.status, r.procedureId]),
      [["research-company", "certified", "procedures/37196e61-add-company-data-to-company-json-file"]]);
  });

  test("steps are ordered and labelled", () => {
    assert.deepEqual(run.steps.map((s) => s.skillId), DILIGENCE_PLAN.map((p) => p.skillId));
    assert.deepEqual(run.steps.map((s) => s.seq), [1, 2, 3, 4, 5]);
    for (let i = 1; i < run.steps.length; i++) assert.ok(run.steps[i].startedAt > run.steps[i - 1].finishedAt);
    assert.deepEqual(shape(run), [
      [1, "research-company", "certified", "certified-registry", true],
      [2, "analyze-repository", "uncertified", "fixture", false],
      [3, "evaluate-opportunity", "uncertified", "fixture", false],
      [4, "find-technical-contact", "missing", "gap", false],
      [5, "draft-outreach", "blocked", "gap", false],
    ]);
    assert.ok(!run.steps.some((s) => s.source === "live")); // nothing in the composite runs an agent
  });

  test("the certified skill is reused, with its evidence and a re-verified artifact", () => {
    const s = run.steps[0];
    assert.equal(s.procedureId, "procedures/37196e61-add-company-data-to-company-json-file");
    assert.deepEqual(s.evidence, { examRunId: "5e30ec98-4e35-48eb-9460-d40b8ded3bc3", examCase: "exam-vercel",
      policy: "au-transfer-v1", verification: "6/6" });
    assert.equal(s.artifact!.path, "demo/fixtures/company-vercel.json");
    assert.match(s.note, /re-verified now 6\/6/);
  });

  test("fixture-backed steps say so and are not trusted", () => {
    for (const s of run.steps.filter((x) => x.source === "fixture")) {
      assert.equal(s.status, "uncertified");
      assert.equal(s.inherited, false);
      assert.ok(s.artifact!.path.startsWith("demo/fixtures/composite/"));
      assert.match(s.note, /stand-in/);
    }
  });

  test("Find Technical Contact is a real gap.discovered, a candidate, never certified", () => {
    assert.equal(run.gaps.length, 1);
    const gap = run.gaps[0];
    assert.deepEqual(errorsAgainst(gap, "contracts/event.schema.json"), []);
    assert.deepEqual([gap.type, gap.payload.skillId, gap.payload.status, gap.payload.missingArtifactType],
      ["gap.discovered", "find-technical-contact", "candidate", "outreach.md"]);
    assert.deepEqual(gap.payload.blocks, ["draft-outreach"]);
    assert.deepEqual(run.candidates.map((c) => [c.id, c.status, c.certified]), [["find-technical-contact", "candidate", false]]);
    assert.ok(!getSkills("live").skills.some((s) => s.id === "find-technical-contact"));
    assert.equal(run.steps[4].artifact, null); // Draft Outreach did not produce outreach.md
  });

  test("events match the frozen contracts", () => {
    assert.deepEqual(run.events.map((e) => e.type), ["plan.composed", "gap.discovered"]);
    for (const e of run.events) assert.deepEqual(errorsAgainst(e, "contracts/event.schema.json"), [], e.type);
    const plan = run.events[0].payload as { steps: { artifactType: string; status: string }[] };
    assert.deepEqual(plan.steps.map((s) => [s.artifactType, s.status]), [
      ["company.json", "certified"], ["repo_analysis.json", "uncertified"], ["score.json", "uncertified"], ["outreach.md", "uncertified"]]);
  });

  test("metrics come from the record and the recorded runs only", () => {
    const m = run.metrics;
    assert.deepEqual([m.certifiedSkillsReused, m.stepsFromCertified, m.stepsTotal, m.stepsFromFixtures, m.gapsDiscovered, m.candidatesCreated],
      [1, 1, 5, 2, 1, 1]);
    assert.deepEqual(m.verifiedChecks, { passed: 6, total: 6, source: "registry/skills/research-company.json" });
    assert.deepEqual(m.teacherChecks, { passed: 6, total: 6 });
    const recorded = read("demo", "fixtures", "run-metrics.json").runs;
    for (const r of recorded) {
      const row = m.comparison.find((c) => c.role === r.role)!;
      assert.deepEqual([row.runId, row.wallClockMs, row.shellToolCalls, row.failedShellToolCalls], [r.runId, r.wallClockMs, r.shellToolCalls, r.failedShellToolCalls]);
    }
    assert.ok(m.comparison.every((c) => c.tokens === null)); // QM records no tokens; none are invented
    assert.equal(m.comparison.find((c) => c.role === "intern")!.wallClockMs, null);
  });

  test("demo mode returns the same contract, from the frozen state", async () => {
    const demo = (await call<CompositeRun & { mode: string }>(runRoute, "/api/run?mode=demo", {})).json;
    assert.equal(demo.mode, "demo");
    assert.deepEqual(shape(demo), shape(run));
    assert.deepEqual(demo.candidates.map((c) => c.id), run.candidates.map((c) => c.id));
  });
});

describe("the frozen final demo", () => {
  test("demo/fixtures/final-demo.json is what production code produces", () => {
    assert.deepEqual(read("demo", "fixtures", "final-demo.json"), JSON.parse(JSON.stringify(buildFinalDemo())),
      "stale: node scripts/final_demo.ts");
  });

  test("its exam is the registry's decision, and its lifecycle is in contract order", () => {
    const demo = read("demo", "fixtures", "final-demo.json");
    assert.deepEqual(demo.exam.record, read("registry", "skills", "research-company.json"));
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
  test("consumes the same contracts in live and demo modes", async () => {
    const live = await loadLifecycle("live", "certified", "vercel");
    const demo = await loadLifecycle("demo", "certified", "vercel");
    for (const d of [live, demo]) {
      assert.equal(d.demoCase, "vercel");
      assert.equal(d.certification!.certified, true);
      assert.equal(d.skillCertified!.status, "certified");
      assert.ok(d.composite && d.skills);
      const types = d.events.map((e) => e.type);
      assert.deepEqual([...new Set(types)], ["skill.observed", "skill.recalled", "exam.started", "exam.passed", "skill.certified", "plan.composed", "gap.discovered"]);
    }
    assert.deepEqual([live.mode, demo.mode], ["live", "demo"]);
    assert.deepEqual(shape(live.composite!), shape(demo.composite!));
    assert.deepEqual(live.skills!.skills, demo.skills!.skills);
    assert.deepEqual(live.certification!.rulings, demo.certification!.rulings);
  });

  test("the fictional case keeps its own lifecycle and no composite", async () => {
    const d = await loadLifecycle("demo", "certified", "northwind");
    assert.equal(d.demoCase, "northwind");
    assert.equal(d.composite, null);
  });
});
