"use client";

// FLOW FIGHTER — the fighter caricature. Pure inline SVG (viewBox 220x320), articulated limbs as <g>
// groups whose transform-origin sits at the joint (see Fighter.module.css), so every pose is a set
// of CSS keyframes on transform/opacity. Faces right; side "right" mirrors it.

import { useId } from "react";
import type { CSSProperties, JSX, ReactNode } from "react";
import type { FightAction, FighterDef, FighterStyle, Palette, Pose, Side } from "@/lib/battle/types";
import styles from "./Fighter.module.css";

const INK = "#120d1f";
const SHADE = "rgba(18,13,31,0.26)";
const HI = "rgba(255,255,255,0.42)";
const MOUTH = "#4a0c24";

type Pt = readonly [number, number];

// Joints (viewBox units). Keep in sync with the transform-origins in Fighter.module.css.
const SH_F: Pt = [132, 142];
const EL_F: Pt = [156, 172];
const FS_F: Pt = [176, 140];
const SH_B: Pt = [96, 144];
const EL_B: Pt = [112, 180];
const FS_B: Pt = [148, 156];
const HIP_F: Pt = [124, 206];
const KN_F: Pt = [142, 250];
const FT_F: Pt = [150, 290];
const HIP_B: Pt = [100, 206];
const KN_B: Pt = [84, 250];
const FT_B: Pt = [72, 290];
const HC: Pt = [114, 84]; // head centre

const ONE_SHOT: ReadonlySet<Pose> = new Set<Pose>(["punch", "kick", "special", "hurt", "block", "stumble", "ko", "taunt"]);

export interface FighterProps {
  def: FighterDef;
  pose: Pose;
  side: Side;
  hp: number;
  action: FightAction | null;
  /** Optional extras (not in the contract; harmless): size via style={{ "--fighter-w": "260px" }} or width. */
  className?: string;
  style?: CSSProperties;
}

type EyeMode = "determined" | "fierce" | "squint" | "xx" | "sparkle";
type MouthMode = "set" | "shout" | "grimace" | "grin" | "wavy" | "smirk" | "pant";

function eyeFor(pose: Pose): EyeMode {
  switch (pose) {
    case "special":
      return "fierce";
    case "hurt":
    case "stumble":
      return "squint";
    case "ko":
      return "xx";
    case "victory":
      return "sparkle";
    default:
      return "determined";
  }
}

function mouthFor(pose: Pose, weak: boolean): MouthMode {
  switch (pose) {
    case "punch":
    case "kick":
    case "special":
      return "shout";
    case "hurt":
    case "stumble":
      return "grimace";
    case "ko":
      return "wavy";
    case "victory":
      return "grin";
    case "taunt":
      return "smirk";
    default:
      return weak ? "pant" : "set";
  }
}

// ------------------------------------------------------------------ primitives

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** A limb segment: ink outline + fill + cel-shade stripe on the back side. */
function Seg({ a, b, w, c, shade = true }: { a: Pt; b: Pt; w: number; c: string; shade?: boolean }): JSX.Element {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * w * 0.22;
  const ny = (dx / L) * w * 0.22;
  return (
    <g>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={INK} strokeWidth={w + 8} strokeLinecap="round" />
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={c} strokeWidth={w} strokeLinecap="round" />
      {shade && (
        <line x1={a[0] + nx} y1={a[1] + ny} x2={b[0] + nx} y2={b[1] + ny} stroke={SHADE} strokeWidth={w * 0.4} strokeLinecap="round" />
      )}
    </g>
  );
}

/** A band (cuff, wrap, boot top) across a segment between t0..t1. */
function Band({ a, b, t0, t1, w, c }: { a: Pt; b: Pt; t0: number; t1: number; w: number; c: string }): JSX.Element {
  const p = lerp(a, b, t0);
  const q = lerp(a, b, t1);
  return (
    <g>
      <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={INK} strokeWidth={w + 7} strokeLinecap="butt" />
      <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={c} strokeWidth={w} strokeLinecap="butt" />
    </g>
  );
}

function star4(cx: number, cy: number, r: number): string {
  const k = r * 0.28;
  return `M${cx} ${cy - r}L${cx + k} ${cy - k}L${cx + r} ${cy}L${cx + k} ${cy + k}L${cx} ${cy + r}L${cx - k} ${cy + k}L${cx - r} ${cy}L${cx - k} ${cy - k}Z`;
}

