// Certify a skill from a transfer exam.
//
//   node scripts/certify.ts --skill <skill.json> --transfer <transfer-result.json>
//        [--events <events.json>] [--isolation <facts.json>] [--cases <cases.json>]
//        [--reverify] [--require-isolation] [--promote] [--json]
//
//   --skill      a contract Skill, or a runtime record (.agent-university/skills/<id>.json)
//                whose `events` array carries the teacher's `skill.observed` event
//   --events     extra contract Events (e.g. demo/fixtures/events.json) to find skill.observed in
//   --isolation  {"<fact>": true|false, ...} from the runtime, e.g. different_scope, no_answer_leak
//   --reverify   re-run the artifact's verifier on artifact.path instead of trusting the report
//   --promote    record the decision in the company registry (registry/)
//
// Exit 0 when certified, 1 when not, 2 on bad usage.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { certify, explain, loadCases } from "../lib/certification.ts";
import { recordDecision } from "../lib/registry.ts";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

export function main(argv: string[]): number {
  const { values: a } = parseArgs({
    args: argv,
    options: {
      skill: { type: "string" }, transfer: { type: "string" }, events: { type: "string" },
      isolation: { type: "string" }, cases: { type: "string" }, reverify: { type: "boolean" },
      "require-isolation": { type: "boolean" }, promote: { type: "boolean" }, json: { type: "boolean" },
    },
  });
  if (!a.skill || !a.transfer) {
    console.error("usage: node scripts/certify.ts --skill <skill.json> --transfer <transfer-result.json> [options]");
    return 2;
  }
  const record = certify(read(a.skill), read(a.transfer), {
    cases: a.cases ? loadCases(a.cases) : undefined,
    events: a.events ? read(a.events) : undefined,
    isolation: a.isolation ? read(a.isolation) : null,
    reverify: a.reverify,
    requireIsolation: a["require-isolation"],
  });
  if (a.promote) recordDecision(record);
  console.log(a.json ? JSON.stringify(record, null, 2) : explain(record));
  return record.decision.certified ? 0 : 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
