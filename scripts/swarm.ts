#!/usr/bin/env node
// Swarm exam CLI: N fresh, isolated QM students take the same unseen exam; one success is not enough.
//
//   node scripts/swarm.ts Vercel [-n 10] [--max-parallel 10] [--timeout SECS] [--dry-run]
//                         [--live-judge] [--no-judge] [--registry-dir DIR] [--out-dir DIR] [--json]
//
// Live: each student is a fresh QM agent (new QM project -> own scope, sandbox and home volume;
// new threadRef -> own session and AgentIdentity "Freshman #<i>") given only the procedure that
// native `memorable recall` + `memorable show` returns, exactly like scripts/transfer_run.py.
// Every outcome is certified by the deterministic engine (lib/certification.ts); the Jev judge
// (lib/jev.ts, OpenRouter typesafe/jev-router) only orders the certified ones; every decision
// goes to the registry ledger and the winner is recorded last (lib/swarm.ts).
//
// --dry-run: no QM, Docker or Memorable. Fabricated students from demo/fixtures (passes of varying
// quality, missing source URLs, a bad website, a student that is secretly the teacher, broken
// isolation, a crash, a timeout), the offline fixture judge unless --live-judge, and a temp
// registry unless --registry-dir. The summary goes to .agent-university/swarms/<swarmId>.json.

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { CandidateSkill, Case } from "../lib/certification.ts";
import { loadCases } from "../lib/certification.ts";
import { fixtureJudge, makeJevJudge } from "../lib/jev.ts";
import type { JudgeFn } from "../lib/jev.ts";
import { leakTerms, leaks, recall, show } from "../lib/memorable.ts";
import * as qm from "../lib/qm.ts";
import * as registry from "../lib/registry.ts";
import { leaderboardTable, newSwarmId, runMetrics, runSwarm, saveSummary } from "../lib/swarm.ts";
import type { StudentOutcome, SwarmSummary } from "../lib/swarm.ts";
import type { AgentIdentity, TransferResult, VerificationResult } from "../lib/types.ts";

const FIXTURES = join(qm.ROOT, "demo", "fixtures");
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

export interface Exam {
  examCase: string;
  skill(): CandidateSkill;
  student(i: number): AgentIdentity;
  launch(i: number, signal: AbortSignal): Promise<StudentOutcome>;
}

export function examCaseFor(company: string, cases: Case[], allowFixtureOnly: boolean): string {
  const c = cases.find((c) => c.role === "exam" && c.company.toLowerCase() === company.toLowerCase()
    && (allowFixtureOnly || !c.fixtureOnly));
  if (!c) throw new Error(`${company} is not an exam case in demo/cases.json`);
  return c.id;
}

// ------------------------------------------------------------------ live (QM + Memorable)

export class LiveExam implements Exam {
  examCase = "";
  private rec: any;
  private source: any;
  private session!: qm.Session;
  private skills: string[] = [];
  private procedureId = "";
  private prompt = "";
  private terms: string[] = [];
  private threadRefs = new Map<number, string>();
  private slug: string;
  private company: string;
  private swarmId: string;

  constructor(company: string, swarmId: string) {
    this.company = company;
    this.slug = qm.slugify(company);
    this.swarmId = swarmId;
  }