const outline = { stroke: INK, strokeWidth: 4, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

// ------------------------------------------------------------------ per-style look

interface Look {
  upperArm: string;
  forearm: string;
  armW: number;
  foreW: number;
  thigh: string;
  shin: string;
  thighW: number;
  shinW: number;
  foot: string;
  neck: string;
  neckW: number;
}

function lookFor(style: FighterStyle, p: Palette): Look {
  switch (style) {
    case "karate":
      return { upperArm: p.gi, forearm: p.skin, armW: 19, foreW: 15, thigh: p.gi, shin: p.gi, thighW: 26, shinW: 24, foot: p.skin, neck: p.skin, neckW: 18 };
    case "boxer":
      return { upperArm: p.skin, forearm: p.skin, armW: 18, foreW: 16, thigh: p.skin, shin: p.skin, thighW: 21, shinW: 18, foot: p.trim, neck: p.skin, neckW: 21 };
    case "ninja":
      return { upperArm: p.gi, forearm: p.gi, armW: 15, foreW: 14, thigh: p.gi, shin: p.gi, thighW: 21, shinW: 18, foot: p.hair, neck: p.gi, neckW: 16 };
    case "sumo":
      return { upperArm: p.skin, forearm: p.skin, armW: 23, foreW: 20, thigh: p.skin, shin: p.skin, thighW: 33, shinW: 25, foot: p.skin, neck: p.skin, neckW: 28 };
    case "monk":
      return { upperArm: p.gi, forearm: p.skin, armW: 19, foreW: 14, thigh: p.gi, shin: p.skin, thighW: 27, shinW: 15, foot: p.skin, neck: p.skin, neckW: 17 };
    case "robot":
      return { upperArm: p.gi, forearm: p.gi, armW: 12, foreW: 12, thigh: p.gi, shin: p.gi, thighW: 14, shinW: 14, foot: p.trim, neck: p.hair, neckW: 11 };
  }
}

// ------------------------------------------------------------------ hands & feet

function Hand({ at, style, p }: { at: Pt; style: FighterStyle; p: Palette }): JSX.Element {
  const [x, y] = at;
  if (style === "boxer") {
    return (
      <g>
        <path d={`M${x - 12} ${y + 10}L${x - 6} ${y + 20}L${x + 6} ${y + 18}L${x + 2} ${y + 8}Z`} fill={p.trim} {...outline} strokeWidth={3.5} />
        <circle cx={x + 2} cy={y - 1} r={17} fill={p.accent} {...outline} />
        <path d={`M${x - 12} ${y + 6}A17 17 0 0 0 ${x + 16} ${y + 8}`} fill="none" stroke={SHADE} strokeWidth={6} strokeLinecap="round" />
        <path d={`M${x + 4} ${y - 12}Q${x + 13} ${y - 10} ${x + 14} ${y - 2}`} fill="none" stroke={HI} strokeWidth={4} strokeLinecap="round" />
        <path d={`M${x - 4} ${y - 4}Q${x + 2} ${y + 4} ${x + 12} ${y + 2}`} fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
      </g>
    );
  }
  if (style === "robot") {
    return (
      <g>
        <rect x={x - 12} y={y - 12} width={24} height={24} rx={6} fill={p.trim} {...outline} />
        <rect x={x - 12} y={y + 2} width={24} height={10} rx={4} fill={SHADE} />
        <line x1={x - 5} y1={y - 5} x2={x + 7} y2={y - 5} stroke={p.accent} strokeWidth={3} strokeLinecap="round" />
      </g>
    );
  }
  const r = style === "sumo" ? 14 : 12;
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={p.skin} {...outline} />
      <path d={`M${x - r + 2} ${y + 4}A${r} ${r} 0 0 0 ${x + r - 3} ${y + 5}`} fill="none" stroke={SHADE} strokeWidth={4} strokeLinecap="round" />
      <path d={`M${x + 2} ${y - 6}L${x + 6} ${y + 5}M${x + 7} ${y - 5}L${x + 10} ${y + 3}`} stroke={INK} strokeWidth={2} strokeLinecap="round" />
      {(style === "ninja" || style === "karate") && (
        <path d={`M${x - r} ${y + 2}Q${x - r + 5} ${y - 6} ${x - r + 2} ${y - 10}`} fill="none" stroke={style === "ninja" ? p.trim : p.accent} strokeWidth={3} strokeLinecap="round" />
      )}
    </g>
  );
}

function Foot({ at, style, p, c }: { at: Pt; style: FighterStyle; p: Palette; c: string }): JSX.Element {
  const [x, y] = at;
  const big = style === "robot" || style === "boxer" ? 4 : 0;
  const d = `M${x - 13 - big} ${y - 7 - big}Q${x - 2} ${y - 16 - big} ${x + 9} ${y - 10}Q${x + 24 + big} ${y - 6} ${x + 25 + big} ${y + 3}L${x + 25 + big} ${y + 8}L${x - 15 - big} ${y + 8}Z`;
  return (
    <g>
      <path d={d} fill={c} {...outline} />
      <path d={`M${x - 14 - big} ${y + 4}L${x + 24 + big} ${y + 4}`} stroke={SHADE} strokeWidth={5} />
      {style === "monk" && <path d={`M${x - 6} ${y - 11}L${x + 4} ${y + 4}`} stroke={p.trim} strokeWidth={4} strokeLinecap="round" />}
      {style === "monk" && <line x1={x - 16} y1={y + 9} x2={x + 26} y2={y + 9} stroke={p.trim} strokeWidth={4} strokeLinecap="round" />}
      {style === "boxer" && <path d={`M${x - 4} ${y - 12}L${x + 2} ${y - 4}M${x + 4} ${y - 12}L${x + 10} ${y - 5}`} stroke={p.skin} strokeWidth={2.5} strokeLinecap="round" />}
      {style === "robot" && <rect x={x - 10} y={y - 2} width={30} height={5} rx={2} fill={p.accent} opacity={0.9} />}
      {style === "ninja" && <line x1={x + 9} y1={y - 10} x2={x + 9} y2={y + 6} stroke={INK} strokeWidth={2.5} />}
    </g>
  );
}

