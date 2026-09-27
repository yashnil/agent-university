// FLOW FIGHTER (lib/battle/*): prompt parsing, fighter generation, choreography and the state reducer.
// Offline: the choreographer runs on a REAL dry arena event stream. Run with `node --test tests/battle.test.ts`.
import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { runArena } from "../lib/arena.ts";
import type { ArenaEvent } from "../lib/arena.ts";
import { createChoreographer } from "../lib/battle/choreo.ts";
import { distinctRoster, fighterFor, fixtureFighters, PALETTES } from "../lib/battle/fighters.ts";
import { parsePrompt } from "../lib/battle/prompt.ts";
import { initialBattleState, reduce, reduceAll } from "../lib/battle/reducer.ts";
import type { BattleState, FightAction } from "../lib/battle/types.ts";

// ------------------------------------------------------------------ prompt

describe("parsePrompt", () => {
  test("counts, cases and dry mode", () => {
    const s = parsePrompt("3 flows 2 agents each vercel stripe dry");
    assert.equal(s.parser, "rules");
    assert.deepEqual(s.options, { mode: "dry", flows: 3, perFlow: 2, cases: ["Vercel", "Stripe"] });
    assert.equal(s.title, "3 FLOWS · 2 AGENTS · VERCEL / STRIPE · DRY RUN");
  });

  test("no mode word defaults to dry, with defaults noted", () => {
    const s = parsePrompt("let them fight");
    assert.equal(s.options.mode, "dry");
    assert.equal(s.options.flows, 3);
    assert.equal(s.options.perFlow, 3);
    assert.equal(s.options.cases, undefined);
    assert.ok(s.notes.some((n) => n.startsWith("mode: dry")));
    assert.ok(s.notes.includes("flows: 3 (default)"));
    assert.ok(s.notes.some((n) => n.includes("(default)") && n.startsWith("cases")));
    assert.equal(s.title, "3 FLOWS · 3 AGENTS · VERCEL / STRIPE / SUPABASE · DRY RUN");
  });

  test("live words switch to live", () => {
    for (const p of ["live battle 2 flows", "run it for real", "qm arena"]) assert.equal(parsePrompt(p).options.mode, "live", p);
    assert.ok(parsePrompt("live battle 2 flows").title.endsWith("LIVE"));
  });

  test("word numbers", () => {
    const s = parsePrompt("four fighters, two students per flow, supabase");
    assert.equal(s.options.flows, 4);
    assert.equal(s.options.perFlow, 2);
    assert.deepEqual(s.options.cases, ["Supabase"]);
  });

  test("counts are clamped to 1-5 and the clamp is noted", () => {
    const s = parsePrompt("9 flows 12 agents");
    assert.equal(s.options.flows, 5);
    assert.equal(s.options.perFlow, 5);
    assert.ok(s.notes.includes("flows: 9 clamped to 5 (1-5)"));
    assert.ok(s.notes.some((n) => n.startsWith("agents per flow: 12 clamped to 5")));
    const z = parsePrompt("0 flows");
    assert.equal(z.options.flows, 1);
    assert.equal(z.title.split(" · ")[0], "1 FLOW");
  });

  test("x3-style agent count", () => {
    assert.equal(parsePrompt("2 flows x4 stripe").options.perFlow, 4);
  });

  test("cases keep mention order and are deduped", () => {
    assert.deepEqual(parsePrompt("stripe then vercel then stripe again").options.cases, ["Stripe", "Vercel"]);
  });

  test("fixture-only case is dropped in live mode, kept in dry", () => {
    assert.deepEqual(parsePrompt("dry northwind labs").options.cases, ["Northwind Labs"]);
    const live = parsePrompt("live northwind labs");
    assert.equal(live.options.cases, undefined);
    assert.ok(live.notes.some((n) => n.includes("fixture-only")));
  });

  test("explicit procedure ids", () => {
    const s = parsePrompt("fight procedures/0000aaaa-research-a-company-fixture vs procedures/0000bbbb-research-a-company-quick-fixture.");
    assert.deepEqual(s.options.procedures, [
      "procedures/0000aaaa-research-a-company-fixture",
      "procedures/0000bbbb-research-a-company-quick-fixture",
    ]);
  });

  test("pace words set paceMs in dry only", () => {
    assert.equal(parsePrompt("quick dry battle").options.paceMs, 800);
    assert.equal(parsePrompt("slow dramatic battle").options.paceMs, 2500);
    const live = parsePrompt("quick live battle");
    assert.equal(live.options.paceMs, undefined);
    assert.ok(live.notes.some((n) => n.includes("ignored")));
  });

  test("empty prompt never throws", () => {
    const s = parsePrompt("");
    assert.equal(s.options.mode, "dry");
    assert.equal(s.prompt, "");
  });
});

