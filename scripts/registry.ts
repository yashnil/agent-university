// Inspect the company skill registry.
//
//   node scripts/registry.ts list                 print the index
//   node scripts/registry.ts show <skill-id>      print a skill's canonical record
//   node scripts/registry.ts ledger [<skill-id>]  print every decision, oldest first

import { index, ledger, load } from "../lib/registry.ts";

const [cmd = "list", arg] = process.argv.slice(2);
if (cmd === "list") console.log(JSON.stringify(index(), null, 2));
else if (cmd === "show" && arg) {
  const rec = load(arg);
  if (!rec) {
    console.error(`${arg} is not certified`);
    process.exitCode = 1;
  } else console.log(JSON.stringify(rec, null, 2));
} else if (cmd === "ledger") {
  for (const r of ledger(arg))
    console.log(`${r.decision.decidedAt}  ${r.skill.id.padEnd(20)} ${(r.transfer.student.id ?? "?").padEnd(24)} ${r.decision.summary}`);
} else {
  console.error("usage: node scripts/registry.ts list | show <skill-id> | ledger [<skill-id>]");
  process.exitCode = 2;
}
