// The swarm exam (lib/swarm.ts, lib/jev.ts, scripts/swarm.ts): N students, deterministic
// certification, an advisory judge over certified records only, one canonical winner.
// Offline: no QM, Memorable, Docker or network. Run with `node --test tests/`.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { CandidateSkill } from "../lib/certification.ts";
import { makeJevJudge, parseRankings } from "../lib/jev.ts";
import type { JudgeFn, JudgedRecord } from "../lib/jev.ts";
import { agentIdentity, ROOT } from "../lib/qm.ts";
import * as registry from "../lib/registry.ts";
import { contractErrors, runMetrics, runSwarm } from "../lib/swarm.ts";
import type { LaunchStudent, Metrics, SwarmOptions } from "../lib/swarm.ts";
import type { TransferResult } from "../lib/types.ts";
import { drySkill, main } from "../scripts/swarm.ts";

const AT = "2026-01-02T00:00:00Z";
const fixture = (name: string) => JSON.parse(readFileSync(join(ROOT, "demo", "fixtures", name), "utf8"));
const studentOf = (i: number) => agentIdentity(`web:test:${i}`, `Agent #${i}`);

/** Fake launcher: passing students with the given metrics; some crash, fail a check, or hang. */
function launcher(metrics: Record<number, Metrics>, o: { crash?: number[]; fail?: number[]; hang?: number[] } = {}) {
  const calls: number[] = [];
  const base: TransferResult = fixture("transfer-result.json");
  const launch: LaunchStudent = async (i, signal) => {
    calls.push(i);
    if (o.crash?.includes(i)) throw new Error("sandbox exploded");
    if (o.hang?.includes(i)) await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 5000);
      signal.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); });
    });
    const t: TransferResult = structuredClone(base);
    Object.assign(t, { examCase: "exam-vercel", runId: `run-${String(i).padStart(2, "0")}`, student: studentOf(i) });
    if (o.fail?.includes(i)) {
      t.verification.checks[t.verification.checks.length - 1].passed = false;
      t.verification.passed = t.passed = false;
    }
    return { transfer: t, metrics: { ...metrics[i] }, isolation: { different_scope: true, no_source_answer_in_prompt: true },
      artifact: JSON.stringify({ run: i }) };
  };
  return { launch, calls };
}

/** Student 3 is the cheapest and fastest; student 4 is cheaper still but (in some tests) fails. */
function metrics(n: number): Record<number, Metrics> {
  const m: Record<number, Metrics> = {};
  for (let i = 1; i <= n; i++) m[i] = { durationMs: 100000 + i, toolCalls: 10, turns: 5, costUsd: 0.5 };
  m[3] = { durationMs: 90000, toolCalls: 8, turns: 4, costUsd: 0.2 };
  m[4] = { durationMs: 1000, toolCalls: 1, turns: 1, costUsd: 0.01 };
  return m;
}

