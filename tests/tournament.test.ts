// Flow tournament (lib/tournament.ts, scripts/tournament.ts): each candidate Memorable flow is
// handed to fresh agents on different unseen cases; flows that pass the bar meet in a Jev final;
// the champion flow's best run is promoted. Offline: no QM, Docker, Memorable or network.

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { flowTitle, recallMany } from "../lib/memorable.ts";
import { agentIdentity, ROOT } from "../lib/qm.ts";
import * as registry from "../lib/registry.ts";
import { errorsAgainst } from "../lib/schema.ts";
import type { ArenaEvent, LaunchStudent, Metrics } from "../lib/swarm.ts";
import { caseForStudent, FLOW_PASS_THRESHOLD, makeFlowJudge, runTournament, screenFlows } from "../lib/tournament.ts";
import type { Flow, FlowCandidate, FlowJudgeFn, HeatSpec, TournamentOptions } from "../lib/tournament.ts";
import type { TransferResult } from "../lib/types.ts";
import { drySkill } from "../scripts/swarm.ts";
import { dryLeakTerms, fixtureFlows, main } from "../scripts/tournament.ts";

const AT = "2026-01-03T00:00:00Z";
const CASES = ["exam-vercel", "exam-stripe", "exam-supabase"];
const base: TransferResult = JSON.parse(readFileSync(join(ROOT, "demo", "fixtures", "transfer-result.json"), "utf8"));
const P = (x: string) => `procedures/0000${x}-flow-${x}`;
const run = (h: number, i: number) => `h${h}-run-${i}`;
const student = (h: number, i: number) => agentIdentity(`web:test:h${h}:${i}`, `Agent #${i}`);
const flow = (x: string, rank: number): Flow => ({ procedureId: P(x), title: `Flow ${x}`, source: "recall", rank,
  text: `# Flow ${x}\n1. Fetch sources.\n2. Write company.json.` });

type Plan = { metrics: Metrics; fail?: boolean; crash?: boolean };
const m = (costUsd: number, toolCalls = 10): Metrics => ({ durationMs: 100000, toolCalls, turns: 5, costUsd });

/** Heat h for flow f: student i follows plans[i-1] on case CASES[(i-1) % 3], given only flow f. */
function heat(h: number, f: Flow, plans: Plan[], seen?: number[]): HeatSpec {
  const skill = { ...drySkill(), procedureId: f.procedureId };
  const launch: LaunchStudent = async (i) => {
    seen?.push(h);
    const p = plans[i - 1];
    if (p.crash) throw new Error("sandbox exploded");
    const t: TransferResult = structuredClone(base);
    Object.assign(t, { examCase: caseForStudent(CASES, i), runId: run(h, i), student: student(h, i), procedureId: f.procedureId });
    if (p.fail) {
      t.verification.checks[t.verification.checks.length - 1].passed = false;
      t.verification.passed = t.passed = false;
    }
    return { transfer: t, metrics: { ...p.metrics }, isolation: { different_scope: true }, artifact: JSON.stringify({ h, i }) };
  };
  return { heat: h, flow: f, skill, examCases: CASES, launch, studentFor: (i) => student(h, i), swarmId: `t-h${h}` };
}

/** Flow a: 3/3, costly. Flow b: 1/3 (does not advance). Flow c: 2/3, cheap (advances). */
function standard(seen?: number[]): HeatSpec[] {
  return [
    heat(1, flow("a", 1), [{ metrics: m(0.5) }, { metrics: m(0.6) }, { metrics: m(0.55) }], seen),
    heat(2, flow("b", 2), [{ metrics: m(0.1), fail: true }, { metrics: m(0.1) }, { metrics: m(0), crash: true }], seen),
    heat(3, flow("c", 3), [{ metrics: m(0.2) }, { metrics: m(0.1), fail: true }, { metrics: m(0.25) }], seen),
  ];
}

const fakeJudge = (scores: Record<string, number>, seen?: FlowCandidate[][]): FlowJudgeFn =>
  Object.assign((flows: FlowCandidate[]) => {
    seen?.push(flows);
    return Object.fromEntries(Object.entries(scores).map(([k, score]) => [k, { score, rationale: `fake ${k}` }]));
  }, { model: "fake-jev" });

