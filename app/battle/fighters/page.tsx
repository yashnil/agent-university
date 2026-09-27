"use client";

// FLOW FIGHTER — fighter gallery: every style x every pose, plus a versus preview. Dev/demo page.

import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import Fighter from "@/components/battle/Fighter";
import { PALETTES, STYLES, fixtureFighters } from "@/lib/battle/fighters";
import type { FightAction, FighterDef, Pose } from "@/lib/battle/types";
import styles from "./page.module.css";

const POSES: Pose[] = ["idle", "walk", "punch", "kick", "special", "hurt", "block", "stumble", "ko", "victory", "taunt"];
const PAL_FOR: Record<string, number> = { karate: 0, boxer: 3, ninja: 4, sumo: 9, monk: 2, robot: 5 };

function styleRoster(): FighterDef[] {
  return STYLES.map((style, i) => ({
    id: `demo/${style}`,
    name: `${style.toUpperCase()} FLOW`,
    title: `Demo ${style}`,
    shortId: `0000000${i}`,
    source: "fixture",
    rank: null,
    style,
    palette: PALETTES[PAL_FOR[style] ?? i],
    seed: 0x9e3779b1 * (i + 1),
    catchphrase: "",
  }));
}

export default function FighterGallery(): JSX.Element {
  const roster = useMemo(styleRoster, []);
  const fixtures = useMemo(() => fixtureFighters(), []);
  const [seq, setSeq] = useState(1);
  const [auto, setAuto] = useState(true);
  const [weak, setWeak] = useState(false);
  const [left, setLeft] = useState<Pose>("idle");
  const [right, setRight] = useState<Pose>("idle");
  const [scale, setScale] = useState(1);
  // ?t=0.3 freezes every animation at 0.3s (for screenshots / tuning poses).
  const [freeze, setFreeze] = useState<number | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (t !== null && Number.isFinite(Number(t))) {
      setFreeze(Number(t));
      setAuto(false);
    }
  }, []);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setSeq((s) => s + 1), 1800);
    return () => clearInterval(t);
  }, [auto]);

  const action: FightAction = { seq, kind: "announce", duration: 1000 };
  const hp = weak ? 18 : 100;
  const a = fixtures[0] ?? roster[0];
  const b = fixtures[1] ?? roster[5];

  const play = (l: Pose, r: Pose) => {
    setLeft(l);
    setRight(r);
    setSeq((s) => s + 1);
  };

  return (
    <main className={styles.page}>
      {freeze !== null && (
        <style>{`.${styles.page} * { animation-play-state: paused !important; animation-delay: -${freeze}s !important; }`}</style>
      )}
      <header className={styles.head}>
        <h1 className={styles.title}>FIGHTER GALLERY</h1>
        <div className={styles.controls}>
          <button className={styles.btn} onClick={() => setSeq((s) => s + 1)}>REPLAY</button>
          <label className={styles.toggle}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> AUTO
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={weak} onChange={(e) => setWeak(e.target.checked)} /> LOW HP
          </label>
          <label className={styles.toggle}>
            SCALE
            <input type="range" min={0.6} max={1.5} step={0.1} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
            {scale.toFixed(1)}x
          </label>
        </div>
      </header>

      <section className={styles.versus} key={`v${freeze}`}>
        <div className={styles.floor} />
        <div className={styles.slot} style={{ ["--fighter-w" as string]: `min(${220 * scale}px, 38vw)` }}>
          <Fighter def={a} pose={left} side="left" hp={hp} action={{ ...action }} />
          <span className={styles.name}>{a.name}</span>
        </div>
        <div className={styles.slot} style={{ ["--fighter-w" as string]: `min(${220 * scale}px, 38vw)` }}>
          <Fighter def={b} pose={right} side="right" hp={hp} action={{ ...action }} />
          <span className={styles.name}>{b.name}</span>
        </div>
      </section>
      <div className={styles.combos}>
        <button className={styles.btn} onClick={() => play("punch", "hurt")}>PUNCH → HURT</button>
        <button className={styles.btn} onClick={() => play("kick", "block")}>KICK → BLOCK</button>
        <button className={styles.btn} onClick={() => play("special", "hurt")}>SPECIAL</button>
        <button className={styles.btn} onClick={() => play("stumble", "taunt")}>WHIFF</button>
        <button className={styles.btn} onClick={() => play("victory", "ko")}>K.O.</button>
        <button className={styles.btn} onClick={() => play("walk", "walk")}>WALK</button>
        <button className={styles.btn} onClick={() => play("idle", "idle")}>RESET</button>
      </div>

      <section className={styles.gridWrap} key={`g${freeze}`}>
        <div className={styles.grid} style={{ gridTemplateColumns: `120px repeat(${POSES.length}, 132px)` }}>
          <div />
          {POSES.map((p) => (
            <div key={p} className={styles.colHead}>{p.toUpperCase()}</div>
          ))}
          {roster.map((def) => (
            <Row key={def.id} def={def} action={action} hp={hp} />
          ))}
        </div>
      </section>
    </main>
  );
}

function Row({ def, action, hp }: { def: FighterDef; action: FightAction; hp: number }): JSX.Element {
  return (
    <>
      <div className={styles.rowHead}>{def.style.toUpperCase()}</div>
      {POSES.map((p) => (
        <div key={p} className={styles.cell}>
          <Fighter def={def} pose={p} side="left" hp={hp} action={action} style={{ ["--fighter-w" as string]: "92px" }} />
        </div>
      ))}
    </>
  );
}
