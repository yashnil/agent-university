// Tournament (lib/tournament.ts, scripts/tournament.ts): deterministic heats, a Jev-judged final
// among certified heat winners only, and a canonical champion. Offline: no QM, Docker or network.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { CandidateSkill } from "../lib/certification.ts";
import type { JudgeFn, JudgedRecord } from "../lib/jev.ts";
import { agentIdentity, ROOT } from "../lib/qm.ts";
import * as registry from "../lib/registry.ts";
import type { LaunchStudent, Metrics } from "../lib/swarm.ts";
import { contractErrors } from "../lib/swarm.ts";
import { makeFinalJudge, runTournament } from "../lib/tournament.ts";
import type { HeatSpec, TournamentOptions } from "../lib/tournament.ts";
import type { TransferResult } from "../lib/types.ts";
import { drySkill } from "../scripts/swarm.ts";
import { main } from "../scripts/tournament.ts";

const AT = "2026-01-03T00:00:00Z";
const CASES = ["exam-vercel", "exam-stripe", "exam-supabase"];
const base: TransferResult = JSON.parse(readFileSync(join(ROOT, "demo", "fixtures", "transfer-result.json"), "utf8"));
const student = (h: number, i: number) => agentIdentity(`web:test:h${h}:${i}`, `Freshman #${i}`);
const run = (h: number, i: number) => `h${h}-run-${i}`;

type Plan = { metrics: Metrics; fail?: boolean; crash?: boolean };

/** A heat whose student i follows plans[i-1]. */
function heat(skill: CandidateSkill, h: number, plans: Plan[], seen?: number[]): HeatSpec {
  const launch: LaunchStudent = async (i) => {
    seen?.push(h);
    const p = plans[i - 1];
    if (p.crash) throw new Error("sandbox exploded");
    const t: TransferResult = structuredClone(base);
    Object.assign(t, { examCase: CASES[(h - 1) % 3], runId: run(h, i), student: student(h, i) });
    if (p.fail) {
      t.verification.checks[t.verification.checks.length - 1].passed = false;
      t.verification.passed = t.passed = false;
    }
    return { transfer: t, metrics: { ...p.metrics }, isolation: { different_scope: true }, artifact: JSON.stringify({ h, i }) };
  };
  return { heat: h, examCase: CASES[(h - 1) % 3], skill, launch, studentFor: (i) => student(h, i), swarmId: `t-h${h}` };
}

const m = (costUsd: number, durationMs = 100000): Metrics => ({ durationMs, toolCalls: 10, turns: 5, costUsd });

/** Heat 1: student 2 is the cheapest certified (student 3 cheaper but failed). Heat 2: nobody certified.
 *  Heat 3: student 1 is the cheapest certified. The final by metrics alone would pick h1-run-2 (0.2 < 0.3). */
function standard(skill: CandidateSkill, seen?: number[]): HeatSpec[] {
  return [
    heat(skill, 1, [{ metrics: m(0.5) }, { metrics: m(0.2) }, { metrics: m(0.01), fail: true }], seen),
    heat(skill, 2, [{ metrics: m(0.1), fail: true }, { metrics: m(0), crash: true }, { metrics: m(0.1), fail: true }], seen),
    heat(skill, 3, [{ metrics: m(0.3) }, { metrics: m(0.4) }, { metrics: m(0.9) }], seen),
  ];
}

const fakeJudge = (scores: Record<string, number>, seen?: JudgedRecord[][]): JudgeFn =>
  Object.assign((records: JudgedRecord[]) => {
    seen?.push(records);
    return Object.fromEntries(Object.entries(scores).map(([k, score]) => [k, { score, rationale: `fake ${k}` }]));
  }, { model: "fake-jev" });

