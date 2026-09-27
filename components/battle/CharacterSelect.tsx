"use client";

import type { CSSProperties, JSX } from "react";
import type { BattleSpec, FighterDef } from "@/lib/battle/types";
import styles from "./CharacterSelect.module.css";

export interface CharacterSelectProps {
  fighters: FighterDef[];
  spec: BattleSpec | null;
}

function sourceText(f: FighterDef): string {
  if (f.source === "recall") return f.rank != null ? `MEMORABLE RANK #${f.rank}` : "MEMORABLE RECALL";
  if (f.source === "given") return "HAND PICKED";
  return "FIXTURE";
}

/** Small self-contained head portrait in the fighter's palette (no dependency on Fighter.tsx). */
export function MiniHead({ def, size = 96 }: { def: FighterDef; size?: number }): JSX.Element {
  const p = def.palette;
  const s = def.style;
  const gid = `mh-${def.shortId}-${def.seed >>> 0}`;
  const brow = (def.seed & 1) === 0 ? -4 : -2;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${def.name} portrait`} className={styles.head}>
      <defs>
        <radialGradient id={`${gid}-aura`} cx="50%" cy="55%" r="55%">
          <stop offset="0%" stopColor={p.aura} stopOpacity="0.55" />
          <stop offset="100%" stopColor={p.aura} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${gid}-skin`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.skin} />
          <stop offset="100%" stopColor={p.skin} stopOpacity="0.82" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="55" r="48" fill={`url(#${gid}-aura)`} />
      {/* shoulders / outfit */}
      <path d="M14 100 Q18 78 50 76 Q82 78 86 100 Z" fill={p.gi} />
      <path d="M40 77 L50 92 L60 77" fill="none" stroke={p.trim} strokeWidth="4" />
      {/* neck */}
      <rect x="42" y="64" width="16" height="14" rx="3" fill={p.skin} />
      {/* back hair / topknot */}
      {s === "sumo" ? <ellipse cx="50" cy="16" rx="8" ry="6" fill={p.hair} /> : null}
      {s === "karate" ? <path d="M24 40 L18 18 L32 28 L36 10 L46 24 L54 8 L60 24 L70 12 L72 30 L84 22 L76 42 Z" fill={p.hair} /> : null}
      {/* face */}
      {s === "robot" ? (
        <rect x="26" y="24" width="48" height="46" rx="8" fill="#9aa3b5" stroke={p.trim} strokeWidth="3" />
      ) : (
        <ellipse cx="50" cy="46" rx={s === "sumo" ? 26 : 22} ry="25" fill={`url(#${gid}-skin)`} />
      )}
      {/* hair / hats */}
      {s === "boxer" ? <path d="M28 38 Q30 18 50 18 Q70 18 72 38 Q62 28 50 30 Q38 28 28 38 Z" fill={p.hair} /> : null}
      {s === "sumo" ? <path d="M25 40 Q26 20 50 20 Q74 20 75 40 Q64 30 50 31 Q36 30 25 40 Z" fill={p.hair} /> : null}
      {s === "monk" ? <ellipse cx="42" cy="30" rx="8" ry="4" fill="#fff" opacity="0.35" /> : null}
      {s === "ninja" ? <path d="M27 44 Q26 20 50 20 Q74 20 73 44 L73 72 Q50 78 27 72 Z" fill={p.gi} /> : null}
      {s === "ninja" ? <rect x="28" y="38" width="44" height="12" rx="4" fill={p.skin} /> : null}
      {/* headband */}
      {s === "karate" || s === "ninja" ? (
        <>
          <rect x="26" y="32" width="48" height="6" rx="2" fill={p.accent} />
          <path d="M74 34 L90 28 L86 38 L94 42 L74 38 Z" fill={p.accent} />
        </>
      ) : null}
      {s === "monk" ? (
        <g fill={p.accent}>
          <circle cx="50" cy="31" r="2.2" />
          <circle cx="44" cy="31.5" r="1.6" />
          <circle cx="56" cy="31.5" r="1.6" />
        </g>
      ) : null}
      {/* eyes */}
      {s === "robot" ? (
        <rect x="32" y="38" width="36" height="10" rx="3" fill={p.accent} className={styles.visor} />
      ) : (
        <g>
          <path d={`M34 ${42 + brow} L46 ${44 + brow}`} stroke={p.hair} strokeWidth="3" strokeLinecap="round" />
          <path d={`M66 ${42 + brow} L54 ${44 + brow}`} stroke={p.hair} strokeWidth="3" strokeLinecap="round" />
          <ellipse cx="41" cy="45" rx="3.4" ry="2.6" fill="#fff" />
          <ellipse cx="59" cy="45" rx="3.4" ry="2.6" fill="#fff" />
          <circle cx="42" cy="45" r="1.6" fill="#111" />
          <circle cx="60" cy="45" r="1.6" fill="#111" />
        </g>
      )}
      {/* mouth */}
      {s === "ninja" ? null : s === "robot" ? (
        <g stroke={p.trim} strokeWidth="2">
          <line x1="38" y1="60" x2="62" y2="60" />
          <line x1="44" y1="57" x2="44" y2="63" />
          <line x1="50" y1="57" x2="50" y2="63" />
          <line x1="56" y1="57" x2="56" y2="63" />
        </g>
      ) : (
        <path d="M42 59 Q50 63 58 58" stroke="#3a1a14" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      )}
      {s === "boxer" ? <path d="M44 52 Q50 55 56 52" stroke="#3a1a14" strokeWidth="1.5" fill="none" opacity="0.5" /> : null}
    </svg>
  );
}