// ------------------------------------------------------------------ limbs

function Leg({ hip, knee, foot, lk, style, p, front }: { hip: Pt; knee: Pt; foot: Pt; lk: Look; style: FighterStyle; p: Palette; front: boolean }): JSX.Element {
  const cls = front ? styles.legF : styles.legB;
  const shinCls = front ? styles.shinF : styles.shinB;
  return (
    <g className={cls}>
      <Seg a={hip} b={knee} w={lk.thighW} c={lk.thigh} />
      {style === "boxer" && <Band a={hip} b={knee} t0={-0.05} t1={0.55} w={31} c={p.gi} />}
      {style === "boxer" && <Band a={hip} b={knee} t0={0.47} t1={0.55} w={31} c={p.trim} />}
      {style === "robot" && <circle cx={knee[0]} cy={knee[1]} r={9} fill={p.trim} {...outline} strokeWidth={3} />}
      <g className={shinCls}>
        <Seg a={knee} b={foot} w={lk.shinW} c={lk.shin} />
        {style === "karate" && <Band a={knee} b={foot} t0={0.8} t1={0.9} w={26} c={p.gi} />}
        {style === "ninja" && (
          <>
            <Band a={knee} b={foot} t0={0.35} t1={0.45} w={20} c={p.trim} />
            <Band a={knee} b={foot} t0={0.6} t1={0.7} w={20} c={p.trim} />
          </>
        )}
        {style === "boxer" && <Band a={knee} b={foot} t0={0.55} t1={1} w={22} c={p.trim} />}
        {style === "robot" && <Band a={knee} b={foot} t0={0.62} t1={1} w={22} c={p.trim} />}
        {style === "sumo" && <Band a={knee} b={foot} t0={0.05} t1={0.2} w={27} c={p.trim} />}
        <Foot at={foot} style={style} p={p} c={lk.foot} />
      </g>
    </g>
  );
}

function Arm({ sh, el, fs, lk, style, p, front }: { sh: Pt; el: Pt; fs: Pt; lk: Look; style: FighterStyle; p: Palette; front: boolean }): JSX.Element {
  return (
    <g className={front ? styles.armF : styles.armB}>
      <Seg a={sh} b={el} w={lk.armW} c={lk.upperArm} />
      {style === "karate" && <Band a={sh} b={el} t0={0.78} t1={0.95} w={lk.armW + 3} c={p.gi} />}
      {style === "monk" && <Band a={sh} b={el} t0={0.75} t1={0.95} w={lk.armW + 4} c={p.gi} />}
      {style === "robot" && <circle cx={sh[0]} cy={sh[1]} r={10} fill={p.trim} {...outline} strokeWidth={3} />}
      <g className={front ? styles.foreF : styles.foreB}>
        <Seg a={el} b={fs} w={lk.foreW} c={lk.forearm} />
        {style === "robot" && <circle cx={el[0]} cy={el[1]} r={8} fill={p.accent} {...outline} strokeWidth={3} />}
        {style === "ninja" && <Band a={el} b={fs} t0={0.45} t1={0.7} w={lk.foreW + 1} c={p.trim} />}
        {style === "boxer" && <Band a={el} b={fs} t0={0.62} t1={0.76} w={lk.foreW + 1} c="#f4efe6" />}
        <Hand at={fs} style={style} p={p} />
      </g>
    </g>
  );
}

// ------------------------------------------------------------------ torso

const TORSO = "M82 140C94 126 130 126 144 140L140 206C126 216 100 216 86 206Z";
const TORSO_SUMO = "M74 140C92 120 136 120 152 140C182 170 176 218 142 220L84 220C54 214 56 168 74 140Z";

