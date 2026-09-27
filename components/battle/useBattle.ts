"use client";

// FLOW FIGHTER — the only impure piece: POST /api/battle, stream SSE ArenaEvents, choreograph them
// into FightActions, and play the queue at a steady (speed-adjustable) pace through the pure reducer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initialBattleState, reduce } from "@/lib/battle/reducer";
import { createChoreographer } from "@/lib/battle/choreo";
import { createSfx } from "@/lib/battle/sfx";
import type { ArenaEvent, BattleSpec, BattleState, FightAction } from "@/lib/battle/types";

type SfxKind = "hit" | "miss" | "special" | "ko" | "round" | "fight" | "win" | "select" | "judge";
type Sfx = { play(kind: SfxKind): void; setMuted(m: boolean): void };
type Choreo = { push(e: ArenaEvent): FightAction[]; flush(): FightAction[] };

export interface UseBattle {
  state: BattleState;
  start(prompt: string): Promise<void>;
  reset(): void;
  muted: boolean;
  setMuted(m: boolean): void;
  speed: number;
  setSpeed(x: number): void;
}

const MUTE_KEY = "flowfighter.muted";
const INTRO_HOLD_MS = 3500; // character select stays up at least this long before the first bout
const IDLE_BEFORE_WAITING_MS = 2500; // let the last banner breathe before the "waiting" lines kick in
const WAITING_EVERY_MS = 6000;
const MAX_RECONNECTS = 5;

const clampSpeed = (x: number) => (Number.isFinite(x) ? Math.min(3, Math.max(0.5, x)) : 1);

const isTerminal = (e: ArenaEvent) => e.type === "tournament.finished" || e.type === "error";

function eventKey(e: ArenaEvent): string {
  const r = e as { type: string; at: string; heat?: unknown; i?: unknown };
  return `${r.type}|${String(r.heat ?? "")}|${String(r.i ?? "")}|${r.at}`;
}

function sfxFor(a: FightAction): SfxKind | null {
  switch (a.kind) {
    case "intro":
      return "select";
    case "match_start":
      return "round";
    case "attack_hit":
      return a.move === "special" ? "special" : "hit";
    case "attack_miss":
      return "miss";
    case "time_up":
      return "round";
    case "judge":
      return "judge";
    case "ko":
      return "ko";
    case "victory":
      return "win";
    case "error":
      return "miss";
    default:
      return null;
  }
}

