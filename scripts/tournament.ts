#!/usr/bin/env node
// Flow tournament CLI: which Memorable flow (procedure) should the organization trust?
//
//   node scripts/tournament.ts [--flows 3] [--per-flow 3] [--procedures id1,id2,...] [--cases Vercel,Stripe,Supabase]
//        [--dry-run] [--live-judge] [--no-judge] [--registry-dir DIR] [--out-dir DIR] [--json]
//        [--timeout SECS] [--max-parallel 9]
//   (--heats and --per-heat are accepted as aliases of --flows and --per-flow)
//
// Candidates: live, the top K flows of native `memorable recall` (no --single) for the research
// task, each rendered with `memorable show`; --procedures overrides recall with given ids. Dry,
// the fixture flows in demo/fixtures/flows/*.md. A flow whose text leaks the teacher's answer is
// rejected before the tournament.
// Heat k = flow k: its M students each take a different exam case (cycling --cases), each given
// only that flow. A flow advances when >= 50% of its runs are certified; Jev (or the fixture judge
// in dry runs) picks among the advancing flows; the champion flow's best run becomes canonical and
// the registry index points at the flow. --max-parallel caps students in flight across all heats.
// --dry-run: no QM, Docker or Memorable, and a temp registry unless --registry-dir.

import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { CandidateSkill, Case } from "../lib/certification.ts";
import { loadCases } from "../lib/certification.ts";
import { flowTitle, leakTerms, recallMany, show } from "../lib/memorable.ts";
import { RECORD_DIR, ROOT } from "../lib/qm.ts";
import * as registry from "../lib/registry.ts";
import type { LaunchStudent } from "../lib/swarm.ts";
import { caseForStudent, fixtureFlowJudge, makeFlowJudge, newTournamentId, runTournament, saveTournament, screenFlows,
  tournamentReport } from "../lib/tournament.ts";
import type { Flow, FlowJudgeFn, HeatSpec, TournamentSummary } from "../lib/tournament.ts";
import { DRY_PROFILES, DryExam, drySkill, examCaseFor, liveContext, LiveExam } from "./swarm.ts";
import type { Exam } from "./swarm.ts";

export const DEFAULT_CASES = ["Vercel", "Stripe", "Supabase"];
const FLOWS_DIR = join(ROOT, "demo", "fixtures", "flows");

/** The generic recall task (any company), as memorable_capture.py stored it. */
export const FLOW_TASK = "Research a company from real public web sources and write a validated " +
  "$HOME/workspace/scout/<slug>/company.json with company_name, website, product_summary and source_urls";

type Profile = (typeof DRY_PROFILES)[number];
// Dry-run students per fixture flow (student i uses profile i, cycling):
//   A solid:      every student passes, cheaply
//   B sloppy:     skips collecting sources, so most runs fail source_urls_min_two (1/3: does not advance)
//   C exhaustive: every student passes, but slower and costlier
export const DRY_FLOW_PLANS: Record<string, Profile[]> = {
  "procedures/0000aaaa-research-a-company-fixture": [
    ["pass", 11, 5, 139.6, 0.301, "full4", 2], ["pass", 12, 5, 150.2, 0.310, "std3", 2], ["pass", 11, 5, 144.0, 0.305, "full4", 2]],
  "procedures/0000bbbb-research-a-company-quick-fixture": [
    ["no_sources", 8, 4, 110.0, 0.210, "std3", 2], ["pass", 9, 4, 120.0, 0.220, "own2", 1], ["no_sources", 8, 4, 115.0, 0.200, "std3", 2]],
  "procedures/0000cccc-research-a-company-exhaustive-fixture": [
    ["pass", 19, 9, 262.0, 0.610, "std3", 2], ["pass", 21, 9, 281.0, 0.660, "full4", 2], ["pass", 20, 9, 270.5, 0.640, "std3", 2]],
};