function Torso({ style, p }: { style: FighterStyle; p: Palette }): JSX.Element {
  switch (style) {
    case "karate":
      return (
        <g>
          <path d={TORSO} fill={p.gi} {...outline} />
          <path d="M106 131L132 131L121 170Z" fill={p.skin} />
          <path d="M104 131L121 172L140 204M133 131L121 170" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M84 146C88 170 88 190 88 206C94 210 98 212 102 213C96 190 96 160 98 134Z" fill={SHADE} />
          <path d="M110 150Q116 160 118 168" stroke={SHADE} strokeWidth={3} fill="none" strokeLinecap="round" />
          <rect x={83} y={190} width={60} height={14} rx={4} fill="#1c1826" {...outline} strokeWidth={3.5} />
          <path d="M124 200L117 228M130 200L139 226" stroke={INK} strokeWidth={11} strokeLinecap="round" />
          <path d="M124 200L117 228M130 200L139 226" stroke="#1c1826" strokeWidth={5.5} strokeLinecap="round" />
          <rect x={120} y={189} width={13} height={16} rx={3} fill="#1c1826" {...outline} strokeWidth={3} />
          <line x1={90} y1={194} x2={116} y2={194} stroke="rgba(255,255,255,0.18)" strokeWidth={2} />
        </g>
      );
    case "boxer":
      return (
        <g>
          <path d={TORSO} fill={p.skin} {...outline} />
          <path d="M84 146C88 170 88 190 88 206C94 210 98 212 102 213C96 190 96 160 98 134Z" fill={SHADE} />
          <path d="M100 158Q112 166 121 158M123 158Q132 165 141 156" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
          <path d="M112 172L112 196M104 178Q112 181 120 178M104 188Q112 191 120 188" fill="none" stroke={SHADE} strokeWidth={3} strokeLinecap="round" />
          <path d="M84 192L142 192L142 210C126 218 100 218 86 210Z" fill={p.gi} {...outline} strokeWidth={3.5} />
          <rect x={83} y={188} width={60} height={10} rx={3} fill={p.trim} {...outline} strokeWidth={3} />
        </g>
      );
    case "ninja":
      return (
        <g>
          <path d={TORSO} fill={p.gi} {...outline} />
          <path d="M84 146C88 170 88 190 88 206C94 210 98 212 102 213C96 190 96 160 98 134Z" fill={SHADE} />
          <path d="M100 132L136 190M134 132L110 170" fill="none" stroke={p.trim} strokeWidth={4} strokeLinecap="round" />
          <path d="M100 132L136 190M134 132L110 170" fill="none" stroke={INK} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
          <rect x={83} y={188} width={60} height={15} rx={4} fill={p.accent} {...outline} strokeWidth={3.5} />
          <path d="M92 198Q80 214 70 222M96 200Q88 220 84 232" stroke={INK} strokeWidth={10} strokeLinecap="round" fill="none" />
          <path d="M92 198Q80 214 70 222M96 200Q88 220 84 232" stroke={p.accent} strokeWidth={5} strokeLinecap="round" fill="none" />
        </g>
      );
    case "sumo":
      return (
        <g>
          <path d={TORSO_SUMO} fill={p.skin} {...outline} />
          <path d="M74 146C62 172 66 206 86 216L100 219C80 204 76 172 86 138Z" fill={SHADE} />
          <path d="M98 154Q108 162 118 156M126 156Q138 164 148 154" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
          <path d="M150 170Q164 186 150 202" fill="none" stroke={HI} strokeWidth={4} strokeLinecap="round" />
          <circle cx={134} cy={184} r={2.6} fill={INK} />
          <path d="M72 194C100 204 130 204 158 190L152 221L80 221Z" fill={p.trim} {...outline} />
          <path d="M118 204L116 232M126 204L126 234M134 203L136 232" stroke={INK} strokeWidth={5} strokeLinecap="round" />
          <path d="M118 204L116 232M126 204L126 234M134 203L136 232" stroke={p.trim} strokeWidth={2} strokeLinecap="round" />
          <path d="M80 200C104 208 130 208 152 198" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={3} />
        </g>
      );
    case "monk": {
      const beads: Pt[] = [];
      for (let i = 0; i <= 8; i++) {
        const a = (Math.PI * (20 + (140 * i) / 8)) / 180;
        beads.push([116 + Math.cos(a) * 24, 140 + Math.sin(a) * 26]);
      }
      return (
        <g>
          <path d={TORSO} fill={p.skin} {...outline} />
          <path d="M82 140C92 128 104 128 110 130L144 196L140 206C126 216 100 216 86 206Z" fill={p.gi} {...outline} />
          <path d="M86 150C90 172 90 192 90 207C96 211 100 212 104 213C98 190 96 160 98 134Z" fill={SHADE} />
          <path d="M108 140L128 190M100 150L114 200" fill="none" stroke={SHADE} strokeWidth={3} strokeLinecap="round" />
          <path d="M112 130L144 196" fill="none" stroke={p.trim} strokeWidth={4} />
          {beads.map((b, i) => (
            <circle key={i} cx={b[0]} cy={b[1]} r={i === 4 ? 6.5 : 4.6} fill={i === 4 ? p.accent : p.trim} stroke={INK} strokeWidth={2.2} />
          ))}
        </g>
      );
    }
    case "robot":
      return (
        <g>
          <path d="M84 136Q84 128 94 128L134 128Q144 128 144 138L140 200Q140 210 130 210L96 210Q86 210 86 200Z" fill={p.gi} {...outline} />
          <path d="M86 140L88 200Q88 208 96 209L100 209L98 130L94 130Q86 130 86 140Z" fill={SHADE} />
          <rect x={98} y={142} width={36} height={34} rx={7} fill={p.hair} {...outline} strokeWidth={3} />
          <circle className={styles.core} cx={116} cy={159} r={9} fill={p.accent} stroke={INK} strokeWidth={2.5} />
          <circle cx={113} cy={156} r={3} fill="#fff" opacity={0.85} />
          <rect x={86} y={190} width={56} height={12} rx={3} fill={p.trim} {...outline} strokeWidth={3} />
          <path d="M96 190L92 202M108 190L104 202M120 190L116 202M132 190L128 202" stroke={INK} strokeWidth={2.5} />
          <circle cx={92} cy={136} r={2.2} fill={INK} />
          <circle cx={138} cy={136} r={2.2} fill={INK} />
        </g>
      );
  }
}