describe("tournament", () => {
  let tmp: string;
  let skill: CandidateSkill;
  const before = registry.registryDir();
  const play = (heats: HeatSpec[], opts: TournamentOptions = {}) =>
    runTournament(heats, 3, { decidedAt: AT, tournamentId: "t", ...opts });

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "au-tournament-test-"));
    registry.setRegistryDir(join(tmp, "registry"));
    skill = drySkill();
  });
  afterEach(() => {
    registry.setRegistryDir(before);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("each heat winner is the deterministic best certified record", async () => {
    const t = await play(standard(skill));
    assert.equal(t.heats[0].winner?.runId, run(1, 2));
    assert.equal(t.heats[2].winner?.runId, run(3, 1));
    assert.equal(t.heats[0].leaderboard.every((e) => e.judge === null), true); // no judge inside heats
    assert.deepEqual(t.heats.map((h) => h.examCase), CASES);
  });

  test("a heat with zero certified records sends no finalist", async () => {
    const t = await play(standard(skill), { judge: fakeJudge({ [run(1, 2)]: 5, [run(3, 1)]: 6 }) });
    assert.equal(t.heats[1].certifiedCount, 0);
    assert.equal(t.heats[1].winner, null);
    assert.equal(t.final.finalists, 2);
    assert.ok(t.final.ranking.every((r) => r.heat !== 2));
    assert.ok(t.records.filter((r) => r.tournament?.heat === 2).every((r) => r.tournament?.round === "heat"));
  });

  test("Jev decides the final, among finalists only", async () => {
    const seen: JudgedRecord[][] = [];
    const scores = { [run(1, 2)]: 4, [run(3, 1)]: 9, [run(3, 3)]: 10, [run(1, 3)]: 10, [run(2, 1)]: 10 };
    const t = await play(standard(skill), { judge: fakeJudge(scores, seen) });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].map((r) => r.transfer.runId).sort(), [run(1, 2), run(3, 1)]);
    assert.ok(seen[0].every((r) => r.decision.certified));
    assert.equal(t.final.judge.status, "ok");
    assert.equal(t.champion?.runId, run(3, 1)); // metrics alone would pick h1-run-2
    assert.equal(t.champion?.judgeScore, 9);
    assert.deepEqual(t.final.ranking.map((r) => [r.rank, r.runId]), [[1, run(3, 1)], [2, run(1, 2)]]);
    for (const r of t.records) if (!t.final.ranking.some((f) => f.runId === r.transfer.runId)) assert.equal(r.judge, undefined);
  });

  test("a failing final judge falls back to the deterministic ranking", async () => {
    const broken: JudgeFn = Object.assign(() => { throw new Error("upstream 503"); }, { model: "broken" });
    const t = await play(standard(skill), { judge: broken });
    assert.equal(t.final.judge.status, "unavailable");
    assert.match(t.final.judge.reason ?? "", /upstream 503/);
    assert.equal(t.champion?.runId, run(1, 2));
    assert.ok(t.records.every((r) => r.judge === undefined));
  });

  test("the champion is canonical and every record is in the ledger, champion last", async () => {
    const t = await play(standard(skill), { judge: fakeJudge({ [run(1, 2)]: 4, [run(3, 1)]: 9 }) });
    const rows = registry.ledger();
    assert.equal(rows.length, 9);
    assert.equal(rows[8].transfer.runId, t.champion?.runId);
    assert.equal(rows[7].transfer.runId, run(1, 2)); // the other finalist just before
    assert.equal(registry.load(skill.id)?.transfer.runId, run(3, 1));
    assert.equal(t.canonical?.isChampion, true);
    assert.equal(t.champion?.promoted, true);
    const champ = t.records.find((r) => r.transfer.runId === run(3, 1))!;
    assert.deepEqual(champ.tournament, { tournamentId: "t", heat: 3, round: "final", place: 1 });
    assert.deepEqual(t.records.find((r) => r.transfer.runId === run(1, 1))!.tournament,
      { tournamentId: "t", heat: 1, round: "heat", place: 2 });
  });

  test("records and events match the contracts", async () => {
    const t = await play(standard(skill), { judge: fakeJudge({ [run(1, 2)]: 4, [run(3, 1)]: 9 }) });
    assert.equal(t.records.length, 9);
    for (const r of t.records) {
      assert.deepEqual(contractErrors(r, "certification-record.schema.json"), [], r.transfer.runId ?? r.transfer.student.name);
      for (const e of r.events) assert.deepEqual(contractErrors(e, "contracts/event.schema.json"), [], e.type);
    }
  });

  test("no certified record anywhere: no finalist, no champion, nothing canonical", async () => {
    const f = { metrics: m(0.1), fail: true };
    const t = await play([heat(skill, 1, [f, f, f]), heat(skill, 2, [f, f, f])], { judge: fakeJudge({}) });
    assert.equal(t.final.finalists, 0);
    assert.equal(t.champion, null);
    assert.equal(registry.load(skill.id), null);
    assert.equal(registry.ledger().length, 6);
  });

  test("heats run concurrently under one global student limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const heats = standard(skill).map((h) => {
      const inner = h.launch;
      return { ...h, launch: (async (i, signal) => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return inner(i, signal);
      }) as LaunchStudent };
    });
    await play(heats, { maxParallel: 4 });
    assert.equal(peak, 4); // 9 students, 3 heats, never more than 4 at once
  });

  test("the live final prompt says the finalists researched different companies", async () => {
    const bodies: any[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const content = JSON.stringify({ rankings: [{ runId: run(1, 2), score: 8, rationale: "ok" }, { runId: run(3, 1), score: 6, rationale: "ok" }] });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = await play(standard(skill), { judge: makeFinalJudge({ key: "k", fetchFn: fakeFetch }) });
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].model, "typesafe/jev-router");
    assert.equal(bodies[0].temperature, 0);
    assert.match(bodies[0].messages[0].content, /DIFFERENT companies/);
    const user = JSON.parse(bodies[0].messages[1].content);
    assert.deepEqual(user.finalists.map((f: any) => [f.runId, f.company]), [[run(1, 2), "Vercel"], [run(3, 1), "Supabase"]]);
    assert.equal(t.champion?.runId, run(1, 2));
    assert.match(t.final.judge.promptDigest ?? "", /^sha256:[0-9a-f]{64}$/);
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
    assert.match(text, /== Heat 2: exam-stripe .*0\/3 certified/);
    assert.match(text, /no finalist from this heat/);
    assert.match(text, /CHAMPION: .*heat 3/);
    assert.equal(registry.ledger().length, 9);
    const [file] = readdirSync(join(tmp, "t"));
    const s = JSON.parse(readFileSync(join(tmp, "t", file), "utf8"));
    assert.equal(s.heats.length, 3);
    assert.ok(s.final.ranking.length >= 2);
    assert.equal(s.final.judge.status, "ok");
    assert.equal(s.canonical.isChampion, true);
    assert.equal(s.records, undefined);
  });

  test("a single --cases entry is used by every heat", async () => {
    const log = console.log;
    console.log = () => {};
    let res;
    try {
      res = await main(["--dry-run", "--cases", "Vercel", "--no-judge", "--registry-dir", registry.registryDir(), "--out-dir", join(tmp, "t")]);
    } finally {
      console.log = log;
    }
    assert.deepEqual(res.summary?.heats.map((h) => h.examCase), ["exam-vercel", "exam-vercel", "exam-vercel"]);
    assert.equal(res.summary?.final.judge.status, "disabled");
  });
});
