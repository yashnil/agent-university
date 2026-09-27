// Server-side registry of Arena tournament jobs. Kept on globalThis so it survives Next dev hot
// reloads (module re-evaluation would otherwise orphan a running tournament and its subscribers).
// The runner import lives here only, so swapping the implementation is a one-line change.

import { runArena } from "@/lib/arena.ts";
import type { ArenaEvent, ArenaMode, ArenaOptions } from "@/lib/arena.ts";

export type { ArenaEvent, ArenaMode, ArenaOptions };

export interface ArenaJob {
  id: string;
  mode: ArenaMode;
  options: ArenaOptions;
  startedAt: string;
  done: boolean;
  events: ArenaEvent[];
  subscribers: Set<(e: ArenaEvent) => void>;
}

interface Registry {
  jobs: Map<string, ArenaJob>;
  current: string | null;
}

const KEY = Symbol.for("agent-university.arena.jobs");
const g = globalThis as unknown as Record<symbol, Registry | undefined>;
const reg: Registry = (g[KEY] ??= { jobs: new Map(), current: null });

export const isTerminal = (e: ArenaEvent) => e.type === "tournament.finished" || e.type === "error";

export function currentJob(): ArenaJob | null {
  const job = reg.current ? reg.jobs.get(reg.current) : undefined;
  return job && !job.done ? job : null;
}

export const getJob = (id: string) => reg.jobs.get(id) ?? null;

export const listJobs = () =>
  [...reg.jobs.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map(({ id, mode, startedAt, done }) => ({ id, mode, startedAt, done }));

/** Starts a job, or returns the running one when another tournament is in flight. */
export function startJob(options: ArenaOptions): { job: ArenaJob; conflict: boolean } {
  const running = currentJob();
  if (running) return { job: running, conflict: true };
  const job: ArenaJob = {
    id: crypto.randomUUID(),
    mode: options.mode,
    options,
    startedAt: new Date().toISOString(),
    done: false,
    events: [],
    subscribers: new Set(),
  };
  reg.jobs.set(job.id, job);
  reg.current = job.id;
  // Keep memory bounded: only the 20 most recent jobs are retained.
  for (const old of [...reg.jobs.keys()].slice(0, Math.max(0, reg.jobs.size - 20))) reg.jobs.delete(old);

  const emit = (e: ArenaEvent) => {
    if (job.done) return;
    job.events.push(e);
    if (isTerminal(e)) job.done = true;
    for (const fn of job.subscribers) {
      try {
        fn(e);
      } catch {
        /* a broken subscriber must not stop the tournament */
      }
    }
  };
  void runArena(options, emit)
    .catch((err: unknown) => emit({ type: "error", at: new Date().toISOString(), message: err instanceof Error ? err.message : String(err) }))
    .finally(() => {
      if (!job.done) emit({ type: "error", at: new Date().toISOString(), message: "tournament ended without a result" });
      if (reg.current === job.id) reg.current = null;
    });
  return { job, conflict: false };
}
