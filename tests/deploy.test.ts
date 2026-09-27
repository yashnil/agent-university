// Deployment packaging (Vercel): the page and the product API routes read committed repo data with
// node fs at request time, which Next's output tracing cannot see. next.config.mjs must include it
// for every such route, and must never package local runtime state or secrets. Offline.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "../lib/certification.ts";
import { loadFinalDemo } from "../lib/product.ts";
import { DILIGENCE_PLAN } from "../lib/composite.ts";

// next.config.mjs is plain JS with no type declarations, so load it by path.
const configUrl = new URL("../next.config.mjs", import.meta.url).href;
const nextConfig = (await import(configUrl)).default as { outputFileTracingIncludes?: Record<string, string[]> };
const includes = nextConfig.outputFileTracingIncludes ?? {};
const ROUTES = ["/", "/api/skills", "/api/exam", "/api/run"];
// A path is packaged when one of the route's globs covers it (only the `**` and `*` forms used here).
const covered = (route: string, rel: string) => (includes[route] ?? []).some((g) => {
  const re = new RegExp("^" + g.replace(/^\.\//, "").replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/\*/g, ".+").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$");
  return re.test(rel);
});

test("every product route packages the committed data it reads", () => {
  const needed = [
    "demo/cases.json", // certification engine + UI
    "demo/fixtures/final-demo.json", "demo/fixtures/run-metrics.json", // demo mode, metrics
    "demo/fixtures/skill-transferred-vercel.json", "demo/fixtures/transfer-result-vercel.json",
    "demo/fixtures/events-vercel-transferred.json", "demo/fixtures/company-vercel.json", // /api/exam re-verifies it
    "demo/fixtures/events.json", "demo/fixtures/outreach.md", "demo/fixtures/certification-record.json", // UI
    ...DILIGENCE_PLAN.flatMap((p) => (typeof p.standIn === "string" ? [p.standIn] : [])), // composite stand-ins
    "registry/index.json", "registry/ledger.jsonl", "registry/skills/research-company.json", // live mode
    loadFinalDemo().exam.record.transfer.artifact.path!, // the artifact the certified record points at
  ];
  for (const rel of needed) {
    assert.ok(existsSync(join(ROOT, rel)), `${rel} is not in the repo`);
    for (const route of ROUTES) assert.ok(covered(route, rel), `${route} does not package ${rel}`);
  }
});

// Arena and FLOW FIGHTER run whole tournaments in the request and validate every run against the
// contracts in schemas/ (lib/schema.ts), so only those routes may also package schemas/.
const TOURNAMENT_ROUTES = new Set(["/arena", "/battle", "/api/arena/**", "/api/battle/**"]);

test("nothing local, secret or unused is packaged", () => {
  for (const [route, globs] of Object.entries(includes))
    for (const g of globs) {
      const tournament = TOURNAMENT_ROUTES.has(route);
      assert.doesNotMatch(g, tournament ? /agent-university|\.env|node_modules|\.git\b|scripts|tests/
        : /agent-university|\.env|node_modules|\.git\b|schemas|scripts|tests/, `${route}: ${g}`);
      assert.match(g, tournament ? /^\.\/(demo|registry|schemas)\// : /^\.\/(demo|registry)\//,
        `${route}: ${g} is outside the committed data directories`);
    }
});