describe("swarm", () => {
  let tmp: string;
  let skill: CandidateSkill;
  const before = registry.registryDir();
  const swarm = (launch: LaunchStudent, n: number, opts: SwarmOptions = {}) =>
    runSwarm(skill, n, launch, { decidedAt: AT, examCase: "exam-vercel", studentFor: studentOf, swarmId: "swarm-test", ...opts });

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "au-swarm-test-"));
    registry.setRegistryDir(join(tmp, "registry"));
    skill = drySkill();
  });
  afterEach(() => {
    registry.setRegistryDir(before);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("winner is the certified record with the best metrics (no judge)", async () => {
    const s = await swarm(launcher(metrics(6), { fail: [4] }).launch, 6);
    assert.equal(s.certifiedCount, 5);
    assert.equal(s.judge.status, "disabled");
    assert.equal(s.winner?.runId, "run-03");
    assert.equal(s.winner?.studentId, studentOf(3).id);
    assert.equal(s.winner?.promoted, true);
    assert.deepEqual(s.leaderboard.map((e) => e.rank), [1, 2, 3, 4, 5, 6]);
    const last = s.leaderboard[5];
    assert.equal(last.runId, "run-04"); // cheapest run, but it failed a check
    assert.equal(last.certified, false);
    assert.ok(last.failedRules.includes("verifier_checks_passed"));
    assert.deepEqual(s.leaderboard[0].metrics, { durationMs: 90000, toolCalls: 8, turns: 4, costUsd: 0.2 });
  });

  test("a newly canonical winner's artifact is published for the UI; a failed swarm publishes nothing", async () => {
    const dir = join(tmp, "artifacts");
    await swarm(launcher(metrics(4)).launch, 4, { artifactsDir: dir });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "exam-vercel", "company.json"), "utf8")), { run: 4 }); // the cheapest certified run
    const dir2 = join(tmp, "artifacts-none");
    await swarm(launcher(metrics(2), { fail: [1, 2] }).launch, 2, { artifactsDir: dir2 });
    assert.throws(() => readdirSync(dir2));
  });

  test("a crashing student does not kill the swarm and appears as failed", async () => {
    const s = await swarm(launcher(metrics(4), { crash: [2] }).launch, 4);
    assert.equal(s.leaderboard.length, 4);
    const crashed = s.leaderboard.find((e) => e.student === "Agent #2")!;
    assert.equal(crashed.certified, false);
    assert.ok(crashed.failedChecks.includes("run_completed"));
    assert.match(crashed.error ?? "", /sandbox exploded/);
    assert.equal(s.leaderboard[3].student, "Agent #2");
    const t = s.students.find((x) => x.student === 2)!.transfer;
    assert.deepEqual(contractErrors(t, "contracts/transfer-result.schema.json"), []);
    assert.equal(t.passed, false);
    assert.deepEqual(t.verification.checks.map((c) => [c.name, c.passed]), [["file_exists", false], ["run_completed", false]]);
    assert.equal(s.certifiedCount, 3);
  });

  test("a student past its timeout is aborted and fails run_completed", async () => {
    const s = await swarm(launcher(metrics(3), { hang: [1] }).launch, 3, { timeoutMs: 200 });
    const straggler = s.leaderboard.find((e) => e.student === "Agent #1")!;
    assert.equal(straggler.certified, false);
    assert.ok(straggler.failedChecks.includes("run_completed"));
    assert.match(straggler.error ?? "", /timed out/);
    assert.equal(s.certifiedCount, 2);
  });

  test("records, transfers and events match the contracts", async () => {
    const s = await swarm(launcher(metrics(5), { crash: [5], fail: [4] }).launch, 5);
    assert.equal(s.records.length, 5);
    for (const r of s.records) {
      assert.deepEqual(contractErrors(r, "certification-record.schema.json"), [], r.transfer.student.name);
      for (const e of r.events) assert.deepEqual(contractErrors(e, "contracts/event.schema.json"), [], e.type);
    }
    for (const st of s.students) {
      assert.deepEqual(contractErrors(st.transfer, "contracts/transfer-result.schema.json"), []);
      assert.ok(st.events.length > 0);
      for (const e of st.events) assert.deepEqual(contractErrors(e, "contracts/event.schema.json"), [], e.type);
    }
    assert.equal(s.records.flatMap((r) => r.events).filter((e) => e.type === "skill.certified").length, 3);
  });

  test("the registry gets every decision and exactly one canonical record", async () => {
    const n = 5;
    const s = await swarm(launcher(metrics(n), { crash: [1], fail: [4] }).launch, n);
    const rows = registry.ledger();
    assert.equal(rows.length, n);
    assert.equal(rows[n - 1].transfer.runId, s.winner?.runId); // the winner is recorded last
    assert.deepEqual(readdirSync(join(registry.registryDir(), "skills")), [`${skill.id}.json`]);
    assert.equal(registry.load(skill.id)?.transfer.runId, "run-03");
    assert.equal(registry.index().skills.length, 1);
    assert.equal(s.canonical?.isWinner, true);
  });

  test("students have distinct identities, none of them the teacher", async () => {
    const l = launcher(metrics(4));
    const s = await swarm(l.launch, 4);
    const ids = new Set(s.leaderboard.map((e) => e.studentId));
    assert.equal(ids.size, 4);
    assert.ok(!ids.has(skill.teacher.id));
    assert.deepEqual([...l.calls].sort(), [1, 2, 3, 4]);
  });

  test("concurrency is bounded by maxParallel", async () => {
    let inFlight = 0;
    let peak = 0;
    const base = launcher(metrics(6)).launch;
    const launch: LaunchStudent = async (i, signal) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return base(i, signal);
    };
    await swarm(launch, 6, { maxParallel: 2 });
    assert.equal(peak, 2);
  });

  // ---------------------------------------------------------------- judge

  const fakeJudge = (scores: Record<string, number>, seen?: JudgedRecord[][]): JudgeFn =>
    Object.assign((records: JudgedRecord[]) => {
      seen?.push(records);
      return Object.fromEntries(Object.entries(scores).map(([k, score]) => [k, { score, rationale: `fake ${k}`, promptDigest: "sha256:" + "0".repeat(64) }]));
    }, { model: "fake-jev" });

  test("the judge reorders certified records and its winner becomes canonical", async () => {
    const s = await swarm(launcher(metrics(4)).launch, 4, { judge: fakeJudge({ "run-01": 9, "run-02": 6, "run-03": 5, "run-04": 7 }) });
    assert.equal(s.judge.status, "ok");
    assert.equal(s.winner?.runId, "run-01"); // metrics alone would pick run-04
    assert.equal(s.winner?.judgeScore, 9);
    assert.deepEqual(s.leaderboard.map((e) => e.runId), ["run-01", "run-04", "run-02", "run-03"]);
    assert.equal(registry.load(skill.id)?.transfer.runId, "run-01");
    assert.equal(s.canonical?.isWinner, true);
    const r = s.records.find((x) => x.transfer.runId === "run-01")!;
    assert.deepEqual(r.judge, { model: "fake-jev", score: 9, rationale: "fake run-01", promptDigest: "sha256:" + "0".repeat(64) });
    assert.deepEqual(contractErrors(r, "certification-record.schema.json"), []);
  });

  test("a failing judge falls back to the deterministic ranking", async () => {
    const broken: JudgeFn = Object.assign(() => { throw new Error("upstream 503"); }, { model: "broken" });
    const s = await swarm(launcher(metrics(4), { fail: [4] }).launch, 4, { judge: broken });
    assert.equal(s.judge.status, "unavailable");
    assert.match(s.judge.reason ?? "", /upstream 503/);
    assert.equal(s.winner?.runId, "run-03");
    assert.ok(s.records.every((r) => r.judge === undefined));
  });

  test("the judge never sees, scores or promotes a failed record", async () => {
    const seen: JudgedRecord[][] = [];
    const s = await swarm(launcher(metrics(4), { fail: [4], crash: [2] }).launch, 4,
      { judge: fakeJudge({ "run-01": 3, "run-03": 4, "run-04": 10, "student-2": 10 }, seen) });
    assert.equal(seen.length, 1);
    assert.ok(seen[0].every((r) => r.decision.certified));
    assert.deepEqual(seen[0].map((r) => r.transfer.runId).sort(), ["run-01", "run-03"]);
    assert.equal(s.winner?.runId, "run-03");
    assert.equal(s.winner?.certified, true);
    for (const r of s.records.filter((r) => !r.decision.certified)) assert.equal(r.judge, undefined);
    assert.equal(s.leaderboard[s.leaderboard.length - 1].judge, null);
    assert.equal(registry.load(skill.id)?.transfer.runId, "run-03");
  });

  test("a judge with no certified records is skipped", async () => {
    const s = await swarm(launcher(metrics(2), { fail: [1, 2] }).launch, 2, { judge: fakeJudge({ "run-01": 10 }) });
    assert.equal(s.judge.status, "skipped");
    assert.equal(s.winner?.certified, false);
    assert.equal(registry.load(skill.id), null);
  });

  test("Jev without an API key falls back", async () => {
    const s = await swarm(launcher(metrics(3)).launch, 3, { judge: makeJevJudge({ key: null }) });
    assert.equal(s.judge.status, "unavailable");
    assert.match(s.judge.reason ?? "", /OPENROUTER_API_KEY/);
    assert.equal(s.winner?.runId, "run-03");
  });

  test("Jev request shape, 400 retry without response_format, and defensive parse", async () => {
    const bodies: any[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push({ body, auth: (init.headers as Record<string, string>).Authorization });
      if (body.response_format) return new Response("response_format not supported", { status: 400 });
      const content = "Here you go:\n```json\n" + JSON.stringify({ rankings: [
        { runId: "run-02", score: "8", rationale: "specific" }, { runId: "run-01", score: 42, rationale: "clamped" }] }) + "\n```";
      return new Response(JSON.stringify({ model: "some/underlying-model", choices: [{ message: { content } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const s = await swarm(launcher(metrics(3)).launch, 3, { judge: makeJevJudge({ key: "test-key", fetchFn: fakeFetch }) });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].body.model, "typesafe/jev-router");
    assert.equal(bodies[0].body.temperature, 0);
    assert.deepEqual(bodies[0].body.response_format, { type: "json_object" });
    assert.equal(bodies[1].body.response_format, undefined);
    assert.equal(bodies[0].auth, "Bearer test-key");
    const prompt = bodies[0].body.messages[1].content;
    assert.match(prompt, /exam-vercel/);
    assert.match(prompt, /"run-03"/);
    assert.equal(s.judge.status, "ok");
    assert.equal(s.winner?.runId, "run-01"); // score 42 clamps to 10
    const judged = s.records.find((r) => r.transfer.runId === "run-01")!.judge!;
    assert.equal(judged.score, 10);
    assert.equal(judged.model, "typesafe/jev-router");
    assert.equal(judged.servedBy, "some/underlying-model");
    assert.match(judged.promptDigest ?? "", /^sha256:[0-9a-f]{64}$/);
    assert.equal(s.records.find((r) => r.transfer.runId === "run-03")!.judge, undefined); // not ranked by Jev
  });

  test("parseRankings", () => {
    assert.deepEqual(parseRankings('[{"runId":"a","score":7,"rationale":"x"}]'), { a: { score: 7, rationale: "x" } });
    assert.deepEqual(parseRankings('noise {"rankings":[{"runId":"b","score":-3}]} trailing'), { b: { score: 0, rationale: "" } });
    assert.throws(() => parseRankings("I think run-01 is best"), /no usable rankings/);
  });

  test("runMetrics reads a QM run object", () => {
    const run: any = {
      status: "done", createdAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:02:30Z",
      activity: ["text", "tool_call", "tool_call", "tool_result", "tool_result", "tool_call", "tool_result", "text"]
        .map((type) => ({ type, payload: {} })),
    };
    assert.deepEqual(runMetrics(run, 999), { durationMs: 150000, toolCalls: 3, turns: 3 });
    delete run.finishedAt;
    run.usage = { inputTokens: 10, costUsd: 0.12 };
    const m = runMetrics(run, 4321);
    assert.deepEqual([m.durationMs, m.costUsd], [4321, 0.12]);
  });

  test("dry-run CLI end to end", async () => {
    const log = console.log;
    const out: string[] = [];
    console.log = (...a: unknown[]) => { out.push(a.join(" ")); };
    let res;
    try {
      res = await main(["Vercel", "--dry-run", "-n", "10", "--registry-dir", registry.registryDir(), "--out-dir", join(tmp, "swarms")]);
    } finally {
      console.log = log;
    }
    assert.equal(res.code, 0);
    const text = out.join("\n");
    assert.match(text, /winner: Agent #9/);
    assert.match(text, /jev/);
    assert.equal(registry.ledger().length, 10);
    const [file] = readdirSync(join(tmp, "swarms"));
    const summary = JSON.parse(readFileSync(join(tmp, "swarms", file), "utf8"));
    for (const k of ["swarmId", "skillId", "examCase", "n", "startedAt", "finishedAt", "winner", "leaderboard", "judge"])
      assert.ok(k in summary, k);
    assert.equal(summary.certifiedCount, 4);
    assert.equal(summary.judge.status, "ok");
    assert.equal(summary.canonical.isWinner, true);
    assert.equal(summary.records, undefined);
  });
});