// ------------------------------------------------------------------ face

function Eyes({ mode, p, id }: { mode: EyeMode; p: Palette; id: string }): JSX.Element {
  const FAR: Pt = [124, 86];
  const NEAR: Pt = [142, 86];
  if (mode === "xx") {
    const x = (c: Pt, r: number) => `M${c[0] - r} ${c[1] - r}L${c[0] + r} ${c[1] + r}M${c[0] + r} ${c[1] - r}L${c[0] - r} ${c[1] + r}`;
    return <path d={`${x(FAR, 5.5)}${x(NEAR, 6.5)}`} stroke={INK} strokeWidth={4.5} strokeLinecap="round" />;
  }
  if (mode === "squint") {
    return (
      <g fill="none" stroke={INK} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M117 79L129 86L117 93" />
        <path d="M149 78L136 86L149 94" />
        <path d="M112 72L130 79M136 79L154 70" strokeWidth={5} />
      </g>
    );
  }
  if (mode === "sparkle") {
    return (
      <g>
        <path d="M117 90Q124 78 131 90M135 90Q142 77 150 90" fill="none" stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
        <path d="M113 70Q122 64 130 68M136 67Q145 62 154 68" fill="none" stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
        <path className={styles.twinkle} d={star4(156, 76, 7)} fill="#ffd23f" stroke={INK} strokeWidth={1.5} />
      </g>
    );
  }
  const fierce = mode === "fierce";
  return (
    <g>
      <ellipse cx={FAR[0]} cy={FAR[1]} rx={6.5} ry={8.5} fill="#fff" stroke={INK} strokeWidth={3} />
      <ellipse cx={NEAR[0]} cy={NEAR[1]} rx={7.5} ry={9.5} fill="#fff" stroke={INK} strokeWidth={3} />
      {fierce ? (
        <g filter={`url(#${id}-glow)`}>
          <ellipse cx={FAR[0]} cy={FAR[1]} rx={4} ry={6} fill={p.aura} />
          <ellipse cx={NEAR[0]} cy={NEAR[1]} rx={4.5} ry={6.5} fill={p.aura} />
        </g>
      ) : (
        <g>
          <circle cx={FAR[0] + 2.5} cy={FAR[1] + 1} r={3.6} fill={INK} />
          <circle cx={NEAR[0] + 3} cy={NEAR[1] + 1} r={4.2} fill={INK} />
          <circle cx={FAR[0] + 3.6} cy={FAR[1] - 0.6} r={1.2} fill="#fff" />
          <circle cx={NEAR[0] + 4.2} cy={NEAR[1] - 0.8} r={1.4} fill="#fff" />
        </g>
      )}
      <path d={fierce ? "M112 70L131 80M135 80L155 68" : "M113 72L130 78M136 78L153 71"} fill="none" stroke={INK} strokeWidth={5.5} strokeLinecap="round" />
    </g>
  );
}

function Mouth({ mode }: { mode: MouthMode }): JSX.Element {
  switch (mode) {
    case "shout":
      return (
        <g>
          <path d="M129 103Q141 99 153 103Q151 121 139 120Q130 116 129 103Z" fill={MOUTH} {...outline} strokeWidth={3} />
          <path d="M132 104Q141 101 150 104L149 108Q141 106 133 108Z" fill="#fff" />
          <path d="M134 116Q140 112 146 116" fill="none" stroke="#ff6b8a" strokeWidth={3} strokeLinecap="round" />
        </g>
      );
    case "grimace":
      return (
        <g>
          <path d="M128 103L152 101L150 114L130 115Z" fill="#fff" {...outline} strokeWidth={3} />
          <path d="M129 108.5L151 107.5M136 102.5L136 115M143 102L143 114.5" stroke={INK} strokeWidth={2} />
        </g>
      );
    case "grin":
      return (
        <g>
          <path d="M127 101Q142 106 155 99Q153 121 139 121Q128 117 127 101Z" fill={MOUTH} {...outline} strokeWidth={3} />
          <path d="M130 102.5Q142 106.5 152 101L151 106Q142 110 131 107Z" fill="#fff" />
          <path d="M134 116Q140 112 147 115" fill="none" stroke="#ff6b8a" strokeWidth={3} strokeLinecap="round" />
        </g>
      );
    case "wavy":
      return <path d="M127 110q4 -5 8 0t8 0t8 0" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />;
    case "smirk":
      return <path d="M131 111Q142 113 152 102" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />;
    case "pant":
      return <ellipse cx={141} cy={110} rx={5.5} ry={7} fill={MOUTH} stroke={INK} strokeWidth={3} />;
    default:
      return <path d="M131 109Q141 106 150 108" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />;
  }
}

