// Arena: run a tournament for the website and stream its progress.
//
// Same pipeline as `node scripts/tournament.ts`: each candidate Memorable flow is handed to fresh
// students on different unseen exams, the deterministic engine certifies each run, flows that pass
// the bar meet in a Jev final, and the champion flow's best run is promoted. `onEvent` receives ArenaEvents in order; runArena never throws (a failure arrives as
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
import { RECORD_DIR } from "./qm.ts";
import * as registry from "./registry.ts";
import { emit } from "./swarm.ts";
import type { ArenaEvent, LaunchStudent } from "./swarm.ts";
import { fixtureFlowJudge, makeFlowJudge, newTournamentId, runTournament } from "./tournament.ts";
import type { FlowJudgeFn } from "./tournament.ts";
import { buildFlowHeats, DEFAULT_CASES, resolveCase } from "../scripts/tournament.ts";

export type { ArenaEvent } from "./swarm.ts";
export type ArenaMode = "dry" | "live";

export interface ArenaOptions {
  mode: ArenaMode;
  flows?: number; // candidate Memorable flows, default 3 (alias: heats)
  perFlow?: number; // students per flow, default 3 (alias: perHeat)
  procedures?: string[]; // given procedure ids instead of recall (dry: fixture flow ids)
  heats?: number; // alias of flows
  perHeat?: number; // alias of perFlow
  cases?: string[]; // company names or case ids, cycled over each flow's students (default Vercel, Stripe, Supabase)
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

/** Live exams require the teacher's layer skill to be hidden from students (docs/HANDOFF.md).
 *  Move it out of sandbox/skills and sync the QM layer; returns a function that puts it back. */
async function hideLayerSkill(): Promise<() => Promise<void>> {
  const { existsSync, mkdirSync, renameSync } = await import("node:fs");
  const { execFile } = await import("node:child_process");
  const root = join(RECORD_DIR, "..");
  const live = join(root, "sandbox", "skills", "scout-research-company");
  const hidden = join(RECORD_DIR, "hidden-skills", "scout-research-company");
  const sync = () => new Promise<void>((resolve, reject) =>
    execFile("npm", ["exec", "--silent", "qm", "--", "layer", "sync"], { cwd: root, timeout: 180_000 },
      (err) => (err ? reject(new Error(`qm layer sync failed: ${err.message}`)) : resolve())));
  if (!existsSync(live)) return async () => {};
  mkdirSync(join(RECORD_DIR, "hidden-skills"), { recursive: true });
  renameSync(live, hidden);
  try {
    await sync();
  } catch (e) {
    renameSync(hidden, live);
    throw e;
  }
  return async () => {
    if (existsSync(hidden) && !existsSync(live)) renameSync(hidden, live);
    await sync().catch(() => {});
  };
}

export async function runArena(opts: ArenaOptions, onEvent: (e: ArenaEvent) => void): Promise<void> {
  const dry = opts.mode !== "live";
  const flows = Math.min(Math.max(opts.flows ?? opts.heats ?? 3, 1), 5);
  const perFlow = Math.min(Math.max(opts.perFlow ?? opts.perHeat ?? 3, 1), 5);
  const before = registry.registryDir();
  let restoreSkill: (() => Promise<void>) | null = null;
  try {
    if (!dry) restoreSkill = await hideLayerSkill();
    const cases = loadCases();
    const companies = (opts.cases?.length ? opts.cases : DEFAULT_CASES).map((c) => resolveCase(c, cases));
    const tournamentId = newTournamentId().replace("tournament-", dry ? "tournament-dry-" : "tournament-");
    const judge: FlowJudgeFn = dry && !opts.liveJudge ? fixtureFlowJudge : makeFlowJudge();
    const { specs, rejected } = await buildFlowHeats({ dry, flows, perFlow, companies, procedures: opts.procedures,
      tournamentId, cases, wrap: dry ? (l) => paced(l, opts.paceMs ?? 1500) : undefined });
    if (!specs.length) throw new Error(`no candidate flow survived screening (${rejected.map((r) => `${r.procedureId}: ${r.reason}`).join("; ")})`);

    if (dry) registry.setRegistryDir(mkdtempSync(join(tmpdir(), "au-arena-registry-")));
    await runTournament(specs, perFlow, {
      judge, tournamentId, cases, dry, onEvent, rejected, maxParallel: specs.length * perFlow,
      timeoutMs: dry ? undefined : (opts.timeoutSecs ?? 900) * 1000,
      artifactsDir: dry ? undefined : join(RECORD_DIR, "artifacts"),
    });
  } catch (e) {
    emit(onEvent, { type: "error", at: now(), message: (e as Error)?.message ?? String(e) });
  } finally {
    registry.setRegistryDir(before);
    if (restoreSkill) await restoreSkill();
  }
}