// ------------------------------------------------------------------ fighters

describe("fighters", () => {
  const flows = [
    { procedureId: "procedures/0000aaaa-research-a-company-fixture", title: "Research a company (fixture, solid)", source: "fixture" as const, rank: null },
    { procedureId: "procedures/0000bbbb-research-a-company-quick-fixture", title: "Research a company quickly (fixture, sloppy)", source: "fixture" as const, rank: null },
    { procedureId: "procedures/0000cccc-research-a-company-exhaustive-fixture", title: "Research a company exhaustively (fixture, slow)", source: "fixture" as const, rank: null },
  ];

  test("fighterFor is deterministic", () => {
    for (const f of flows) assert.deepEqual(fighterFor({ ...f }), fighterFor({ ...f }));
    const a = fighterFor(flows[0]);
    assert.equal(a.id, flows[0].procedureId);
    assert.equal(a.shortId, "0000aaaa");
    assert.equal(a.name, "SOLID");
    assert.ok(a.name.length <= 16);
    assert.ok(Number.isInteger(a.seed) && a.seed >= 0 && a.seed <= 0xffffffff);
  });

  test("names stay short for long titles", () => {
    const d = fighterFor({ procedureId: "procedures/xyz", title: "Scrape pricing pages from every competitor site and compile a spreadsheet", source: "recall", rank: 1 });
    assert.ok(d.name.length > 0 && d.name.length <= 16);
    assert.equal(d.name, d.name.toUpperCase());
  });

  test("the 3 fixture flows get distinct palettes", () => {
    const roster = fixtureFighters();
    assert.deepEqual(roster.map((d) => d.name), ["SOLID", "SLOPPY", "SLOWPOKE"]);
    assert.equal(new Set(roster.map((d) => d.palette)).size, 3);
    assert.ok(roster.every((d) => PALETTES.includes(d.palette)));
    const again = distinctRoster(flows.map((f) => fighterFor(f)));
    assert.equal(new Set(again.map((d) => d.palette)).size, 3);
  });
});

// ------------------------------------------------------------------ choreographer on a real dry stream

let events: ArenaEvent[] = [];
let actions: FightAction[] = [];

before(async () => {
  events = [];
  await runArena({ mode: "dry", paceMs: 5 }, (e) => events.push(e));
  const c = createChoreographer();
  actions = [];
  for (const e of events) actions.push(...c.push(e));
  actions.push(...c.flush());
});

describe("choreographer (real dry arena)", () => {
  test("the stream is a complete tournament", () => {
    assert.equal(events[0].type, "tournament.started");
    assert.equal(events[events.length - 1].type, "tournament.finished");
  });

  test("script shape: intro first, a match_start, victory last for the champion", () => {
    assert.ok(actions.length > 3);
    assert.equal(actions[0].kind, "intro");
    assert.ok(actions.some((a) => a.kind === "match_start"));
    const last = actions[actions.length - 1];
    assert.equal(last.kind, "victory");
    const done = events[events.length - 1] as Extract<ArenaEvent, { type: "tournament.finished" }>;
    assert.ok(done.champion);
    assert.equal(last.attacker, done.champion.procedureId);
    assert.equal(actions.filter((a) => a.kind === "victory").length, 1);
  });

  test("seq strictly increasing, durations sane", () => {
    for (let k = 1; k < actions.length; k++) assert.ok(actions[k].seq > actions[k - 1].seq, `seq at ${k}`);
    for (const a of actions) assert.ok(a.duration > 0 && a.duration <= 5000, `${a.kind} duration ${a.duration}`);
  });

  test("every attack comes from a fighter in the current match", () => {
    let current: string[] = [];
    let attacks = 0;
    for (const a of actions) {
      if (a.kind === "match_start") current = [a.attacker, a.defender].filter((x): x is string => !!x);
      if (a.kind === "attack_hit" || a.kind === "attack_miss") {
        attacks++;
        assert.ok(a.attacker && current.includes(a.attacker), `attacker ${a.attacker} not in ${current}`);
        if (a.defender) {
          assert.ok(current.includes(a.defender));
          assert.notEqual(a.defender, a.attacker);
        }
      }
    }
    assert.ok(attacks > 0);
  });

  test("intro carries the fighters in flow order", () => {
    const start = events[0] as Extract<ArenaEvent, { type: "tournament.started" }>;
    const defs = (actions[0].meta?.fighters ?? []) as { id: string }[];
    assert.deepEqual(defs.map((d) => d.id), start.heats.map((h) => h.flow?.procedureId ?? `heat-${h.heat}`));
  });

  test("replaying the stream twice into one choreographer adds nothing (duplicates ignored)", () => {
    const c = createChoreographer();
    const once: FightAction[] = [];
    for (const e of events) once.push(...c.push(e));
    const dup: FightAction[] = [];
    for (const e of events) dup.push(...c.push(e));
    dup.push(...c.flush());
    assert.equal(dup.filter((a) => a.kind === "intro" || a.kind === "attack_hit" || a.kind === "attack_miss" || a.kind === "victory").length, 0);
  });
});