  /** Once per swarm, mirroring transfer_run.main(): every guard must hold before any student starts. */
  async setup(n: number) {
    const path = join(qm.RECORD_DIR, "skills", "research-company.json");
    try {
      this.rec = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new Error(`no skill record at ${path}; run memorable_capture.py first`);
    }
    if (!this.rec.status || !this.rec.procedureId) throw new Error("Research Company has no recalled procedure yet; run memorable_capture.py first");
    this.source = this.rec.runtime.source;
    this.examCase = examCaseFor(this.company, loadCases(), false);
    if (qm.slugify(this.source.company) === this.slug) throw new Error("the exam company must differ from the source company");
    const src = await qm.findAndVerify(`workspace/scout/${qm.slugify(this.source.company)}/company.json`, [this.source.container]);
    if (!src) throw new Error("source artifact is gone; cannot leak-check the student prompt");
    this.terms = leakTerms(JSON.parse(src.content));

    this.session = await qm.signIn();
    this.skills = await qm.publishedSkills(this.session);
    console.log(`published skills: ${this.skills.join(", ") || "none"}`);
    if (this.skills.includes(qm.LAYER_SKILL)) throw new Error(`${qm.LAYER_SKILL} is still published; hide it from the layer first`);

    const task = `Research the company "${this.company}" from real public web sources and write ` +
      `$HOME/workspace/scout/${this.slug}/company.json with company_name, website, product_summary and source_urls`;
    const recalled = await recall(task);
    this.procedureId = recalled.procedureId;
    const procedure = await show(this.procedureId);
    console.log(`--- memorable recall ---\n${recalled.output}\n--- memorable show ${this.procedureId} ---\n${procedure}`);
    this.prompt = `Research the company "${this.company}". Fetch real public sources with curl, write the artifact to ` +
      `$HOME/workspace/scout/${this.slug}/company.json as a JSON object with exactly these keys: ` +
      "company_name, website (http(s) URL), product_summary (2-3 sentences), and source_urls " +
      "(at least two distinct http(s) URLs you actually fetched). Validate it and reply with its absolute path.\n\n" +
      "Procedural memory retrieved from Memorable for this task (a previous successful run, " +
      "generalized; placeholders like <Company> stand for the current company):\n\n" + procedure;
    const leaked = leaks(this.prompt, this.terms);
    if (leaked.length) throw new Error(`prompt contains source-specific values ${JSON.stringify(leaked)}`);
    const user = qm.adminUser();
    // One fresh threadRef per student, fixed up front so a crashed student keeps its identity.
    for (let i = 1; i <= n; i++) this.threadRefs.set(i, `web:${user}:${crypto.randomUUID()}`);
  }

  skill() {
    return this.rec as CandidateSkill;
  }

  student(i: number) {
    return qm.agentIdentity(this.threadRefs.get(i) ?? `swarm:${this.swarmId}:${i}`, `Freshman #${i}`);
  }

  async launch(i: number, signal: AbortSignal): Promise<StudentOutcome> {
    const t0 = Date.now();
    const student = this.student(i);
    const threadRef = this.threadRefs.get(i)!;
    const project = await qm.createProject(this.session, `au-swarm-${this.slug}-${this.swarmId.slice(-6)}-${i}`);
    const runId = await qm.startTurn(this.session, { text: this.prompt, threadRef, scopeId: project.scope });
    console.log(`[Freshman #${i}] project ${project.id}  scope ${project.scope}  run ${runId}`);
    const run = await qm.poll(this.session, runId, { signal });
    qm.saveRun(runId, run);
    const wallMs = Date.now() - t0;
    const result = run.result ?? {};
    const names = await qm.sandboxesForScope(project.scope);
    const found = names.length ? await qm.findAndVerify(`workspace/scout/${this.slug}/company.json`, names) : null;
    const sourceInFresh = names.length
      ? await qm.findAndVerify(`workspace/scout/${qm.slugify(this.source.company)}/company.json`, names) : null;
    const isolation: Record<string, boolean> = {
      different_agent: student.id !== this.rec.teacher.id,
      different_session: result.sessionId != null && result.sessionId !== this.source.session_id,
      different_scope: !!found && found.scope !== this.source.scope,
      different_container: !!found && found.container !== this.source.container,
      different_home_volume: !!found && found.volume !== this.source.home_volume,
      different_thread_ref: threadRef !== this.source.thread_ref,
      layer_skill_unpublished: !this.skills.includes(qm.LAYER_SKILL),
      no_layer_skill_reads: qm.skillReads(run).length === 0,
      no_source_artifact_in_fresh_sandbox: sourceInFresh === null,
      no_source_answer_in_prompt: leaks(this.prompt, this.terms).length === 0,
    };
    let verification: VerificationResult;
    if (found) verification = found.verification;
    else verification = { passed: false, checks: [{ name: "file_exists", passed: false, message: "no artifact in the fresh sandbox" }] };
    if (run.status !== "done")
      verification = { passed: false, checks: [...verification.checks.filter((c) => c.name === "file_exists"),
        { name: "run_completed", passed: false, message: `run status ${run.status}: ${run.error ?? ""}`.trim() }] };
    const transfer: TransferResult = {
      skillId: this.rec.id, procedureId: this.procedureId, examCase: this.examCase, student, runId,
      artifact: { type: "company.json", path: found?.path ?? `$HOME/workspace/scout/${this.slug}/company.json` },
      verification, passed: verification.passed,
    };
    const tdir = join(qm.RECORD_DIR, "transfers");
    mkdirSync(tdir, { recursive: true });
    writeFileSync(join(tdir, `${runId}.json`), JSON.stringify(transfer, null, 2));
    return { transfer, metrics: runMetrics(run, wallMs), isolation, artifact: found?.content ?? null };
  }
}

