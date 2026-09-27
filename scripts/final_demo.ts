// Regenerate demo/fixtures/final-demo.json, the frozen demo state, from production code:
//   node scripts/final_demo.ts
// tests/product.test.ts fails when the committed file differs from what this produces.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib/certification.ts";
import { buildFinalDemo } from "../lib/product.ts";

const out = join(ROOT, "demo", "fixtures", "final-demo.json");
writeFileSync(out, JSON.stringify(buildFinalDemo(), null, 2) + "\n");
console.log(`wrote ${out}`);
