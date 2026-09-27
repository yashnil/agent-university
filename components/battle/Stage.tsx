"use client";

import type { JSX, ReactNode } from "react";
import type { BattlePhase, FightAction } from "@/lib/battle/types";
import styles from "./Stage.module.css";

/**
 * Stage-internal floor line, as a percentage of the stage height measured from the top.
 * Also exposed as the CSS variable --floor-y on the stage root (plus --horizon-y).
 * Fighters: `position:absolute; bottom: calc(100% - var(--floor-y));` stands them on the floor.
 */
export const FLOOR_Y = 84;
export const HORIZON_Y = 60;

// ------------------------------------------------------------------ deterministic scenery

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Star {
  x: number;
  y: number;
  r: number;
  d: number;
}
const STARS: Star[] = (() => {
  const r = rng(7);
  const out: Star[] = [];
  for (let i = 0; i < 70; i++) out.push({ x: r() * 100, y: r() * 52, r: r() < 0.15 ? 2 : 1, d: r() * 4 });
  return out;
})();

interface Building {
  x: number;
  w: number;
  h: number;
  windows: { x: number; y: number; on: boolean }[];
}
function makeCity(seed: number, count: number, minH: number, maxH: number): Building[] {
  const r = rng(seed);
  const out: Building[] = [];
  let x = -10;
  for (let i = 0; i < count && x < 1300; i++) {
    const w = 40 + Math.floor(r() * 70);
    const h = minH + Math.floor(r() * (maxH - minH));
    const windows: Building["windows"] = [];
    for (let wy = 14; wy < h - 10; wy += 16) {
      for (let wx = 8; wx < w - 8; wx += 12) {
        if (r() < 0.32) windows.push({ x: x + wx, y: 360 - h + wy, on: r() < 0.85 });
      }
    }
    out.push({ x, w, h, windows });
    x += w + Math.floor(r() * 6);
  }
  return out;
}
const CITY_FAR = makeCity(21, 40, 80, 210);
const CITY_NEAR = makeCity(99, 30, 50, 150);

interface Sign {
  text: string;
  x: number;
  y: number;
  color: string;
  size: number;
  delay: number;
}
const SIGNS: Sign[] = [
  { text: "MEMORABLE", x: 215, y: 205, color: "#2de2ff", size: 18, delay: 1.3 },
  { text: "QM", x: 1060, y: 190, color: "#ffd23f", size: 30, delay: 2.1 },
];

const CROWD: { x: number; s: number; g: number; hue: number }[] = (() => {
  const r = rng(404);
  const out: { x: number; s: number; g: number; hue: number }[] = [];
  for (let x = -10; x < 1300; x += 22 + r() * 12) out.push({ x, s: 0.8 + r() * 0.45, g: Math.floor(r() * 4), hue: r() });
  return out;
})();

// ------------------------------------------------------------------ component