// ------------------------------------------------------------------ dry run (offline, from fixtures)

export function drySkill(): CandidateSkill {
  const skill = fixture("skill-observed.json");
  skill.events = fixture("events.json").filter((e: any) => e.type === "skill.observed");
  return skill;
}

type Outcome = "pass" | "no_sources" | "is_teacher" | "crash" | "leaky" | "bad_website" | "timeout";
// Ten repeating profiles: outcome, toolCalls, turns, seconds, costUsd, source URL set, summary sentences.
export const DRY_PROFILES: [Outcome, number, number, number, number | null, "std3" | "own2" | "full4", 1 | 2][] = [
  ["pass", 14, 6, 182.4, 0.412, "std3", 2],
  ["no_sources", 9, 4, 121.0, 0.233, "std3", 2],
  ["pass", 11, 5, 150.2, 0.301, "own2", 2],
  ["is_teacher", 10, 5, 140.8, 0.275, "std3", 2],
  ["crash", 0, 0, 0, null, "std3", 2],
  ["pass", 11, 5, 139.6, 0.301, "own2", 1],
  ["leaky", 12, 5, 160.0, 0.330, "std3", 2],
  ["bad_website", 13, 6, 171.3, 0.366, "std3", 2],
  ["pass", 17, 8, 240.9, 0.522, "full4", 2],
  ["timeout", 0, 0, 0, null, "std3", 2],
];

export class DryExam implements Exam {
  examCase: string;
  private skillRec: CandidateSkill;
  private base: TransferResult;
  private company: any;
  private swarmId: string;
  private profiles: typeof DRY_PROFILES;

  /** profiles: the student profiles to cycle through (default DRY_PROFILES); tournaments vary them per heat. */
  constructor(company: string, swarmId: string, skill?: CandidateSkill, profiles: typeof DRY_PROFILES = DRY_PROFILES) {
    this.profiles = profiles;
    this.skillRec = skill ?? drySkill();
    this.examCase = examCaseFor(company, loadCases(), true);
    this.swarmId = swarmId;
    this.base = fixture("transfer-result.json");
    this.company = fixture("company.json");
  }

  skill() {
    return this.skillRec;
  }

  student(i: number) {
    return qm.agentIdentity(`dry-run:${this.swarmId}:${i}`, `Freshman #${i}`);
  }

  private artifact(kind: Outcome, sources: string, sentences: number): string {
    const a = structuredClone(this.company);
    const site = a.website;
    a.source_urls = sources === "own2" ? [site, `${site}/about`]
      : sources === "full4" ? [site, `${site}/about`, `${site}/pricing`, a.source_urls[2]] : a.source_urls;
    if (sentences === 1) a.product_summary = a.product_summary.split(/(?<=\.)\s+/)[0];
    if (kind === "no_sources") a.source_urls = [];
    if (kind === "bad_website") a.website = "northwind";
    return JSON.stringify(a, null, 2);
  }

