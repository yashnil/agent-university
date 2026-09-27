#!/usr/bin/env node
// Tournament CLI: K heats of M fresh students, one unseen exam case per heat; the certified heat
// winners meet in a Jev-judged final; the champion becomes the canonical record.
//
//   node scripts/tournament.ts [--cases Vercel,Stripe,Supabase] [--heats 3] [--per-heat 3]
//        [--dry-run] [--live-judge] [--no-judge] [--registry-dir DIR] [--out-dir DIR] [--json]
//        [--timeout SECS] [--max-parallel 9]
//
// --cases takes company names or case ids from demo/cases.json. One case means every heat uses
// it; otherwise heat h uses case h (cycling). --max-parallel caps students in flight across all
// heats (default 9) so QM is not overloaded.
// --dry-run: no QM, Docker or Memorable; each heat gets different fabricated students (by default
// heat 2 certifies nobody, to show that path), the offline fixture judge unless --live-judge, and a
// temp registry unless --registry-dir. The summary goes to .agent-university/tournaments/<id>.json.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Case } from "../lib/certification.ts";
import { loadCases } from "../lib/certification.ts";
import { fixtureJudge } from "../lib/jev.ts";
import type { JudgeFn } from "../lib/jev.ts";
import * as registry from "../lib/registry.ts";
import { caseForHeat, makeFinalJudge, newTournamentId, runTournament, saveTournament, tournamentReport, withFinalPrompt } from "../lib/tournament.ts";
import type { HeatSpec, TournamentSummary } from "../lib/tournament.ts";
import { DRY_PROFILES, DryExam, LiveExam } from "./swarm.ts";
import type { Exam } from "./swarm.ts";

export const DEFAULT_CASES = ["Vercel", "Stripe", "Supabase"];

// Dry-run students per heat, as indices into DRY_PROFILES (cycled for more heats / students):
//   heat 1: pass (3 sources), missing source URLs, pass (2 own-domain sources, 1-sentence summary)
//   heat 2: the teacher in disguise, a crash, a bad website  -> nobody certified, no finalist
//   heat 3: pass (4 sources), pass (2 own-domain sources), leaked source artifact
//   heat 4: pass, timeout, pass;  heat 5: missing sources, pass (4 sources), the teacher
export const DRY_HEAT_PLANS = [[0, 1, 5], [3, 4, 7], [8, 2, 6], [2, 9, 0], [1, 8, 3]];

export const dryProfilesForHeat = (heat: number) => DRY_HEAT_PLANS[(heat - 1) % DRY_HEAT_PLANS.length].map((k) => DRY_PROFILES[k]);

/** A --cases entry (company name or case id) -> the case's company name. */
export function resolveCase(entry: string, cases: Case[]): string {
  const e = entry.trim().toLowerCase();
  const c = cases.find((c) => c.role === "exam" && (c.id.toLowerCase() === e || c.company.toLowerCase() === e));
  if (!c) throw new Error(`${entry} is not an exam case in demo/cases.json`);
  return c.company;
}

export async function main(argv = process.argv.slice(2)): Promise<{ code: number; summary?: TournamentSummary }> {
  const { values: a } = parseArgs({
    args: argv,
    options: {
      cases: { type: "string" },
      heats: { type: "string", default: "3" },
      "per-heat": { type: "string", default: "3" },
      "max-parallel": { type: "string", default: "9" },
      timeout: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "live-judge": { type: "boolean", default: false },
      "no-judge": { type: "boolean", default: false },
      "registry-dir": { type: "string" },
      "out-dir": { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (a.help) {
    console.log("usage: node scripts/tournament.ts [--cases A,B,C] [--heats 3] [--per-heat 3] [--dry-run] [--live-judge]\n" +
      "                                  [--no-judge] [--registry-dir DIR] [--out-dir DIR] [--json] [--timeout SECS] [--max-parallel 9]");
    return { code: 0 };
  }
  const heats = Number(a.heats);
  const perHeat = Number(a["per-heat"]);
  const maxParallel = Number(a["max-parallel"]);
  for (const [k, v] of [["--heats", heats], ["--per-heat", perHeat], ["--max-parallel", maxParallel]] as const)
    if (!Number.isInteger(v) || v < 1) throw new Error(`${k} must be a positive integer`);
  const dry = a["dry-run"];
  const cases = loadCases();
  const companies = (a.cases ? a.cases.split(",").filter((x) => x.trim()) : DEFAULT_CASES).map((c) => resolveCase(c, cases));

  if (a["registry-dir"]) registry.setRegistryDir(a["registry-dir"]);
  else if (dry) registry.setRegistryDir(mkdtempSync(join(tmpdir(), "au-tournament-registry-")));

  const judge: JudgeFn | null = a["no-judge"] ? null
    : dry && !a["live-judge"] ? withFinalPrompt(fixtureJudge) : makeFinalJudge();
  const tournamentId = newTournamentId().replace("tournament-", dry ? "tournament-dry-" : "tournament-");
  const log = a.json ? console.error : console.log;

  const specs: HeatSpec[] = [];
  for (let h = 1; h <= heats; h++) {
    const company = caseForHeat(companies, h);
    const swarmId = `${tournamentId}-h${h}`;
    let exam: Exam;
    if (dry) exam = new DryExam(company, swarmId, undefined, dryProfilesForHeat(h));
    else {
      const live = new LiveExam(company, swarmId);
      await live.setup(perHeat); // sequential: each setup signs in, recalls and leak-checks
      exam = live;
    }
    specs.push({ heat: h, examCase: exam.examCase, skill: exam.skill(), launch: (i, signal) => exam.launch(i, signal),
      studentFor: (i) => exam.student(i), swarmId });
  }
  log(`tournament ${tournamentId}: ${heats} heats x ${perHeat} students (${specs.map((s) => s.examCase).join(", ")}), ` +
    `max ${maxParallel} students in flight${dry ? " [dry run]" : ""}\nregistry: ${registry.registryDir()}\n` +
    `final judge: ${judge ? judge.model : "off (--no-judge)"}\n`);

  const t = await runTournament(specs, perHeat, {
    judge, maxParallel, tournamentId, cases, timeoutMs: a.timeout ? Number(a.timeout) * 1000 : undefined });
  const path = saveTournament(t, a["out-dir"]);
  if (a.json) {
    const { records: _r, ...lean } = t;
    console.log(JSON.stringify(lean, null, 2));
  } else console.log(tournamentReport(t));
  log(`\nsummary: ${path}\nledger:  ${join(registry.registryDir(), "ledger.jsonl")}`);
  return { code: t.champion ? 0 : 1, summary: t };
}

if (import.meta.main) {
  main().then(({ code }) => process.exit(code), (e) => {
    console.error(`tournament: ${(e as Error).message ?? e}`);
    process.exit(2);
  });
}
