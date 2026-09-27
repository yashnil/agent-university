"use client";

// FLOW FIGHTER — page shell. Composes every battle component from useBattle() state.
//   idle/starting  → attract-mode stage (two fixture fighters sparring) + PromptConsole
//   select         → CharacterSelect over the stage
//   fighting/judging → Stage + Fighters + Effects, HUD + Announcer overlaid (steady, not shaken)
//   victory        → Victory over the stage
//   always         → top bar (title, speed, mute, links) and the commentary Ticker

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import Stage from "@/components/battle/Stage";
import Fighter from "@/components/battle/Fighter";
import Effects from "@/components/battle/Effects";
import HUD from "@/components/battle/HUD";
import Announcer from "@/components/battle/Announcer";
import Ticker from "@/components/battle/Ticker";
import PromptConsole from "@/components/battle/PromptConsole";
import CharacterSelect from "@/components/battle/CharacterSelect";
import Victory from "@/components/battle/Victory";
import { useBattle } from "@/components/battle/useBattle";
import { avoidPaletteClash, distinctRoster, fixtureFighters } from "@/lib/battle/fighters";
import type { FightAction, FighterDef, FighterState, Pose, Side } from "@/lib/battle/types";
import styles from "./Battle.module.css";

const SPEEDS = [0.5, 1, 2, 3];

// Attract mode: a canned sparring loop so the idle screen is alive behind the console.
const ATTRACT: [Pose, Pose][] = [
  ["idle", "idle"],
  ["punch", "hurt"],
  ["idle", "idle"],
  ["hurt", "kick"],
  ["idle", "idle"],
  ["special", "block"],
  ["taunt", "idle"],
];

function useAttract(active: boolean): { step: number; action: FightAction } {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setStep((s) => s + 1), 1400);
    return () => clearInterval(iv);
  }, [active]);
  const action = useMemo<FightAction>(() => ({ seq: step + 1, kind: "announce", duration: 1400 }), [step]);
  return { step, action };
}

function onSide(fighters: Record<string, FighterState>, side: Side, fallbackId: string | undefined): FighterState | null {
  for (const id of Object.keys(fighters)) if (fighters[id].side === side) return fighters[id];
  return fallbackId && fighters[fallbackId] ? fighters[fallbackId] : null;
}

// Body motion layered on top of the Fighter's own pose animation, so blows visibly connect:
// the attacker dashes in to the defender, the defender is knocked back. A/B variants restart the
// CSS animation when the same fighter acts twice in a row (alternating by action.seq).
function motionFor(id: string, action: FightAction | null): string {
  if (!action) return styles.still;
  const ab = action.seq % 2 ? "A" : "B";
  const { kind, attacker, defender, move } = action;
  if (kind === "attack_hit") {
    if (attacker === id) return move === "special" ? styles[`cast${ab}`] : styles[`lunge${ab}`];
    if (defender === id) return move === "special" ? styles[`blast${ab}`] : styles[`recoil${ab}`];
  }
  if (kind === "attack_miss" && attacker === id) return styles[`whiff${ab}`];
  if (kind === "ko" && defender === id) return styles.knockdown;
  return styles.still;
}

function FighterSlot({
  f,
  def,
  side,
  action,
  pose,
}: {
  f: FighterState | null;
  def: FighterDef;
  side: Side;
  action: FightAction | null;
  pose: Pose;
}): JSX.Element {
  const motion = motionFor(def.id, action);
  return (
    <div className={`${styles.slot} ${side === "left" ? styles.slotLeft : styles.slotRight}`}>
      <div className={styles.walkIn}>
        <div className={motion} style={action ? ({ ["--act-ms" as string]: `${Math.max(420, Math.min(900, action.duration * 0.6))}ms` } as CSSProperties) : undefined}>
          <Fighter def={def} pose={pose} side={side} hp={f ? f.hp : 100} action={action} className={styles.fighter} />
        </div>
      </div>
    </div>
  );
}