describe("choreographer robustness", () => {
  test("unknown / junk events are ignored without throwing", () => {
    const c = createChoreographer();
    assert.deepEqual(c.push({ type: "nope", at: "x" } as unknown as ArenaEvent), []);
    assert.doesNotThrow(() => c.push(null as unknown as ArenaEvent));
    assert.doesNotThrow(() => c.push({} as unknown as ArenaEvent));
    assert.doesNotThrow(() => c.flush());
  });

  test("error event becomes an error action with the message", () => {
    const c = createChoreographer();
    const out = c.push({ type: "error", at: "2026-01-01T00:00:00Z", message: "unknown exam case: Nowhere Inc" });
    const err = out.find((a) => a.kind === "error");
    assert.ok(err);
    assert.match(err.label ?? "", /Nowhere Inc/);
  });

  test("a real failing arena run yields an error action", async () => {
    const evs: ArenaEvent[] = [];
    await runArena({ mode: "dry", cases: ["Nowhere Inc"] }, (e) => evs.push(e));
    const c = createChoreographer();
    const out = evs.flatMap((e) => c.push(e)).concat(c.flush());
    assert.ok(out.some((a) => a.kind === "error"));
  });
});

// ------------------------------------------------------------------ reducer

describe("reducer", () => {
  test("initial state is idle and empty", () => {
    assert.equal(initialBattleState.phase, "idle");
    assert.deepEqual(initialBattleState.fighters, {});
    assert.equal(initialBattleState.champion, null);
  });

  test("reduceAll over the real script ends in victory with the champion set", () => {
    const done = events[events.length - 1] as Extract<ArenaEvent, { type: "tournament.finished" }>;
    let s: BattleState = initialBattleState;
    for (const a of actions) {
      const prev = s;
      s = reduce(s, a);
      assert.equal(s.action, a);
      assert.notEqual(s, prev); // pure: a new object each time
      for (const f of Object.values(s.fighters)) assert.ok(f.hp >= 0 && f.hp <= 100, `${f.def.name} hp ${f.hp} after ${a.kind}`);
      assert.ok(s.feed.length <= 50);
    }
    assert.equal(s.phase, "victory");
    assert.equal(s.champion, done.champion?.procedureId);
    assert.ok(s.champion && s.fighters[s.champion]);
    assert.equal(s.fighters[s.champion].eliminated, false);
    assert.deepEqual(reduceAll(actions), s);
    assert.equal(initialBattleState.phase, "idle"); // not mutated
  });

  test("flows that did not advance are marked eliminated", () => {
    const s = reduceAll(actions);
    const out = events.filter((e): e is Extract<ArenaEvent, { type: "heat.finished" }> => e.type === "heat.finished" && !e.advances);
    for (const h of out) if (h.procedureId) assert.equal(s.fighters[h.procedureId]?.eliminated, true, h.procedureId);
    const eliminated = Object.values(s.fighters).filter((f) => f.eliminated);
    assert.ok(eliminated.every((f) => f.hp === 0));
    assert.equal(Object.keys(s.fighters).length, (events[0] as Extract<ArenaEvent, { type: "tournament.started" }>).heats.length);
  });

  test("run counts match the stream", () => {
    const s = reduceAll(actions);
    for (const id of s.order) {
      const f = s.fighters[id];
      assert.equal(f.certified + f.failed, f.runs);
    }
  });

  test("error action puts the state in error", () => {
    const s = reduce(initialBattleState, { seq: 1, kind: "error", duration: 2500, label: "boom" });
    assert.equal(s.phase, "error");
    assert.equal(s.error, "boom");
  });
});