/** The fixture flows, in file order: `<!-- procedureId: ... -->` then Markdown. */
export function fixtureFlows(): Flow[] {
  return readdirSync(FLOWS_DIR).filter((f) => f.endsWith(".md")).sort().map((f, k) => {
    const raw = readFileSync(join(FLOWS_DIR, f), "utf8");
    const m = /<!--\s*procedureId:\s*(\S+)\s*-->/.exec(raw);
    if (!m) throw new Error(`${f} has no <!-- procedureId: ... --> line`);
    const text = raw.replace(m[0], "").trim();
    return { procedureId: m[1], title: flowTitle(m[1], text), source: "fixture" as const, rank: k + 1, text };
  });
}

/** Dry runs have no live teacher sandbox: leak-check against the fixture answer (demo/fixtures/company.json). */
export const dryLeakTerms = () => leakTerms(JSON.parse(readFileSync(join(ROOT, "demo", "fixtures", "company.json"), "utf8")));

/** A --cases entry (company name or case id) -> the case's company name. */
export function resolveCase(entry: string, cases: Case[]): string {
  const e = entry.trim().toLowerCase();
  const c = cases.find((c) => c.role === "exam" && (c.id.toLowerCase() === e || c.company.toLowerCase() === e));
  if (!c) throw new Error(`${entry} is not an exam case in demo/cases.json`);
  return c.company;
}

export interface BuildOptions {
  dry: boolean;
  flows: number; // K candidates
  perFlow: number; // M students per flow
  companies: string[]; // exam companies, cycled over each flow's students
  procedures?: string[]; // given procedure ids instead of recall / all fixtures
  tournamentId: string;
  cases: Case[];
  wrap?: (launch: LaunchStudent) => LaunchStudent; // e.g. pacing for the website
  log?: (msg: string) => void;
}

/** Pick the candidate flows, screen them for leaks, and build one heat per accepted flow. */
export async function buildFlowHeats(o: BuildOptions): Promise<{ specs: HeatSpec[]; rejected: { procedureId: string; title: string; reason: string }[] }> {
  const log = o.log ?? (() => {});
  let candidates: Flow[];
  let terms: string[];
  let ctx: Awaited<ReturnType<typeof liveContext>> | null = null;
  if (o.dry) {
    const all = fixtureFlows();
    candidates = o.procedures?.length
      ? o.procedures.map((id) => {
        const f = all.find((x) => x.procedureId === id);
        if (!f) throw new Error(`${id} is not a fixture flow (${all.map((x) => x.procedureId).join(", ")})`);
        return { ...f, source: "given" as const, rank: null };
      })
      : all.slice(0, o.flows);
    if (!o.procedures?.length && o.flows > all.length) log(`only ${all.length} fixture flows exist; running ${all.length}`);
    terms = dryLeakTerms();
  } else {
    ctx = await liveContext();
    terms = ctx.terms;
    let ids: string[];
    let source: Flow["source"];
    if (o.procedures?.length) {
      ids = o.procedures;
      source = "given";
    } else {
      const recalled = await recallMany(FLOW_TASK, o.flows);
      log(`--- memorable recall (top ${o.flows}) ---\n${recalled.output}`);
      ids = recalled.procedureIds;
      source = "recall";
    }
    candidates = [];
    for (const [k, id] of ids.entries()) {
      const text = await show(id);
      candidates.push({ procedureId: id, title: flowTitle(id, text), source, rank: source === "recall" ? k + 1 : null, text });
    }
  }
  const { accepted, rejected } = screenFlows(candidates, terms);
  for (const r of rejected) log(`rejected ${r.procedureId}: ${r.reason}`);

  const examCases = o.companies.map((c) => examCaseFor(c, o.cases, o.dry));
  const specs: HeatSpec[] = [];
  for (const [k, flow] of accepted.entries()) {
    const heat = k + 1;
    const swarmId = `${o.tournamentId}-h${heat}`;
    const byCase = new Map<string, Exam>();
    let skill: CandidateSkill;
    const needed = [...new Set(Array.from({ length: o.perFlow }, (_, j) => caseForStudent(examCases, j + 1)))];
    if (o.dry) {
      skill = { ...drySkill(), procedureId: flow.procedureId };
      const profiles = DRY_FLOW_PLANS[flow.procedureId] ?? [DRY_PROFILES[0]];
      for (const c of needed) byCase.set(c, new DryExam(o.cases.find((x) => x.id === c)!.company, swarmId, skill, profiles));
    } else {
      for (const c of needed) {
        const live = new LiveExam(o.cases.find((x) => x.id === c)!.company, swarmId, { ctx: ctx!, procedure: { procedureId: flow.procedureId, text: flow.text } });
        await live.setup(o.perFlow); // builds and leak-checks this company's prompt
        byCase.set(c, live);
      }
      skill = byCase.get(needed[0])!.skill();
    }
    const examOf = (i: number) => byCase.get(caseForStudent(examCases, i))!;
    const launch: LaunchStudent = (i, signal) => examOf(i).launch(i, signal);
    specs.push({ heat, flow, skill, examCases, swarmId, studentFor: (i) => examOf(i).student(i), launch: o.wrap ? o.wrap(launch) : launch });
  }
  return { specs, rejected };
}

