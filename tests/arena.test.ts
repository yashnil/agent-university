// Arena (lib/arena.ts): the website's tournament runner streams progress in a usable order.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runArena } from "../lib/arena.ts";
import type { ArenaEvent } from "../lib/arena.ts";
import * as registry from "../lib/registry.ts";
import { errorsAgainst } from "../lib/schema.ts";

test("a dry arena streams a complete, ordered tournament without touching the real registry", async () => {
  const before = registry.registryDir();
  const events: ArenaEvent[] = [];
  await runArena({ mode: "dry", paceMs: 5 }, (e) => events.push(e));
  const types = events.map((e) => e.type);

  assert.equal(types[0], "tournament.started");
  assert.equal(types.at(-1), "tournament.finished");
  assert.ok(!types.includes("error"));
  assert.equal(types.filter((t) => t === "student.started").length, 9);
  assert.equal(types.filter((t) => t === "student.finished").length, 9);
  assert.equal(types.filter((t) => t === "heat.finished").length, 3);
  assert.ok(types.indexOf("final.started") > types.lastIndexOf("heat.finished"));

  // Every student starts before it finishes, and each heat finishes after all of its students.
  for (const e of events.filter((x) => x.type === "student.finished")) {
    const started = events.findIndex((x) => x.type === "student.started" && x.heat === e.heat && x.i === e.i);
    assert.ok(started >= 0 && started < events.indexOf(e));
  }
  for (const h of events.filter((x) => x.type === "heat.finished")) {
    const last = Math.max(...events.map((x, k) => (x.type === "student.finished" && x.heat === h.heat ? k : -1)));
    assert.ok(last < events.indexOf(h));
  }

  const end = events.at(-1) as Extract<ArenaEvent, { type: "tournament.finished" }>;
  assert.ok(end.champion);
  assert.equal(end.promoted, true);
  assert.notEqual(end.registry, before); // dry runs use a throwaway registry
  assert.equal(registry.registryDir(), before); // and put the real one back
  assert.deepEqual(errorsAgainst(end.record, "certification-record.schema.json"), []);
});

test("a failure arrives as an error event, not an exception", async () => {
  const events: ArenaEvent[] = [];
  await runArena({ mode: "dry", cases: ["Nowhere Inc"] }, (e) => events.push(e));
  assert.deepEqual(events.map((e) => e.type), ["error"]);
});
