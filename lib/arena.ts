// Arena: run a tournament for the website and stream its progress.
//
// Same pipeline as `node scripts/tournament.ts`: heats of fresh students take unseen exams, the
// deterministic engine certifies each one, heat winners meet in a Jev final, the champion is
// promoted. `onEvent` receives ArenaEvents in order; runArena never throws (a failure arrives as
// an `error` event).
//
// dry:  fixture students, paced so a human can watch, fixture judge (or Jev with liveJudge), and
//       a throwaway registry, so the committed registry and the live page are never touched.
// live: real QM students (needs QM, Docker, Memorable and keys), the Jev final, the company
//       registry, and the champion's artifact published for the lifecycle page.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCases } from "./certification.ts";
import { fixtureJudge } from "./jev.ts";
import type { JudgeFn } from "./jev.ts";
import { RECORD_DIR } from "./qm.ts";
import * as registry from "./registry.ts";
import { emit } from "./swarm.ts";
import type { ArenaEvent, LaunchStudent } from "./swarm.ts";
import { caseForHeat, makeFinalJudge, newTournamentId, runTournament, withFinalPrompt } from "./tournament.ts";
import type { HeatSpec } from "./tournament.ts";
import { DryExam, LiveExam } from "../scripts/swarm.ts";
import type { Exam } from "../scripts/swarm.ts";
import { DEFAULT_CASES, dryProfilesForHeat, resolveCase } from "../scripts/tournament.ts";

export type { ArenaEvent } from "./swarm.ts";
export type ArenaMode = "dry" | "live";

export interface ArenaOptions {
  mode: ArenaMode;
  heats?: number; // default 3
  perHeat?: number; // default 3
  cases?: string[]; // company names or case ids, cycled over heats (default Vercel, Stripe, Supabase)
  paceMs?: number; // dry only: wall-clock ms per simulated minute of agent work (default 1500)
  liveJudge?: boolean; // dry only: call the real Jev for the final instead of the fixture judge
  timeoutSecs?: number; // live only: per student (default 900)
}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}

/** Dry students answer instantly; make each take time proportional to its simulated duration. */
function paced(launch: LaunchStudent, paceMs: number): LaunchStudent {
  return async (i, signal) => {
    const t0 = Date.now();
    try {
      const out = await launch(i, signal);
      const simulated = out.metrics?.durationMs ?? 0;
      await sleep(Math.max(simulated ? (simulated / 60000) * paceMs : 1200 + 400 * i, 400) - (Date.now() - t0), signal);
      return out;
    } catch (e) {
      await sleep(Math.max(900 + 300 * i - (Date.now() - t0), 0), signal).catch(() => {});
      throw e;
    }
  };
}

export async function runArena(opts: ArenaOptions, onEvent: (e: ArenaEvent) => void): Promise<void> {
  const dry = opts.mode !== "live";
  const heats = Math.min(Math.max(opts.heats ?? 3, 1), 5);
  const perHeat = Math.min(Math.max(opts.perHeat ?? 3, 1), 5);
  const before = registry.registryDir();
  try {
    const cases = loadCases();
    const companies = (opts.cases?.length ? opts.cases : DEFAULT_CASES).map((c) => resolveCase(c, cases));
    const tournamentId = newTournamentId().replace("tournament-", dry ? "tournament-dry-" : "tournament-");
    const judge: JudgeFn = dry && !opts.liveJudge ? withFinalPrompt(fixtureJudge) : makeFinalJudge();

    const specs: HeatSpec[] = [];
    for (let h = 1; h <= heats; h++) {
      const company = caseForHeat(companies, h);
      const swarmId = `${tournamentId}-h${h}`;
      let exam: Exam;
      if (dry) exam = new DryExam(company, swarmId, undefined, dryProfilesForHeat(h));
      else {
        const live = new LiveExam(company, swarmId);
        await live.setup(perHeat); // signs in, recalls the procedure and leak-checks it
        exam = live;
      }
      const launch: LaunchStudent = (i, signal) => exam.launch(i, signal);
      specs.push({ heat: h, examCase: exam.examCase, skill: exam.skill(), swarmId, studentFor: (i) => exam.student(i),
        launch: dry ? paced(launch, opts.paceMs ?? 1500) : launch });
    }

    if (dry) registry.setRegistryDir(mkdtempSync(join(tmpdir(), "au-arena-registry-")));
    await runTournament(specs, perHeat, {
      judge, tournamentId, cases, dry, onEvent, maxParallel: heats * perHeat,
      timeoutMs: dry ? undefined : (opts.timeoutSecs ?? 900) * 1000,
      artifactsDir: dry ? undefined : join(RECORD_DIR, "artifacts"),
    });
  } catch (e) {
    emit(onEvent, { type: "error", at: now(), message: (e as Error)?.message ?? String(e) });
  } finally {
    registry.setRegistryDir(before);
  }
}
