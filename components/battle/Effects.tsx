"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import type { FightAction, Side } from "@/lib/battle/types";
import styles from "./Effects.module.css";

/**
 * One-shot visual effects, keyed by action.seq. Absolutely positioned overlay (inset:0,
 * pointer-events:none) — drop it inside <Stage> above the fighters.
 *
 * Contract props: `action`. Additive optional props (documented deviations):
 *   sideOf(id)  -> which side a fighter stands on; unknown/absent = center of stage
 *   auraOf(id)  -> CSS color for the fighter's aura (special flash / orb); falls back to cyan
 */
export interface EffectsProps {
  action: FightAction | null;
  sideOf?: (id: string) => Side | null;
  auraOf?: (id: string) => string | null;
}

const LEFT_X = 36; // keep in sync with Battle.module.css .slotLeft
const RIGHT_X = 64; // keep in sync with Battle.module.css .slotRight
const CENTER_X = 50;
const TORSO_Y = 55;
const FEET_Y = 84;

const LIFETIME: Partial<Record<FightAction["kind"], number>> = {
  attack_hit: 1500,
  attack_miss: 1500,
  ko: 1900,
  time_up: 1500,
  judge: 1500,
  victory: 2600,
};

interface Live {
  seq: number;
  action: FightAction;
  ax: number; // attacker x %
  dx: number; // defender x %
  aura: string;
}

function xOf(side: Side | null | undefined): number | null {
  if (side === "left") return LEFT_X;
  if (side === "right") return RIGHT_X;
  return null;
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const v = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

export default function Effects({ action, sideOf, auraOf }: EffectsProps): JSX.Element {
  const [live, setLive] = useState<Live[]>([]);
  const lastSeq = useRef<number>(-1);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    if (!action || action.seq === lastSeq.current) return;
    lastSeq.current = action.seq;
    const life = LIFETIME[action.kind];
    if (!life) return;

    let ax = xOf(action.attacker && sideOf ? sideOf(action.attacker) : null);
    let dx = xOf(action.defender && sideOf ? sideOf(action.defender) : null);
    if (ax === null && dx !== null) ax = 100 - dx;
    if (dx === null && ax !== null) dx = 100 - ax;
    const aura = (action.attacker && auraOf ? auraOf(action.attacker) : null) || "#2de2ff";
    const entry: Live = { seq: action.seq, action, ax: ax ?? CENTER_X, dx: dx ?? CENTER_X, aura };

    setLive((l) => [...l.slice(-4), entry]);
    const t = setTimeout(() => {
      timers.current.delete(t);
      setLive((l) => l.filter((e) => e.seq !== entry.seq));
    }, life);
    timers.current.add(t);
  }, [action, sideOf, auraOf]);

  useEffect(() => {
    const set = timers.current;
    return () => {
      set.forEach((t) => clearTimeout(t));
      set.clear();
    };
  }, []);

  return (
    <div className={styles.root} aria-hidden="true">
      {live.map((e) => (
        <EffectFor key={e.seq} e={e} />
      ))}
    </div>
  );
}

function EffectFor({ e }: { e: Live }): JSX.Element | null {
  switch (e.action.kind) {
    case "attack_hit":
      return e.action.move === "special" ? (
        <>
          <Special e={e} />
          <Hit e={e} delay={380} />
        </>
      ) : (
        <Hit e={e} delay={120} />
      );
    case "attack_miss":
      return <Miss e={e} />;
    case "ko":
      return <KO e={e} />;
    case "time_up":
    case "judge":
      return <Gavel />;
    case "victory":
      return <VictoryFx e={e} />;
    default:
      return null;
  }
}

// ------------------------------------------------------------------ hit

function Starburst(): JSX.Element {
  const rays = 12;
  const outer: string[] = [];
  const inner: string[] = [];
  for (let i = 0; i < rays * 2; i++) {
    const a = (Math.PI * i) / rays;
    const r1 = i % 2 === 0 ? 50 : 22;
    const r2 = i % 2 === 0 ? 34 : 15;
    outer.push(`${(50 + Math.cos(a) * r1).toFixed(1)},${(50 + Math.sin(a) * r1).toFixed(1)}`);
    inner.push(`${(50 + Math.cos(a + 0.13) * r2).toFixed(1)},${(50 + Math.sin(a + 0.13) * r2).toFixed(1)}`);
  }
  return (
    <svg viewBox="0 0 100 100" className={styles.burstSvg}>
      <polygon points={outer.join(" ")} fill="#ff8a1f" />
      <polygon points={inner.join(" ")} fill="#ffd23f" />
      <circle cx="50" cy="50" r="11" fill="#fff" />
    </svg>
  );
}

function Hit({ e, delay }: { e: Live; delay: number }): JSX.Element {
  const dmg = e.action.damage ?? 0;
  // land the spark on the defender's leading edge (where the fist meets the body), not dead centre
  const front = e.dx === e.ax ? e.dx : e.dx + (e.dx > e.ax ? -3.5 : 3.5);
  const style = v({ "--x": `${front}%`, "--y": `${TORSO_Y}%`, "--d": `${delay}ms`, "--dir": e.dx >= e.ax ? 1 : -1 });
  return (
    <div className={styles.anchor} style={style}>
      <div className={styles.burst}>
        <Starburst />
      </div>
      <div className={styles.burstRing} />
      {dmg > 0 && <div className={styles.damage}>-{Math.round(dmg)}</div>}
      <div className={styles.sticker}>CERTIFIED!</div>
    </div>
  );
}

// ------------------------------------------------------------------ special

