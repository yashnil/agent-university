"use client";

import type { CSSProperties, JSX } from "react";
import type { Banner, FighterState, Side } from "@/lib/battle/types";
import styles from "./HUD.module.css";

export interface HUDProps {
  left: FighterState | null;
  right: FighterState | null;
  round: number;
  banner: Banner | null;
  dry: boolean;
  flowOf?: (id: string) => number | null; // 1-based flow number, shown under the name
}

function hpColor(hp: number): string {
  if (hp > 60) return "#ffd23f";
  if (hp > 35) return "#ff9f1c";
  return "#ff5a5a";
}

function sourceBadge(f: FighterState): { text: string; cls: string } {
  const d = f.def;
  if (d.source === "recall") return { text: d.rank != null ? `MEMORABLE #${d.rank}` : "MEMORABLE", cls: styles.srcRecall };
  if (d.source === "given") return { text: "GIVEN", cls: styles.srcGiven };
  return { text: "SIM", cls: styles.srcSim };
}

function Pips({ f, side }: { f: FighterState; side: Side }): JSX.Element {
  const total = Math.max(f.runs, 3);
  const pips: JSX.Element[] = [];
  let c = f.certified;
  let x = f.failed;
  for (let i = 0; i < total; i++) {
    if (c > 0) {
      c--;
      pips.push(<span key={i} className={`${styles.pip} ${styles.pipOk}`} title="certified">●</span>);
    } else if (x > 0) {
      x--;
      pips.push(<span key={i} className={`${styles.pip} ${styles.pipFail}`} title="failed">✕</span>);
    } else {
      pips.push(<span key={i} className={`${styles.pip} ${styles.pipPending}`} title="pending">○</span>);
    }
  }
  return <div className={`${styles.pips} ${side === "right" ? styles.pipsRight : ""}`}>{pips}</div>;
}

function Plate({ f, side, flowNo }: { f: FighterState | null; side: Side; flowNo?: number | null }): JSX.Element {
  const sideCls = side === "left" ? styles.sideLeft : styles.sideRight;
  if (!f) {
    return (
      <div className={`${styles.plate} ${sideCls} ${styles.empty}`}>
        <div className={styles.nameRow}>
          <span className={`${styles.portrait} ${styles.portraitEmpty}`} />
          <span className={styles.name}>{side === "left" ? "P1" : "P2"} · WAITING</span>
        </div>
        <div className={styles.barFrame}>
          <div className={styles.barTrack} />
        </div>
      </div>
    );
  }
  const hp = Math.max(0, Math.min(100, f.hp));
  const p = f.def.palette;
  const badge = sourceBadge(f);
  const low = hp > 0 && hp < 25;
  const barStyle = {
    ["--hp" as string]: String(hp / 100),
    ["--hp-color" as string]: hpColor(hp),
  } as CSSProperties;
  const portraitStyle = {
    background: `radial-gradient(circle at 50% 62%, ${p.skin} 0 38%, transparent 39%), linear-gradient(180deg, ${p.hair} 0 34%, ${p.gi} 34% 100%)`,
    borderColor: p.accent,
    boxShadow: `0 0 10px ${p.aura}, inset 0 0 0 2px ${p.trim}`,
  } as CSSProperties;
  return (
    <div className={`${styles.plate} ${sideCls} ${f.eliminated ? styles.out : ""}`}>
      <div className={styles.nameRow}>
        <span className={styles.portrait} style={portraitStyle} />
        <span className={styles.name} title={f.def.title}>
          {f.def.name}
        </span>
        <span className={styles.shortId}>{f.def.shortId}</span>
        <span className={`${styles.badge} ${badge.cls}`}>{badge.text}</span>
      </div>
      <div className={styles.flowLine} title={f.def.id}>
        {flowNo ? `FLOW ${flowNo} · ` : ""}{f.def.title}
      </div>
      <div className={`${styles.barFrame} ${low ? styles.low : ""}`} style={barStyle}>
        <div className={styles.barTrack}>
          <div className={styles.ghost} />
          <div className={styles.fill} />
          <div className={styles.shine} />
        </div>
      </div>
      <div className={styles.under}>
        <Pips f={f} side={side} />
        {f.combo > 1 && <span className={styles.comboSmall}>{f.combo} HIT</span>}
      </div>
      {f.lastRule && f.failed > 0 && (
        <div key={`${f.lastRule}-${f.failed}`} className={styles.rule}>
          ✕ {f.lastRule}
        </div>
      )}
    </div>
  );
}

export default function HUD({ left, right, round, banner, dry, flowOf }: HUDProps): JSX.Element {
  const lc = left?.combo ?? 0;
  const rc = right?.combo ?? 0;
  let center: JSX.Element;
  if (banner?.tone === "ko") {
    center = <span className={`${styles.timerText} ${styles.ko}`}>KO</span>;
  } else if (lc > 1 || rc > 1) {
    center = (
      <span className={styles.combo}>
        <span className={lc > 1 ? styles.comboOn : styles.comboOff}>{lc > 1 ? lc : "-"}</span>
        <span className={styles.comboX}>COMBO</span>
        <span className={rc > 1 ? styles.comboOn : styles.comboOff}>{rc > 1 ? rc : "-"}</span>
      </span>
    );
  } else {
    center = <span className={styles.timerText}>VS</span>;
  }
  return (
    <div className={styles.hud} aria-label="Battle HUD">
      <Plate f={left} side="left" flowNo={left ? flowOf?.(left.def.id) : null} />
      <div className={styles.center}>
        <span className={`${styles.mode} ${dry ? styles.modeDry : styles.modeLive}`}>{dry ? "DRY RUN" : "● LIVE"}</span>
        <div className={styles.timer}>{center}</div>
        <span className={styles.round}>R{Math.max(1, round)}</span>
      </div>
      <Plate f={right} side="right" flowNo={right ? flowOf?.(right.def.id) : null} />
    </div>
  );
}