export default function Stage({ action, phase, children }: { action: FightAction | null; phase: BattlePhase; children?: ReactNode }): JSX.Element {
  const kind = action?.kind;
  const seq = action?.seq ?? 0;
  const special = kind === "attack_hit" && action?.move === "special";
  let shake = "";
  if (kind === "attack_hit" && !special) shake = seq % 2 ? styles.shakeSmA : styles.shakeSmB;
  else if (special || kind === "ko") shake = seq % 2 ? styles.shakeBigA : styles.shakeBigB;
  const ko = kind === "ko";
  const dim = phase === "select" || phase === "victory" || phase === "idle";

  const rootCls = [styles.stage, ko ? styles.ko : "", dim ? styles.dim : "", phase === "idle" || phase === "starting" ? styles.attract : "", phase === "error" ? styles.error : ""].filter(Boolean).join(" ");

  return (
    <div className={rootCls} style={{ ["--floor-y" as string]: `${FLOOR_Y}%`, ["--horizon-y" as string]: `${HORIZON_Y}%` }} data-phase={phase}>
      <div className={`${styles.camera} ${shake}`}>
        <div className={styles.world} key={ko ? `ko-${seq}` : "world"}>
          <div className={styles.sky} />
          <div className={styles.moon} />
          <div className={styles.stars} aria-hidden>
            {STARS.map((s, i) => (
              <i key={i} style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.r, height: s.r, animationDelay: `${s.d}s` }} />
            ))}
          </div>

          <svg className={`${styles.layer} ${styles.cityFar}`} viewBox="0 0 1280 360" preserveAspectRatio="xMidYMax slice" aria-hidden>
            <defs>
              <linearGradient id="stgFar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#1a1233" />
                <stop offset="1" stopColor="#0d0a1c" />
              </linearGradient>
            </defs>
            {CITY_FAR.map((b, i) => (
              <rect key={i} x={b.x} y={360 - b.h} width={b.w} height={b.h} fill="url(#stgFar)" />
            ))}
          </svg>

          <svg className={`${styles.layer} ${styles.cityNear}`} viewBox="0 0 1280 360" preserveAspectRatio="xMidYMax slice" aria-hidden>
            {CITY_NEAR.map((b, i) => (
              <g key={i}>
                <rect x={b.x} y={360 - b.h} width={b.w} height={b.h} fill="#0a0814" />
                <rect x={b.x} y={360 - b.h} width={b.w} height={2} fill="#2de2ff" opacity={0.25} />
                {b.windows.map((w, j) => (
                  <rect key={j} x={w.x} y={w.y} width={5} height={7} fill={w.on ? (j % 5 === 0 ? "#ff3d7f" : "#ffd23f") : "#1b1630"} opacity={w.on ? 0.55 : 1} className={w.on && j % 7 === 3 ? styles.window : undefined} />
                ))}
              </g>
            ))}
            {SIGNS.map((s) => (
              <g key={s.text} className={styles.sign} style={{ animationDelay: `${s.delay}s`, color: s.color }}>
                <rect x={s.x - (s.text.length * s.size * 0.36 + 14)} y={s.y - s.size - 6} width={s.text.length * s.size * 0.72 + 28} height={s.size + 18} rx={4} fill="#07060d" stroke={s.color} strokeWidth={2} opacity={0.9} />
                <text x={s.x} y={s.y + 2} textAnchor="middle" fill={s.color} fontSize={s.size} className={styles.signText}>
                  {s.text}
                </text>
              </g>
            ))}
          </svg>

          <div className={styles.haze} />

          <svg className={`${styles.layer} ${styles.crowd}`} viewBox="0 0 1280 120" preserveAspectRatio="xMidYMax slice" aria-hidden>
            {[0, 1, 2, 3].map((g) => (
              <g key={g} className={styles[`bob${g}`]}>
                {CROWD.filter((c) => c.g === g).map((c, i) => (
                  <g key={i} transform={`translate(${c.x} ${120 - 70 * c.s}) scale(${c.s})`}>
                    <circle cx={11} cy={14} r={10} fill="#140f24" />
                    <path d="M-6 70 Q-4 30 11 28 Q26 30 28 70 Z" fill="#140f24" />
                    {c.hue > 0.72 && <path d={c.hue > 0.86 ? "M-2 34 L-10 2" : "M24 34 L32 2"} stroke="#140f24" strokeWidth={6} strokeLinecap="round" />}
                    {c.hue > 0.93 && <circle cx={c.hue > 0.965 ? -10 : 32} cy={2} r={3} fill="#ffd23f" className={styles.lighter} />}
                  </g>
                ))}
              </g>
            ))}
          </svg>
          <div className={styles.rail} />

          <div className={styles.floor}>
            <div className={styles.grid} />
            <div className={styles.reflect} />
          </div>
          <div className={styles.floorLine} />
        </div>

        <div className={styles.content}>{children}</div>
      </div>

      <div className={styles.dimmer} aria-hidden />
      <div className={styles.flash} key={`f-${ko || special ? seq : 0}`} data-on={ko || special ? "1" : "0"} aria-hidden />
      <div className={styles.crt} aria-hidden />
    </div>
  );
}