function Special({ e }: { e: Live }): JSX.Element {
  const trail = [0, 1, 2, 3, 4];
  return (
    <>
      <div className={styles.flash} style={v({ "--flash": e.aura })} />
      <div className={styles.charge} style={v({ "--x": `${e.ax}%`, "--y": `${TORSO_Y}%`, "--aura": e.aura })} />
      {trail.map((i) => (
        <div
          key={i}
          className={styles.orbLane}
          style={v({
            "--from": `${e.ax - 50}%`,
            "--to": `${e.dx - 50}%`,
            "--y": `${TORSO_Y}%`,
            "--aura": e.aura,
            "--i": i,
            "--s": 1 - i * 0.16,
          })}
        >
          <div className={i === 0 ? styles.orb : styles.orbGhost} />
        </div>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ miss

function Miss({ e }: { e: Live }): JSX.Element {
  const dir = e.dx >= e.ax ? 1 : -1;
  const rule = e.action.label ?? "";
  return (
    <>
      <div className={styles.anchor} style={v({ "--x": `${e.ax}%`, "--y": `${TORSO_Y - 4}%`, "--dir": dir })}>
        <div className={styles.swoosh}>
          <svg viewBox="0 0 120 80" className={styles.swooshSvg}>
            <path d="M5 60 Q60 -10 115 30" />
            <path d="M15 70 Q65 10 112 45" />
            <path d="M25 78 Q70 32 108 58" />
          </svg>
        </div>
      </div>
      <div className={styles.anchor} style={v({ "--x": `${e.ax}%`, "--y": `${FEET_Y}%` })}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={styles.dust} style={v({ "--i": i, "--dx": `${(i - 2.5) * 18}px` })} />
        ))}
      </div>
      <div className={styles.anchor} style={v({ "--x": `${e.ax}%`, "--y": `${TORSO_Y - 22}%` })}>
        <div className={styles.missText}>MISS</div>
        {rule && <div className={styles.rule}>✗ {rule}</div>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ KO

function KO({ e }: { e: Live }): JSX.Element {
  return (
    <>
      <div className={styles.whiteFlash} />
      <div className={styles.anchor} style={v({ "--x": `${e.dx}%`, "--y": `${TORSO_Y}%` })}>
        <div className={styles.shock} />
        <div className={`${styles.shock} ${styles.shock2}`} />
      </div>
      {/* the "K.O." word itself is the Announcer's banner; a second copy here doubled it up */}
    </>
  );
}

// ------------------------------------------------------------------ judges

function Gavel(): JSX.Element {
  const sparkles = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <div className={styles.anchor} style={v({ "--x": "50%", "--y": "36%" })}>
      <div className={styles.gavelImpact} />
      {sparkles.map((i) => {
        const a = (i / sparkles.length) * Math.PI * 2 + 0.3;
        const r = 70 + (i % 3) * 22;
        return (
          <div
            key={i}
            className={styles.sparkle}
            style={v({ "--tx": `${Math.cos(a) * r}px`, "--ty": `${Math.sin(a) * r * 0.7}px`, "--i": i })}
          >
            ✦
          </div>
        );
      })}
      <div className={styles.gavel}>
        <svg viewBox="0 0 100 100" className={styles.gavelSvg}>
          <g transform="rotate(-35 50 50)">
            <rect x="46" y="38" width="8" height="56" rx="3" fill="#8a4b1f" stroke="#ffd23f" strokeWidth="2" />
            <rect x="22" y="18" width="56" height="24" rx="5" fill="#b8692b" stroke="#ffd23f" strokeWidth="3" />
            <rect x="18" y="16" width="8" height="28" rx="3" fill="#ffd23f" />
            <rect x="74" y="16" width="8" height="28" rx="3" fill="#ffd23f" />
          </g>
        </svg>
      </div>
      <div className={styles.block} />
    </div>
  );
}

// ------------------------------------------------------------------ victory

const CONFETTI_COLORS = ["#ff3d7f", "#2de2ff", "#ffd23f", "#3ddc97", "#ffffff", "#b388ff"];

function VictoryFx({ e }: { e: Live }): JSX.Element {
  const rnd = mulberry(e.seq * 2654435761 + 7);
  const pieces = [];
  for (let i = 0; i < 60; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.3;
    const r = 18 + rnd() * 30; // cqh
    pieces.push({
      i,
      tx: Math.cos(a) * r * 1.4,
      ty: Math.sin(a) * r,
      fall: 30 + rnd() * 40,
      rot: Math.round((rnd() - 0.5) * 1440),
      c: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      w: 5 + Math.round(rnd() * 6),
      h: 8 + Math.round(rnd() * 8),
      d: Math.round(rnd() * 220),
      round: rnd() < 0.25,
    });
  }
  const x = e.ax;
  return (
    <>
      <div className={styles.anchor} style={v({ "--x": `${x}%`, "--y": `${TORSO_Y}%` })}>
        <div className={styles.rays} />
      </div>
      <div className={styles.anchor} style={v({ "--x": `${x}%`, "--y": `${TORSO_Y - 8}%` })}>
        {pieces.map((p) => (
          <div
            key={p.i}
            className={styles.confetti}
            style={v({
              "--tx": `${p.tx.toFixed(1)}cqh`,
              "--ty": `${p.ty.toFixed(1)}cqh`,
              "--fall": `${p.fall.toFixed(1)}cqh`,
              "--rot": `${p.rot}deg`,
              "--c": p.c,
              "--w": `${p.w}px`,
              "--h": `${p.round ? p.w : p.h}px`,
              "--r": p.round ? "50%" : "1px",
              "--d": `${p.d}ms`,
            })}
          />
        ))}
      </div>
    </>
  );
}