function Card({ f, i, big, side }: { f: FighterDef; i: number; big?: boolean; side?: "left" | "right" }): JSX.Element {
  const style = {
    ["--accent" as string]: f.palette.accent,
    ["--aura" as string]: f.palette.aura,
    ["--gi" as string]: f.palette.gi,
    animationDelay: `${120 + i * 110}ms`,
  } as CSSProperties;
  const cls = [styles.card, big ? styles.big : "", side === "left" ? styles.fromLeft : side === "right" ? styles.fromRight : styles.fromBelow].join(" ");
  return (
    <article className={cls} style={style} title={f.title}>
      <div className={styles.portrait}>
        <div className={side === "right" ? styles.mirror : undefined}>
          <MiniHead def={f} size={big ? 150 : 84} />
        </div>
        <span className={styles.p}>{side === "right" ? "2P" : side === "left" ? "1P" : `#${i + 1}`}</span>
      </div>
      <div className={styles.info}>
        <h3 className={styles.name}>{f.name}</h3>
        <div className={styles.meta}>
          <span className={styles.style}>{f.style.toUpperCase()}</span>
          <span className={styles.id}>{f.shortId}</span>
        </div>
        <div className={styles.source}>{sourceText(f)}</div>
        {big ? <p className={styles.flowTitle}>{f.title}</p> : null}
        <p className={styles.catch}>“{f.catchphrase}”</p>
      </div>
    </article>
  );
}

export default function CharacterSelect({ fighters, spec }: CharacterSelectProps): JSX.Element {
  const a = fighters[0];
  const b = fighters[1];
  const rest = fighters.slice(2);
  return (
    <section className={styles.select} aria-label="Character select">
      <div className={styles.bgGrid} aria-hidden="true" />
      <header className={styles.top}>
        <div className={styles.pick}>SELECT YOUR FLOW</div>
        {spec ? (
          <div className={styles.marquee}>
            <div className={styles.track}>
              <span>{spec.title}</span>
              <span aria-hidden="true">{spec.title}</span>
            </div>
          </div>
        ) : null}
      </header>

      {fighters.length === 0 ? (
        <div className={styles.empty}>WAITING FOR CHALLENGERS…</div>
      ) : (
        <div className={styles.versus}>
          {a ? <Card f={a} i={0} big side="left" /> : null}
          {b ? (
            <>
              <div className={styles.vs} aria-label="versus">
                <svg viewBox="0 0 120 200" className={styles.bolt} aria-hidden="true">
                  <path d="M70 0 L22 108 L58 108 L38 200 L100 78 L62 78 L88 0 Z" />
                </svg>
                <span className={styles.vsText}>VS</span>
              </div>
              <Card f={b} i={1} big side="right" />
            </>
          ) : null}
        </div>
      )}

      {rest.length ? (
        <>
          <div className={styles.nextLabel}>NEXT CHALLENGERS</div>
          <div className={styles.grid}>
            {rest.map((f, k) => (
              <Card key={f.id} f={f} i={k + 2} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
