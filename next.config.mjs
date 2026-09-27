// Committed repo data the product reads with node fs at request time. Next's output tracing cannot
// see these reads (paths are built at runtime), so without this a deployed function has none of
// them (Vercel: ENOENT /var/task/demo/cases.json). Only small committed data: never
// .agent-university/ (local runtime state, gitignored), .env, or schemas/ (not read by these routes).
//   demo/cases.json        exam cases (certification engine, UI)
//   demo/fixtures/**       fixtures, the real sanitized Vercel handoff, final-demo.json, run-metrics.json,
//                          composite/ stand-ins; /api/exam re-verifies artifacts from here
//   registry/**            the certified registry live mode reads (index, skills/, ledger, procedures/)
const PRODUCT_DATA = [
  "./demo/cases.json",
  "./demo/fixtures/**/*",
  "./registry/index.json",
  "./registry/ledger.jsonl",
  "./registry/skills/**/*.json",
  "./registry/procedures/**/*.json",
];
const BATTLE_DATA = [...PRODUCT_DATA, "./schemas/**/*"];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The demo reads fixtures from the repo at request time (node fs), so pages stay dynamic.
  experimental: {},
  outputFileTracingIncludes: {
    "/": PRODUCT_DATA,
    "/api/skills": PRODUCT_DATA,
    "/api/exam": PRODUCT_DATA,
    "/api/run": PRODUCT_DATA,
    // Arena and FLOW FIGHTER run whole tournaments in the request: they also validate every run
    // against the contracts in schemas/ (lib/schema.ts) and read the fixture flows.
    "/arena": BATTLE_DATA,
    "/battle": BATTLE_DATA,
    "/api/arena/**": BATTLE_DATA,
    "/api/battle/**": BATTLE_DATA,
  },
};

export default nextConfig;