export function useBattle(): UseBattle {
  const [core, setCore] = useState<BattleState>(initialBattleState);
  const [waiting, setWaiting] = useState<{ text: string; sub?: string } | null>(null);
  const [idle, setIdle] = useState(true);
  const [muted, setMutedState] = useState(false);
  const [speed, setSpeedState] = useState(1);

  // Mutable run state (never read during render except through `core`/`waiting`).
  const stateRef = useRef<BattleState>(initialBattleState);
  const genRef = useRef(0); // bumps on start/reset/unmount: stale callbacks check it and bail
  const esRef = useRef<EventSource | null>(null);
  const choreoRef = useRef<Choreo | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const queueRef = useRef<FightAction[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extraTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const seenRef = useRef<Set<string>>(new Set());
  const terminalRef = useRef(false); // terminal ArenaEvent received (stream done)
  const introAtRef = useRef<number | null>(null);
  const idleSinceRef = useRef<number>(0);
  const lastWaitingAtRef = useRef<number>(0);
  const waitingIdxRef = useRef(0);
  const runsRef = useRef({ done: 0, total: 0, final: false });
  const speedRef = useRef(1);
  const mutedRef = useRef(false);
  const mountedRef = useRef(false);

  const commit = useCallback((s: BattleState) => {
    stateRef.current = s;
    if (mountedRef.current) setCore(s);
  }, []);

  const getSfx = useCallback((): Sfx | null => {
    if (typeof window === "undefined") return null;
    if (!sfxRef.current) {
      try {
        sfxRef.current = createSfx();
        sfxRef.current.setMuted(mutedRef.current);
      } catch {
        return null;
      }
    }
    return sfxRef.current;
  }, []);

  const play = useCallback(
    (kind: SfxKind) => {
      try {
        getSfx()?.play(kind);
      } catch {
        /* audio must never break the fight */
      }
    },
    [getSfx],
  );

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    for (const t of extraTimersRef.current) clearTimeout(t);
    extraTimersRef.current.clear();
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      extraTimersRef.current.delete(t);
      fn();
    }, ms);
    extraTimersRef.current.add(t);
  }, []);

  const closeStream = useCallback(() => {
    const es = esRef.current;
    esRef.current = null;
    if (es) {
      try {
        es.close();
      } catch {
        /* ignore */
      }
    }
  }, []);

  // ---------------------------------------------------------------- player loop
  const tick = useCallback(() => {
    timerRef.current = null;
    const gen = genRef.current;
    const q = queueRef.current;
    if (!q.length) {
      idleSinceRef.current = Date.now();
      lastWaitingAtRef.current = 0;
      if (mountedRef.current) setIdle(true);
      return;
    }
    const next = q[0];
    // Hold the character select screen before the first bout.
    if (next.kind === "match_start" && introAtRef.current !== null) {
      const left = INTRO_HOLD_MS - (Date.now() - introAtRef.current);
      if (left > 0) {
        timerRef.current = setTimeout(() => {
          if (genRef.current === gen) tick();
        }, left);
        return;
      }
    }
    q.shift();
    if (mountedRef.current) {
      setIdle(false);
      setWaiting(null);
    }
    let s: BattleState;
    try {
      s = reduce(stateRef.current, next);
    } catch {
      s = stateRef.current;
    }
    commit(s);
    if (next.kind === "intro") introAtRef.current = Date.now();
    else if (next.kind === "match_start") introAtRef.current = null;
    const kind = sfxFor(next);
    if (kind) play(kind);
    const dur = Math.max(0, Number(next.duration) || 0) / speedRef.current;
    if (next.kind === "match_start") {
      later(() => {
        if (genRef.current === gen) play("fight");
      }, dur * 0.55);
    }
    timerRef.current = setTimeout(() => {
      if (genRef.current === gen) tick();
    }, dur);
  }, [commit, later, play]);

  const enqueue = useCallback(
    (actions: FightAction[]) => {
      if (!actions.length) return;
      queueRef.current.push(...actions);
      if (!timerRef.current) tick();
    },
    [tick],
  );

  // ---------------------------------------------------------------- SSE
  const attach = useCallback(
    (id: string, gen: number, attempt = 0, streamUrl?: string) => {
      if (genRef.current !== gen || typeof EventSource === "undefined") return;
      closeStream();
      // streamUrl: /api/battle/stream runs the whole battle inside this one request (works on
      // serverless hosts). Otherwise attach to a job started by POST /api/battle.
      const es = new EventSource(streamUrl ?? `/api/arena/${encodeURIComponent(id)}`);
      esRef.current = es;
      if (streamUrl)
        es.addEventListener("spec", (msg) => {
          if (genRef.current !== gen) return;
          try {
            const spec = JSON.parse((msg as MessageEvent<string>).data) as BattleSpec;
            commit({ ...stateRef.current, spec, jobId: "stream", dry: spec.options.mode !== "live" });
          } catch {
            /* ignore a malformed spec; the fight still plays */
          }
        });
      es.addEventListener("arena", (msg) => {
        if (genRef.current !== gen) return;
        let e: ArenaEvent;
        try {
          e = JSON.parse((msg as MessageEvent<string>).data) as ArenaEvent;
        } catch {
          return;
        }
        const key = eventKey(e);
        if (seenRef.current.has(key)) return; // server replays everything on reconnect
        seenRef.current.add(key);
        if (e.type === "tournament.started") {
          let total = 0;
          for (const h of e.heats) total += h.students.length;
          runsRef.current.total = total;
        } else if (e.type === "student.finished") runsRef.current.done++;
        else if (e.type === "final.started") runsRef.current.final = true;
        const choreo = choreoRef.current;
        let out: FightAction[] = [];
        try {
          if (choreo) out = choreo.push(e);
        } catch {
          out = [];
        }
        enqueue(out);
        if (isTerminal(e)) {
          terminalRef.current = true;
          if (esRef.current === es) esRef.current = null;
          es.close();
          let rest: FightAction[] = [];
          try {
            if (choreo) rest = choreo.flush();
          } catch {
            rest = [];
          }
          enqueue(rest);
        }
      });
      es.onerror = () => {
        if (genRef.current !== gen || terminalRef.current) return;
        // A streamed battle cannot be resumed: reconnecting would start a new battle.
        if (streamUrl) es.close();
        if (es.readyState === EventSource.CLOSED) {
          if (esRef.current === es) esRef.current = null;
          if (!streamUrl && attempt < MAX_RECONNECTS) {
            later(() => attach(id, gen, attempt + 1), 3000);
          } else {
            terminalRef.current = true;
            let rest: FightAction[] = [];
            try {
              rest = choreoRef.current?.flush() ?? [];
            } catch {
              rest = [];
            }
            enqueue([
              ...rest,
              { seq: Number.MAX_SAFE_INTEGER, kind: "error", duration: 1500, label: "CONNECTION LOST", sub: "The tournament stream closed (the server may have restarted)." },
            ]);
          }
        }
        // readyState CONNECTING: the browser reconnects on its own; duplicates are dropped by key.
      };
    },
    [closeStream, commit, enqueue, later],
  );

  // ---------------------------------------------------------------- public API
  const hardReset = useCallback(() => {
    genRef.current++;
    closeStream();
    clearTimers();
    queueRef.current = [];
    seenRef.current = new Set();
    choreoRef.current = null;
    terminalRef.current = false;
    introAtRef.current = null;
    runsRef.current = { done: 0, total: 0, final: false };
    waitingIdxRef.current = 0;
    lastWaitingAtRef.current = 0;
    idleSinceRef.current = Date.now();
    commit(initialBattleState);
    if (mountedRef.current) {
      setWaiting(null);
      setIdle(true);
    }
  }, [clearTimers, closeStream, commit]);

  const reset = useCallback(() => hardReset(), [hardReset]);

  const start = useCallback(
    async (prompt: string) => {
      hardReset();
      const gen = genRef.current;
      getSfx(); // create the AudioContext inside the user gesture
      commit({ ...initialBattleState, phase: "starting" });
      choreoRef.current = createChoreographer();
      idleSinceRef.current = Date.now();
      attach("stream", gen, 0, `/api/battle/stream?prompt=${encodeURIComponent(prompt)}`);
    },
    [attach, commit, getSfx, hardReset, play],
  );

  const setMuted = useCallback(
    (m: boolean) => {
      mutedRef.current = m;
      setMutedState(m);
      try {
        sfxRef.current?.setMuted(m);
      } catch {
        /* ignore */
      }
      try {
        window.localStorage.setItem(MUTE_KEY, m ? "1" : "0");
      } catch {
        /* storage blocked */
      }
    },
    [],
  );

  const setSpeed = useCallback((x: number) => {
    const v = clampSpeed(x);
    speedRef.current = v;
    setSpeedState(v);
  }, []);

  // ---------------------------------------------------------------- lifecycle
  useEffect(() => {
    mountedRef.current = true;
    try {
      const m = window.localStorage.getItem(MUTE_KEY) === "1";
      mutedRef.current = m;
      setMutedState(m);
      sfxRef.current?.setMuted(m);
    } catch {
      /* storage blocked */
    }
    // StrictMode re-mount: resync render state from the refs.
    setCore(stateRef.current);
    return () => {
      mountedRef.current = false;
      genRef.current++;
      closeStream();
      clearTimers();
    };
  }, [clearTimers, closeStream]);

  // Waiting banner: while the queue is dry but the job is still running (live runs take minutes).
  const phase = core.phase;
  const jobId = core.jobId;
  useEffect(() => {
    const active = idle && jobId !== null && phase !== "victory" && phase !== "error" && phase !== "idle";
    if (!active) {
      setWaiting(null);
      return;
    }
    const iv = setInterval(() => {
      if (terminalRef.current && queueRef.current.length === 0) {
        setWaiting(null);
        return;
      }
      if (timerRef.current || queueRef.current.length) return;
      const now = Date.now();
      if (now - idleSinceRef.current < IDLE_BEFORE_WAITING_MS) return;
      if (lastWaitingAtRef.current && now - lastWaitingAtRef.current < WAITING_EVERY_MS) return;
      lastWaitingAtRef.current = now;
      const { done, total, final } = runsRef.current;
      const lines = final
        ? ["JEV IS DELIBERATING…", "JUDGES ARE SCORING…", `${done}/${total || "?"} RUNS IN`]
        : ["AGENTS ARE RESEARCHING…", total ? `${done}/${total} RUNS IN` : "WARMING UP THE ARENA…", "NEXT CHALLENGER LOADING…"];
      setWaiting({ text: lines[waitingIdxRef.current++ % lines.length], sub: total ? `${done}/${total} runs finished` : undefined });
    }, 500);
    return () => clearInterval(iv);
  }, [idle, jobId, phase]);

  const state = useMemo<BattleState>(() => {
    if (!waiting || !idle) return core;
    return { ...core, banner: { text: waiting.text, sub: waiting.sub, tone: "neutral" } };
  }, [core, waiting, idle]);

  return { state, start, reset, muted, setMuted, speed, setSpeed };
}

export default useBattle;