  async launch(i: number): Promise<StudentOutcome> {
    const [kind, toolCalls, turns, secs, cost, sources, sentences] = this.profiles[(i - 1) % this.profiles.length];
    await new Promise((r) => setTimeout(r, 5 * (i % 3))); // a little real concurrency
    if (kind === "crash") throw new Error("sandbox container exited before the first turn");
    if (kind === "timeout") throw Object.assign(new Error(`run dry-${i} did not finish within 900s`), { name: "TimeoutError" });
    const t: TransferResult = structuredClone(this.base);
    t.examCase = this.examCase;
    t.runId = `run-dry-${this.swarmId.slice(-6)}-${String(i).padStart(2, "0")}`;
    t.procedureId = this.skillRec.procedureId ?? t.procedureId;
    t.student = kind === "is_teacher" ? { ...this.skillRec.teacher } : this.student(i);
    const broken = ({ no_sources: ["source_urls_min_two", "at least two valid source URLs (0 distinct valid)"],
      bad_website: ["website_valid_url", "website is not an http(s) URL"] } as Record<string, [string, string]>)[kind];
    if (broken) {
      for (const c of t.verification.checks) if (c.name === broken[0]) Object.assign(c, { passed: false, message: broken[1] });
      t.verification.passed = t.passed = false;
    }
    const isolation: Record<string, boolean> = Object.fromEntries(["different_scope", "different_container",
      "different_home_volume", "different_session", "different_thread_ref", "no_layer_skill_reads",
      "no_source_artifact_in_fresh_sandbox", "no_source_answer_in_prompt"].map((k) => [k, true]));
    isolation.different_agent = kind !== "is_teacher";
    if (kind === "leaky") isolation.no_source_artifact_in_fresh_sandbox = false;
    return {
      transfer: t,
      metrics: { durationMs: Math.round(secs * 1000), toolCalls, turns, ...(cost != null ? { costUsd: cost } : {}) },
      isolation,
      artifact: this.artifact(kind, sources, sentences),
    };
  }
}

// ------------------------------------------------------------------ CLI

export async function main(argv = process.argv.slice(2)): Promise<{ code: number; summary?: SwarmSummary }> {
  const { values: a, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      n: { type: "string", short: "n", default: "10" },
      "max-parallel": { type: "string", default: "10" },
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
    console.log("usage: node scripts/swarm.ts <Company> [-n 10] [--max-parallel 10] [--timeout SECS] [--dry-run]\n" +
      "                             [--live-judge] [--no-judge] [--registry-dir DIR] [--out-dir DIR] [--json]");
    return { code: 0 };
  }
  const company = positionals.join(" ") || "Vercel";
  const n = Number(a.n);
  if (!Number.isInteger(n) || n < 1) throw new Error("-n must be a positive integer");
  const dry = a["dry-run"];

  if (a["registry-dir"]) registry.setRegistryDir(a["registry-dir"]);
  else if (dry) registry.setRegistryDir(mkdtempSync(join(tmpdir(), "au-swarm-registry-")));

  const judge: JudgeFn | null = a["no-judge"] ? null : dry && !a["live-judge"] ? fixtureJudge : makeJevJudge();
  const swarmId = newSwarmId(`${dry ? "dry-" : ""}${qm.slugify(company)}`);
  let exam: Exam;
  if (dry) exam = new DryExam(company, swarmId);
  else {
    const live = new LiveExam(company, swarmId);
    await live.setup(n);
    exam = live;
  }
  const log = a.json ? console.error : console.log;
  log(`swarm ${swarmId}: ${n} fresh students on ${exam.examCase} (${company}), max ${a["max-parallel"]} in parallel` +
    `${dry ? " [dry run]" : ""}\nregistry: ${registry.registryDir()}\njudge: ${judge ? judge.model : "off (--no-judge)"}`);

  const s = await runSwarm(exam.skill(), n, (i, signal) => exam.launch(i, signal), {
    maxParallel: Number(a["max-parallel"]), examCase: exam.examCase, studentFor: (i) => exam.student(i), swarmId,
    timeoutMs: a.timeout ? Number(a.timeout) * 1000 : undefined, judge,
  });
  const path = saveSummary(s, a["out-dir"]);
  if (a.json) {
    const { records: _r, artifacts: _a, ...lean } = s;
    console.log(JSON.stringify(lean, null, 2));
  } else console.log("\n" + leaderboardTable(s));
  log(`\nsummary: ${path}\nledger:  ${join(registry.registryDir(), "ledger.jsonl")}`);
  return { code: s.winner?.certified ? 0 : 1, summary: s };
}

if (import.meta.main) {
  main().then(({ code }) => process.exit(code), (e) => {
    console.error(`swarm: ${(e as Error).message ?? e}`);
    process.exit(2);
  });
}