export async function main(argv = process.argv.slice(2)): Promise<{ code: number; summary?: TournamentSummary }> {
  const { values: a } = parseArgs({
    args: argv,
    options: {
      flows: { type: "string" },
      heats: { type: "string" },
      "per-flow": { type: "string" },
      "per-heat": { type: "string" },
      procedures: { type: "string" },
      cases: { type: "string" },
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
    console.log("usage: node scripts/tournament.ts [--flows 3] [--per-flow 3] [--procedures id1,id2] [--cases A,B,C] [--dry-run]\n" +
      "         [--live-judge] [--no-judge] [--registry-dir DIR] [--out-dir DIR] [--json] [--timeout SECS] [--max-parallel 9]");
    return { code: 0 };
  }
  const flows = Number(a.flows ?? a.heats ?? 3);
  const perFlow = Number(a["per-flow"] ?? a["per-heat"] ?? 3);
  const maxParallel = Number(a["max-parallel"]);
  for (const [k, v] of [["--flows", flows], ["--per-flow", perFlow], ["--max-parallel", maxParallel]] as const)
    if (!Number.isInteger(v) || v < 1) throw new Error(`${k} must be a positive integer`);
  const dry = a["dry-run"];
  const cases = loadCases();
  const companies = (a.cases ? a.cases.split(",").filter((x) => x.trim()) : DEFAULT_CASES).map((c) => resolveCase(c, cases));
  const procedures = a.procedures?.split(",").map((x) => x.trim()).filter(Boolean);
  const log = a.json ? console.error : console.log;

  if (a["registry-dir"]) registry.setRegistryDir(a["registry-dir"]);
  else if (dry) registry.setRegistryDir(mkdtempSync(join(tmpdir(), "au-tournament-registry-")));

  const judge: FlowJudgeFn | null = a["no-judge"] ? null : dry && !a["live-judge"] ? fixtureFlowJudge : makeFlowJudge();
  const tournamentId = newTournamentId().replace("tournament-", dry ? "tournament-dry-" : "tournament-");
  const { specs, rejected } = await buildFlowHeats({ dry, flows, perFlow, companies, procedures, tournamentId, cases, log });
  if (!specs.length) throw new Error("no candidate flow survived screening");
  log(`tournament ${tournamentId}: ${specs.length} flow(s) x ${perFlow} students on ${companies.join(", ")}, ` +
    `max ${maxParallel} students in flight${dry ? " [dry run]" : ""}\nregistry: ${registry.registryDir()}\n` +
    `final judge: ${judge ? judge.model : "off (--no-judge)"}\n`);

  const t = await runTournament(specs, perFlow, {
    // The UI shows the canonical artifact from .agent-university/artifacts; a throwaway dry-run
    // registry must not overwrite it.
    artifactsDir: dry && !a["registry-dir"] ? undefined : join(RECORD_DIR, "artifacts"),
    judge, maxParallel, tournamentId, cases, rejected, dry, timeoutMs: a.timeout ? Number(a.timeout) * 1000 : undefined });
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