function Nose({ p }: { p: Palette }): JSX.Element {
  return <path d="M150 87Q163 97 151 102" fill={p.skin} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round" />;
}

// ------------------------------------------------------------------ heads

function spikes(seed: number, r: number): string {
  const [cx, cy] = HC;
  const pts: string[] = [];
  const from = 150;
  const to = 318;
  const n = 7;
  for (let i = 0; i <= n * 2; i++) {
    const a = ((from + ((to - from) * i) / (n * 2)) * Math.PI) / 180;
    const jitter = ((seed >>> (i % 24)) & 7) - 3;
    const rr = i % 2 === 0 ? r - 4 : r + 15 + jitter;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}

function HeadShade({ r }: { r: number }): JSX.Element {
  const [cx, cy] = HC;
  return (
    <>
      <path d={`M${cx} ${cy - r}A${r} ${r} 0 0 0 ${cx} ${cy + r}A${r * 0.62} ${r} 0 0 1 ${cx} ${cy - r}Z`} fill={SHADE} />
      <ellipse cx={cx + 18} cy={cy - 24} rx={9} ry={5} transform={`rotate(30 ${cx + 18} ${cy - 24})`} fill={HI} />
    </>
  );
}

function Ear({ p }: { p: Palette }): JSX.Element {
  return (
    <g>
      <ellipse cx={96} cy={90} rx={8} ry={10} fill={p.skin} {...outline} strokeWidth={3.5} />
      <path d="M94 85Q99 90 95 96" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
    </g>
  );
}

function Tails({ c, p1, p2 }: { c: string; p1: string; p2: string }): JSX.Element {
  return (
    <g className={styles.flutter}>
      <path d={`${p1}${p2}`} fill="none" stroke={INK} strokeWidth={13} strokeLinecap="round" />
      <path d={`${p1}${p2}`} fill="none" stroke={c} strokeWidth={6.5} strokeLinecap="round" />
    </g>
  );
}

function Head({ style, p, eye, mouth, seed, id }: { style: FighterStyle; p: Palette; eye: EyeMode; mouth: MouthMode; seed: number; id: string }): JSX.Element {
  const [cx, cy] = HC;
  const face = (
    <>
      <Eyes mode={eye} p={p} id={id} />
      <Nose p={p} />
      <ellipse cx={136} cy={101} rx={6} ry={3} fill="rgba(255,80,120,0.28)" />
      <Mouth mode={mouth} />
    </>
  );

  switch (style) {
    case "karate":
      return (
        <g>
          <Tails c={p.accent} p1="M80 68Q60 62 40 74" p2="M80 72Q62 80 50 98" />
          <path d={spikes(seed, 40)} fill={p.hair} {...outline} />
          <circle cx={cx} cy={cy} r={40} fill={p.skin} {...outline} />
          <HeadShade r={40} />
          <Ear p={p} />
          <path d="M76 80A40 40 0 0 1 150 66Q120 58 98 70Q86 78 84 92Z" fill={p.hair} {...outline} strokeWidth={3} />
          {face}
          <path d="M76 70Q114 46 152 66" fill="none" stroke={INK} strokeWidth={17} strokeLinecap="butt" />
          <path d="M76 70Q114 46 152 66" fill="none" stroke={p.accent} strokeWidth={10} strokeLinecap="butt" />
          <path d="M100 58Q114 52 128 54" fill="none" stroke={HI} strokeWidth={3} strokeLinecap="round" />
          <circle cx={79} cy={70} r={7} fill={p.accent} {...outline} strokeWidth={3.5} />
        </g>
      );
    case "boxer":
      return (
        <g>
          <circle cx={cx} cy={cy} r={40} fill={p.skin} {...outline} />
          <HeadShade r={40} />
          <path d="M76 84Q70 44 108 42Q146 38 152 64Q150 70 146 70Q126 56 96 62Q86 70 84 88Z" fill={p.hair} {...outline} strokeWidth={3.5} />
          <path d="M92 50Q110 44 134 48" fill="none" stroke={HI} strokeWidth={3} strokeLinecap="round" />
          <Ear p={p} />
          {face}
          <g transform="rotate(-24 142 60)">
            <rect x={133} y={56} width={18} height={8} rx={3} fill="#f3d9a8" stroke={INK} strokeWidth={2.2} />
            <path d="M140 58L140 62M144 58L144 62" stroke={INK} strokeWidth={1.2} />
          </g>
        </g>
      );
    case "ninja":
      return (
        <g>
          <Tails c={p.accent} p1="M80 70Q58 60 36 70" p2="M80 74Q62 84 48 104" />
          <circle cx={cx} cy={cy} r={40} fill={p.gi} {...outline} />
          <HeadShade r={40} />
          <path d="M112 72Q112 70 118 70L150 70Q156 76 154 88Q152 98 148 100L118 100Q112 100 112 94Z" fill={p.skin} {...outline} strokeWidth={3} />
          <Eyes mode={eye} p={p} id={id} />
          <path d="M152 100Q128 106 112 100" fill="none" stroke={INK} strokeWidth={3} />
          <path d="M78 60Q114 38 150 58" fill="none" stroke={INK} strokeWidth={14} />
          <path d="M78 60Q114 38 150 58" fill="none" stroke={p.accent} strokeWidth={7} />
          <rect x={120} y={43} width={20} height={13} rx={3} fill="#c7d2e2" stroke={INK} strokeWidth={2.5} transform="rotate(12 130 50)" />
          <circle cx={79} cy={71} r={7} fill={p.accent} {...outline} strokeWidth={3.5} />
        </g>
      );
    case "sumo":
      return (
        <g>
          <circle cx={cx} cy={cy + 2} r={42} fill={p.skin} {...outline} />
          <HeadShade r={40} />
          <path d="M74 92Q66 48 110 42Q144 38 154 62Q126 52 100 62Q86 70 84 96Z" fill={p.hair} {...outline} strokeWidth={3.5} />
          <ellipse cx={108} cy={38} rx={17} ry={8} transform="rotate(-12 108 38)" fill={p.hair} {...outline} strokeWidth={3.5} />
          <path d="M108 30L112 46" stroke={p.trim} strokeWidth={4} strokeLinecap="round" />
          <Ear p={p} />
          {face}
          <ellipse cx={144} cy={106} rx={9} ry={6} fill="rgba(255,80,120,0.22)" />
        </g>
      );
    case "monk":
      return (
        <g>
          <circle cx={cx} cy={cy} r={40} fill={p.skin} {...outline} />
          <HeadShade r={40} />
          <ellipse cx={128} cy={54} rx={14} ry={7} transform="rotate(20 128 54)" fill="rgba(255,255,255,0.5)" />
          {[
            [118, 58],
            [128, 56],
            [138, 58],
            [123, 64],
            [133, 64],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={2.2} fill={INK} opacity={0.75} />
          ))}
          <Ear p={p} />
          <ellipse cx={96} cy={100} rx={5} ry={6} fill={p.skin} stroke={INK} strokeWidth={3} />
          {face}
        </g>
      );
    case "robot":
      return (
        <g>
          <line x1={104} y1={48} x2={96} y2={20} stroke={INK} strokeWidth={8} strokeLinecap="round" />
          <line x1={104} y1={48} x2={96} y2={20} stroke={p.trim} strokeWidth={3.5} strokeLinecap="round" />
          <circle className={styles.blink} cx={96} cy={18} r={7} fill={p.accent} stroke={INK} strokeWidth={3} />
          <rect x={76} y={46} width={78} height={74} rx={20} fill={p.gi} {...outline} />
          <path d="M96 47L90 47Q77 47 77 66L77 100Q77 119 96 119L100 119Q88 100 90 66Q91 52 96 47Z" fill={SHADE} />
          <rect x={128} y={52} width={16} height={6} rx={3} fill={HI} />
          <circle cx={86} cy={88} r={8} fill={p.trim} stroke={INK} strokeWidth={3} />
          <path d="M104 70Q104 66 110 66L150 66Q158 66 158 76L158 90Q158 100 150 100L110 100Q104 100 104 94Z" fill="#0b0a14" {...outline} strokeWidth={3.5} />
          <RobotEyes mode={eye} p={p} id={id} />
          <path d="M116 110L146 110M118 114L144 114" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
        </g>
      );
  }
}