describe("flow tournament", () => {
  let tmp: string;
  const before = registry.registryDir();
  const play = (heats: HeatSpec[], opts: TournamentOptions = {}) =>
    runTournament(heats, 3, { decidedAt: AT, tournamentId: "t", ...opts });

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "au-tournament-test-"));
    registry.setRegistryDir(join(tmp, "registry"));
  });
  afterEach(() => {
    registry.setRegistryDir(before);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("a flow with majority failures does not advance", async () => {
    const t = await play(standard());
    assert.equal(FLOW_PASS_THRESHOLD, 0.5);
    assert.deepEqual(t.heats.map((h) => [h.flow.procedureId, h.certified, h.runs, h.passRate, h.advances]),
      [[P("a"), 3, 3, 1, true], [P("b"), 1, 3, 0.333, false], [P("c"), 2, 3, 0.667, true]]);
    assert.equal(t.heats[1].bestRun?.runId, run(2, 2)); // it still has a best run, it just does not advance
    assert.equal(t.final.finalists, 2);
    assert.ok(t.final.ranking.every((r) => r.procedureId !== P("b")));
  });

  test("students in a heat take different exam cases with the same procedureId", async () => {
    const t = await play(standard());
    for (const h of [1, 3]) {
      const recs = t.records.filter((r) => r.tournament?.heat === h);
      assert.deepEqual(recs.map((r) => r.transfer.examCase).sort(), [...CASES].sort());
      assert.ok(recs.every((r) => r.procedureId === t.heats[h - 1].flow.procedureId));
      assert.ok(recs.every((r) => r.skill.procedureId === r.procedureId)); // procedure_recalled holds
    }
    const crashed = t.records.find((r) => r.tournament?.heat === 2 && r.decision.failedRules.includes("artifact_matches_skill"))!;
    assert.equal(crashed.transfer.examCase, "exam-supabase"); // a crashed student keeps its own case
  });

  test("Jev picks among the advancing flows only", async () => {
    const seen: FlowCandidate[][] = [];
    const t = await play(standard(), { judge: fakeJudge({ [P("a")]: 5, [P("b")]: 10, [P("c")]: 8 }, seen) });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].map((f) => f.procedureId).sort(), [P("a"), P("c")]);
    const c = seen[0].find((f) => f.procedureId === P("c"))!;
    assert.equal(c.outcomes.length, 3);
    assert.equal(c.samples.length, 2);
    assert.match(c.text, /Flow c/);
    assert.equal(t.final.judge.status, "ok");
    assert.equal(t.champion?.procedureId, P("c")); // a lower pass rate, but Jev prefers it
    assert.equal(t.champion?.judgeScore, 8);
    assert.equal(t.heats[1].judge, null);
  });

  test("without Jev the flows rank deterministically: pass rate, then median metrics", async () => {
    const broken: FlowJudgeFn = Object.assign(() => { throw new Error("upstream 503"); }, { model: "broken" });
    const t = await play(standard(), { judge: broken });
    assert.equal(t.final.judge.status, "unavailable");
    assert.match(t.final.judge.reason ?? "", /upstream 503/);
    assert.deepEqual(t.final.ranking.map((r) => r.procedureId), [P("a"), P("c")]); // 100% beats 67% despite cost
    const tie = await play([heat(1, flow("x", 1), [{ metrics: m(0.5) }, { metrics: m(0.5) }, { metrics: m(0.5) }]),
      heat(2, flow("y", 2), [{ metrics: m(0.3) }, { metrics: m(0.3) }, { metrics: m(0.3) }])], { judge: null, tournamentId: "t2" });
    assert.equal(tie.champion?.procedureId, P("y")); // same pass rate: cheaper median wins
  });

  test("the champion flow is promoted, its index row points at it, and every flow has a ProcedureRecord", async () => {
    const t = await play(standard(), { judge: fakeJudge({ [P("a")]: 5, [P("c")]: 8 }) });
    const skillId = t.skillId;
    const canon = registry.load(skillId)!;
    assert.equal(canon.procedureId, P("c"));
    assert.equal(canon.transfer.runId, t.champion?.bestRun.runId);
    assert.equal(t.canonical?.isChampion, true);
    assert.equal(t.champion?.promoted, true);
    const row = registry.index().skills.find((s) => s.id === skillId) as any;
    assert.equal(row.procedure.procedureId, P("c"));
    assert.equal(row.procedure.judgeScore, 8);
    const procs = registry.procedures(skillId);
    assert.equal(procs.length, 3);
    const byId = Object.fromEntries(procs.map((p) => [p.procedureId, p]));
    assert.deepEqual([byId[P("a")].champion, byId[P("b")].champion, byId[P("c")].champion], [false, false, true]);
    assert.deepEqual([byId[P("a")].advanced, byId[P("b")].advanced, byId[P("c")].advanced], [true, false, true]);
    assert.equal(byId[P("c")].judge?.score, 8);
    assert.equal(byId[P("b")].judge, null);
    assert.equal(byId[P("a")].runIds.length, 3);
    assert.match(byId[P("a")].flow, /Flow a/);
    const rows = registry.ledger();
    assert.equal(rows.length, 9);
    assert.equal(rows[8].transfer.runId, t.champion?.bestRun.runId);
  });

  test("when no flow advances nothing is promoted, but every flow is recorded", async () => {
    const f = { metrics: m(0.1), fail: true };
    const t = await play([heat(1, flow("x", 1), [f, f, { metrics: m(0.1) }]), heat(2, flow("y", 2), [f, f, f])], { judge: fakeJudge({}) });
    assert.equal(t.champion, null);
    assert.equal(t.final.judge.status, "skipped");
    // Runs go to the ledger only; with no champion flow nothing becomes canonical, even the
    // certified run of the eliminated flow.
    assert.deepEqual(registry.index(), { skills: [] });
    assert.equal(registry.load(t.skillId), null);
    assert.equal(registry.procedures(t.skillId).length, 2);
    assert.ok(registry.procedures(t.skillId).every((p) => !p.champion && !p.advanced));
    assert.equal(registry.ledger().length, 6);
  });

  test("a leaking flow is rejected before the tournament", () => {
    const terms = dryLeakTerms();
    const flows = [...fixtureFlows(), { procedureId: P("leak"), title: "Leaky", source: "recall" as const, rank: 4,
      text: "1. Remember that Northwind Labs is at https://northwind.example.com and copy its summary." }];
    const { accepted, rejected } = screenFlows(flows, terms);
    assert.deepEqual(accepted.map((f) => f.procedureId), fixtureFlows().map((f) => f.procedureId));
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].procedureId, P("leak"));
    assert.match(rejected[0].reason, /leaks the teacher's answer/);
  });

  test("events arrive in order, carry flow fields, and records are schema-valid", async () => {
    const events: ArenaEvent[] = [];
    const t = await play(standard(), { judge: fakeJudge({ [P("a")]: 9, [P("c")]: 6 }), onEvent: (e) => events.push(e),
      rejected: [{ procedureId: P("z"), title: "Z", reason: "leak" }] });
    const types = events.map((e) => e.type);
    assert.equal(types[0], "tournament.started");
    assert.equal(types[types.length - 1], "tournament.finished");
    assert.equal(types.filter((x) => x === "student.finished").length, 9);
    assert.ok(types.indexOf("final.started") > types.lastIndexOf("heat.finished"));
    const start = events[0] as Extract<ArenaEvent, { type: "tournament.started" }>;
    assert.equal(start.heats[0].flow?.procedureId, P("a"));
    assert.deepEqual(start.heats[0].students.map((s) => s.examCase), CASES);
    assert.equal(start.rejected[0].procedureId, P("z"));
    for (const e of events) {
      if (e.type === "student.started" || e.type === "student.finished") {
        assert.equal(e.procedureId, t.heats[e.heat - 1].flow.procedureId);
        assert.equal(e.examCase, caseForStudent(CASES, e.i));
        assert.ok(e.examCompany);
      }
    }
    const heatEnd = events.find((e) => e.type === "heat.finished" && e.heat === 2) as Extract<ArenaEvent, { type: "heat.finished" }>;
    assert.deepEqual([heatEnd.procedureId, heatEnd.runs, heatEnd.advances, heatEnd.certifiedCount], [P("b"), 3, false, 1]);
    const fin = events.find((e) => e.type === "final.finished") as Extract<ArenaEvent, { type: "final.finished" }>;
    assert.deepEqual(fin.ranking.map((r) => [r.place, r.procedureId, r.score]), [[1, P("a"), 9], [2, P("c"), 6]]);
    const end = events[events.length - 1] as Extract<ArenaEvent, { type: "tournament.finished" }>;
    assert.equal(end.champion?.procedureId, P("a"));
    assert.equal(end.procedure?.champion, true);
    assert.equal(end.promoted, true);
    assert.deepEqual(errorsAgainst(end.record, "certification-record.schema.json"), []);
    for (const r of t.records) {
      assert.deepEqual(errorsAgainst(r, "certification-record.schema.json"), [], r.transfer.runId ?? "crashed");
      for (const e of r.events) assert.deepEqual(errorsAgainst(e, "contracts/event.schema.json"), [], e.type);
    }
  });

  test("heats run concurrently under one global student limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const heats = standard().map((h) => ({ ...h, launch: (async (i, signal) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return h.launch(i, signal);
    }) as LaunchStudent }));
    await play(heats, { maxParallel: 4 });
    assert.equal(peak, 4);
  });

  test("the live flow judge sends flow text, pass rates and outcomes, and parses procedureId rankings", async () => {
    const bodies: any[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const content = "```json\n" + JSON.stringify({ rankings: [{ procedureId: P("a"), score: 6, rationale: "ok" },
        { procedureId: P("c"), score: 9, rationale: "clear checks" }] }) + "\n```";
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = await play(standard(), { judge: makeFlowJudge({ key: "k", fetchFn: fakeFetch }) });
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].model, "typesafe/jev-router");
    assert.equal(bodies[0].temperature, 0);
    const user = JSON.parse(bodies[0].messages[1].content);
    assert.deepEqual(user.flows.map((f: any) => [f.procedureId, f.passRate]), [[P("a"), 1], [P("c"), 0.667]]);
    assert.match(user.flows[1].flow, /Flow c/);
    assert.equal(user.flows[1].outcomes.length, 3);
    assert.ok(user.flows[0].samples.length >= 1);
    assert.equal(t.champion?.procedureId, P("c"));
    assert.match(t.final.judge.promptDigest ?? "", /^sha256:[0-9a-f]{64}$/);
  });

  test("recallMany takes up to k distinct procedures in rank order; flowTitle", async () => {
    const bin = join(tmp, "memorable");
    writeFileSync(bin, "#!/bin/sh\n[ \"$1\" = recall ] && [ \"$2\" != --single ] && printf '1. procedures/aa11-first (0.91)\\n" +
      "2. procedures/bb22-second.\\n   see procedures/aa11-first\\n3. procedures/cc33-third\\n4. procedures/dd44-fourth\\n'\n");
    chmodSync(bin, 0o755);
    const prev = process.env.MEMORABLE_BIN;
    process.env.MEMORABLE_BIN = bin;
    try {
      const r = await recallMany("task", 3);
      assert.deepEqual(r.procedureIds, ["procedures/aa11-first", "procedures/bb22-second", "procedures/cc33-third"]);
    } finally {
      if (prev === undefined) delete process.env.MEMORABLE_BIN;
      else process.env.MEMORABLE_BIN = prev;
    }
    assert.equal(flowTitle("procedures/abc123-research-a-company", "no heading"), "Research a company");
    assert.equal(flowTitle("procedures/x", "intro\n## Do the thing\n"), "Do the thing");
  });

  test("dry-run CLI end to end", async () => {
    const log = console.log;
    const out: string[] = [];
    console.log = (...a: unknown[]) => { out.push(a.join(" ")); };
    let res;
    try {
      res = await main(["--dry-run", "--registry-dir", registry.registryDir(), "--out-dir", join(tmp, "t")]);
    } finally {
      console.log = log;
    }
    assert.equal(res.code, 0);
    const text = out.join("\n");
    assert.match(text, /quick-fixture[\s\S]*does not advance/);
    assert.match(text, /CHAMPION FLOW: Research a company \(fixture, solid\)/);
    const [file] = readdirSync(join(tmp, "t"));
    const s = JSON.parse(readFileSync(join(tmp, "t", file), "utf8"));
    assert.equal(s.heats.length, 3);
    assert.equal(s.final.finalists, 2);
    assert.equal(s.procedures.length, 3);
    assert.equal(s.canonical.isChampion, true);
    assert.equal(s.records, undefined);
    assert.equal(registry.ledger().length, 9);
    assert.equal(registry.procedures(s.skillId).length, 3);
  });

  test("CLI: --procedures picks given flows, --per-heat is an alias", async () => {
    const log = console.log;
    console.log = () => {};
    let res;
    try {
      res = await main(["--dry-run", "--no-judge", "--per-heat", "2", "--procedures",
        "procedures/0000cccc-research-a-company-exhaustive-fixture,procedures/0000aaaa-research-a-company-fixture",
        "--registry-dir", registry.registryDir(), "--out-dir", join(tmp, "t")]);
    } finally {
      console.log = log;
    }
    const s = res.summary!;
    assert.equal(s.perFlow, 2);
    assert.deepEqual(s.heats.map((h) => [h.flow.procedureId.slice(11, 19), h.flow.source, h.runs]),
      [["0000cccc", "given", 2], ["0000aaaa", "given", 2]]);
    assert.equal(s.final.judge.status, "disabled");
    assert.equal(s.champion?.procedureId, "procedures/0000aaaa-research-a-company-fixture"); // cheaper at the same pass rate
    await assert.rejects(main(["--dry-run", "--procedures", "procedures/nope", "--registry-dir", registry.registryDir()]), /not a fixture flow/);
  });
});