export default function Battle(): JSX.Element {
  const { state, start, reset, muted, setMuted, speed, setSpeed } = useBattle();
  const { phase } = state;
  const attractMode = phase === "idle" || phase === "starting";
  const busy = phase !== "idle" && phase !== "error" && phase !== "victory";

  const fixtures = useMemo(() => fixtureFighters(), []);
  const attract = useAttract(attractMode);

  // ---- who is on stage
  const left = onSide(state.fighters, "left", state.current?.left);
  const rightRaw = onSide(state.fighters, "right", state.current?.right);
  const right = rightRaw && left && rightRaw.def.id === left.def.id ? null : rightRaw;
  const leftDef = left?.def ?? null;
  const rightDef = right ? avoidPaletteClash(right.def, leftDef) : null;

  const displayPose = (f: FighterState): Pose => {
    // "walk" only while the walk-in plays; afterwards stand in guard until the first blow.
    if (f.pose === "walk" && state.action?.kind !== "match_start") return "idle";
    return f.pose;
  };

  const matchKey = state.current ? `${state.current.round}:${state.current.left}:${state.current.right}` : "none";

  const sideOf = useCallback(
    (id: string): Side | null => {
      if (leftDef && id === leftDef.id) return "left";
      if (rightDef && id === rightDef.id) return "right";
      return state.fighters[id]?.side ?? null;
    },
    [leftDef, rightDef, state.fighters],
  );
  const auraOf = useCallback(
    (id: string): string | null => {
      if (rightDef && id === rightDef.id) return rightDef.palette.aura;
      return state.fighters[id]?.def.palette.aura ?? null;
    },
    [rightDef, state.fighters],
  );

  const selectRoster = useMemo(() => distinctRoster(state.order.map((id) => state.fighters[id]?.def).filter((d): d is FighterDef => !!d)), [state.order, state.fighters]);

  const round = state.current?.round ?? state.matches.length;
  const flowOf = (id: string): number | null => {
    const k = state.order.indexOf(id);
    return k >= 0 ? k + 1 : null;
  };
  const played = new Set(state.matches.flatMap((m) => [m.left, m.right]));
  if (state.current) {
    played.add(state.current.left);
    played.add(state.current.right);
  }
  const nextUp = state.order.find((id) => !played.has(id) && !state.fighters[id]?.eliminated) ?? null;
  const showFight = phase === "fighting" || phase === "judging" || phase === "victory" || (phase === "error" && !!left);

  // The prompt this tab typed: a 409 attach (another tab's run) has no spec, but REMATCH should
  // still replay what this viewer asked for rather than dumping them back at the console.
  const lastPrompt = useRef<string>("");
  const startPrompt = useCallback(
    (p: string) => {
      lastPrompt.current = p;
      void start(p);
    },
    [start],
  );
  const onRematch = useCallback(() => {
    const p = state.spec?.prompt || lastPrompt.current;
    if (p) void start(p);
    else reset();
  }, [reset, start, state.spec]);

  // ---- attract pair
  const [pA, pB] = ATTRACT[attract.step % ATTRACT.length];

  return (
    <div className={styles.page} data-phase={phase}>
      <header className={styles.bar}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden>
            ▲
          </span>
          <h1 className={styles.title}>
            FLOW<span className={styles.titleAlt}>FIGHTER</span>
          </h1>
          {state.spec ? <span className={styles.marquee} title={state.spec.prompt}>{state.spec.title}</span> : null}
        </div>
        <nav className={styles.controls} aria-label="Battle controls">
          <div className={styles.speed} role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button key={s} type="button" className={`${styles.chip} ${speed === s ? styles.chipOn : ""}`} onClick={() => setSpeed(s)} aria-pressed={speed === s}>
                {s}x
              </button>
            ))}
          </div>
          <button type="button" className={`${styles.chip} ${muted ? "" : styles.chipOn}`} onClick={() => setMuted(!muted)} aria-pressed={!muted} title={muted ? "Sound off" : "Sound on"}>
            {muted ? "SND OFF" : "SND ON"}
          </button>
          {phase !== "idle" ? (
            <button type="button" className={styles.chip} onClick={reset}>
              NEW
            </button>
          ) : null}
          <a className={styles.link} href="/arena">
            ARENA
          </a>
          <a className={styles.link} href="/">
            HOME
          </a>
        </nav>
      </header>

      <main className={styles.main}>
        {showFight && phase !== "victory" && state.current ? (
          <div className={styles.matchup}>
            <strong>
              ROUND {state.current.round}: FLOW {flowOf(state.current.left) ?? "?"} ({state.fighters[state.current.left]?.def.name ?? "?"}) VS FLOW{" "}
              {flowOf(state.current.right) ?? "?"} ({state.fighters[state.current.right]?.def.name ?? "?"})
            </strong>
            {nextUp ? <span> · next: winner vs FLOW {flowOf(nextUp)} ({state.fighters[nextUp]?.def.name})</span> : <span> · final match</span>}
            <div className={styles.legend}>
              Fighter = a Memorable flow · Hit = one of its agents certified on an unseen company · Miss = a run failed a rule · K.O. = flow
              passed &lt; 50% · Tie = Jev judges
            </div>
          </div>
        ) : null}
        <div className={styles.frame}>
          <Stage action={showFight ? state.action : null} phase={phase}>
            {attractMode ? (
              <div className={`${styles.actors} ${styles.attract}`}>
                <FighterSlot f={null} def={fixtures[0]} side="left" action={attract.action} key="attract-l" pose={pA} />
                <FighterSlot f={null} def={fixtures[2] ?? fixtures[1]} side="right" action={attract.action} key="attract-r" pose={pB} />
              </div>
            ) : null}
            {showFight ? (
              <div className={styles.actors}>
                {left && leftDef ? (
                  <FighterSlot f={left} def={leftDef} side="left" action={state.action} key={`${matchKey}:${leftDef.id}`} pose={displayPose(left)} />
                ) : null}
                {right && rightDef ? (
                  <FighterSlot f={right} def={rightDef} side="right" action={state.action} key={`${matchKey}:${rightDef.id}`} pose={displayPose(right)} />
                ) : null}
              </div>
            ) : null}
            {showFight ? <Effects action={state.action} sideOf={sideOf} auraOf={auraOf} /> : null}
          </Stage>

          {phase === "fighting" || phase === "judging" ? (
            <div className={styles.hud}>
              <HUD left={left} right={right} round={round} banner={state.banner} dry={state.dry} flowOf={flowOf} />
            </div>
          ) : null}

          {phase !== "idle" && phase !== "victory" ? <Announcer banner={phase === "starting" ? { text: "GET READY", sub: "LOADING THE ARENA…", tone: "neutral" } : state.banner} referee={state.referee} /> : null}

          {attractMode ? (
            <div className={`${styles.overlay} ${styles.consoleOverlay}`}>
              <PromptConsole onStart={startPrompt} busy={phase === "starting"} lastSpec={state.spec} />
            </div>
          ) : null}

          {phase === "select" ? (
            <div className={`${styles.overlay} ${styles.selectOverlay}`}>
              <CharacterSelect fighters={selectRoster} spec={state.spec} />
            </div>
          ) : null}

          {phase === "victory" ? <Victory state={state} onRematch={onRematch} /> : null}

          {phase === "error" ? (
            <div className={`${styles.overlay} ${styles.errorOverlay}`} role="alert">
              <div className={styles.errorBox}>
                <p className={styles.errorTitle}>GAME OVER</p>
                <p className={styles.errorMsg}>{state.error ?? "Something went wrong."}</p>
                <button type="button" className={styles.retry} onClick={reset} autoFocus>
                  CONTINUE?
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {busy ? <p className={styles.status}>{state.jobId ? `JOB ${state.jobId.slice(0, 8)} · ${state.dry ? "DRY RUN" : "LIVE"}` : ""}</p> : null}
      </main>

      <footer className={styles.ticker}>
        <Ticker feed={state.feed} />
      </footer>
    </div>
  );
}

export { Battle };