function RobotEyes({ mode, p, id }: { mode: EyeMode; p: Palette; id: string }): JSX.Element {
  const c = mode === "fierce" ? p.aura : p.accent;
  let d = "M113 80L127 84L127 89L113 87ZM149 80L135 84L135 89L149 87Z";
  if (mode === "squint") d = "M114 78L126 84L114 90M148 78L136 84L148 90";
  if (mode === "xx") d = "M114 78L126 90M126 78L114 90M136 78L148 90M148 78L136 90";
  if (mode === "sparkle") d = "M113 88Q120 76 127 88M135 88Q142 76 149 88";
  const stroke = mode === "squint" || mode === "xx" || mode === "sparkle";
  return (
    <g filter={`url(#${id}-glow)`}>
      <path d={d} fill={stroke ? "none" : c} stroke={stroke ? c : "none"} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      {mode === "sparkle" && <path className={styles.twinkle} d={star4(160, 64, 7)} fill="#ffd23f" stroke={INK} strokeWidth={1.5} />}
    </g>
  );
}

// ------------------------------------------------------------------ the fighter

export default function Fighter({ def, pose, side, hp, action, className, style }: FighterProps): JSX.Element {
  const rawId = useId();
  const id = `ff${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const p = def.palette;
  const st = def.style;
  const lk = lookFor(st, p);
  const weak = hp < 30 && pose !== "ko";
  const eye = eyeFor(pose);
  const mouth = mouthFor(pose, weak);
  const seq = action ? action.seq : 0;
  // Remount the animated tree on each new action so one-shots replay even if the pose repeats.
  const animKey = ONE_SHOT.has(pose) ? `${pose}-${seq}` : pose;
  const showSweat = pose === "stumble" || pose === "hurt" || (weak && (pose === "idle" || pose === "walk"));
  const showAura = pose === "special" || pose === "victory";

  const rootStyle = { ...style, "--f-aura": p.aura, "--f-accent": p.accent } as CSSProperties;

  let extras: ReactNode = null;
  if (pose === "victory") {
    extras = (
      <g className={styles.sparkles}>
        <path className={styles.twinkle} d={star4(52, 60, 10)} fill="#ffd23f" stroke={INK} strokeWidth={2} />
        <path className={styles.twinkle2} d={star4(176, 40, 8)} fill="#fff" stroke={INK} strokeWidth={2} />
        <path className={styles.twinkle3} d={star4(186, 96, 6)} fill={p.aura} stroke={INK} strokeWidth={2} />
      </g>
    );
  }

  return (
    <div
      className={`${styles.root}${className ? ` ${className}` : ""}`}
      style={rootStyle}
      data-pose={pose}
      data-side={side}
      data-style={st}
      data-weak={weak ? "true" : "false"}
      role="img"
      aria-label={`${def.name} (${st}) — ${pose}`}
    >
      <div className={styles.mirror}>
        <svg className={styles.svg} key={`svg-${animKey}`} viewBox="0 0 220 320" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <filter id={`${id}-glow`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id={`${id}-blur`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="9" />
            </filter>
            <radialGradient id={`${id}-orb`}>
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="35%" stopColor="#ffffff" />
              <stop offset="55%" stopColor={p.aura} />
              <stop offset="100%" stopColor={p.aura} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`${id}-shadow`}>
              <stop offset="0%" stopColor="#000" stopOpacity="0.7" />
              <stop offset="70%" stopColor="#000" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#000" stopOpacity="0" />
            </radialGradient>
          </defs>

          <ellipse className={styles.shadow} cx={112} cy={300} rx={70} ry={11} fill={`url(#${id}-shadow)`} />

          {showAura && (
            <g className={styles.aura}>
              <ellipse cx={112} cy={180} rx={78} ry={128} fill={p.aura} opacity={0.55} filter={`url(#${id}-blur)`} />
              <ellipse cx={112} cy={296} rx={78} ry={12} fill="none" stroke={p.aura} strokeWidth={4} opacity={0.9} />
              <path d="M60 280Q52 200 78 120M166 280Q176 200 150 116M112 290Q100 200 118 70" fill="none" stroke="#fff" strokeWidth={3} opacity={0.5} strokeLinecap="round" />
            </g>
          )}

          <g className={styles.actor}>
            <Leg hip={HIP_B} knee={KN_B} foot={FT_B} lk={lk} style={st} p={p} front={false} />
            <Leg hip={HIP_F} knee={KN_F} foot={FT_F} lk={lk} style={st} p={p} front />
            <g className={styles.upper}>
              <Seg a={[110, 112]} b={[112, 136]} w={lk.neckW} c={lk.neck} />
              {st === "ninja" && (
                <g>
                  <Tails c={p.accent} p1="M98 132Q76 128 58 140" p2="M98 134Q80 146 66 160" />
                  <path d="M92 124Q114 136 136 122L138 136Q114 146 90 136Z" fill={p.accent} {...outline} strokeWidth={3.5} />
                </g>
              )}
              <Torso style={st} p={p} />
              <Arm sh={SH_B} el={EL_B} fs={FS_B} lk={lk} style={st} p={p} front={false} />
              <g className={styles.head}>
                <Head style={st} p={p} eye={eye} mouth={mouth} seed={def.seed} id={id} />
                {showSweat && (
                  <path className={styles.sweat} d="M82 52Q74 64 78 70Q84 74 88 68Q90 62 82 52Z" fill="#9af3ff" stroke={INK} strokeWidth={2.5} />
                )}
              </g>
              <Arm sh={SH_F} el={EL_F} fs={FS_F} lk={lk} style={st} p={p} front />
              {pose === "block" && (
                <ellipse className={styles.shield} cx={200} cy={140} rx={18} ry={64} fill="none" stroke={p.accent} strokeWidth={5} />
              )}
            </g>
          </g>

          {extras}

          {pose === "special" && (
            <g className={styles.orb}>
              <ellipse cx={176} cy={146} rx={34} ry={14} fill={p.aura} opacity={0.35} filter={`url(#${id}-blur)`} />
              <circle cx={214} cy={146} r={30} fill={`url(#${id}-orb)`} />
              <circle className={styles.orbRing} cx={214} cy={146} r={18} fill="none" stroke={p.aura} strokeWidth={4} strokeDasharray="10 7" />
              <circle cx={214} cy={146} r={9} fill="#fff" />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
