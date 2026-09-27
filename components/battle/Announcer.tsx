"use client";

import { useEffect, useState } from "react";
import type { CSSProperties, JSX } from "react";
import type { Banner, BattleState } from "@/lib/battle/types";
import styles from "./Announcer.module.css";

export interface AnnouncerProps {
  banner: Banner | null;
  referee: BattleState["referee"];
}

function norm(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function BannerView({ banner }: { banner: Banner }): JSX.Element {
  const key = norm(banner.text);
  const special = key === "FIGHT" ? "fight" : key === "KO" ? "ko" : null;
  const len = Math.max(4, banner.text.length);
  const chars = Array.from(banner.text);
  const cls = [styles.banner, styles[`tone_${banner.tone}`], special ? styles[special] : ""].join(" ");
  return (
    <div className={cls} style={{ ["--len" as string]: String(len) } as CSSProperties} role="status" aria-live="assertive">
      {special === "fight" && <div className={styles.shockwave} aria-hidden />}
      {special === "ko" && <div className={styles.koFlash} aria-hidden />}
      <div className={styles.textWrap}>
        <h2 className={styles.text} data-text={banner.text}>
          {special === "ko"
            ? chars.map((c, i) => (
                <span key={i} className={styles.koChar} style={{ animationDelay: `${i * 110}ms` }}>
                  {c}
                </span>
              ))
            : banner.text}
        </h2>
      </div>
      {banner.sub && <p className={styles.sub}>{banner.sub}</p>}
    </div>
  );
}

function useTypewriter(line: string | null, speedMs = 26): string {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!line) {
      setN(0);
      return;
    }
    if (prefersReducedMotion()) {
      setN(line.length);
      return;
    }
    setN(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setN(i);
      if (i >= line.length) window.clearInterval(id);
    }, speedMs);
    return () => window.clearInterval(id);
  }, [line, speedMs]);
  return line ? line.slice(0, n) : "";
}

function RefereePortrait(): JSX.Element {
  return (
    <svg className={styles.portrait} viewBox="0 0 64 72" aria-hidden>
      <defs>
        <pattern id="jev-stripes" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#f4f1ea" />
          <rect width="4" height="8" fill="#111018" />
        </pattern>
        <radialGradient id="jev-bg" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#2a1f4a" />
          <stop offset="100%" stopColor="#0b0916" />
        </radialGradient>
      </defs>
      <rect width="64" height="72" fill="url(#jev-bg)" />
      {/* shirt */}
      <path d="M6 72 C8 56 18 50 32 50 C46 50 56 56 58 72 Z" fill="url(#jev-stripes)" stroke="#07060d" strokeWidth="1.5" />
      {/* collar */}
      <path d="M24 50 L32 58 L40 50 L36 49 L32 53 L28 49 Z" fill="#f4f1ea" stroke="#07060d" strokeWidth="1" />
      {/* neck */}
      <rect x="27" y="42" width="10" height="9" rx="3" fill="#e8b58c" />
      {/* bow tie */}
      <path d="M32 55 L23 50 L23 60 Z" fill="#ff3d7f" stroke="#07060d" strokeWidth="1" />
      <path d="M32 55 L41 50 L41 60 Z" fill="#ff3d7f" stroke="#07060d" strokeWidth="1" />
      <rect x="29.5" y="52.5" width="5" height="5" rx="1" fill="#c72a60" stroke="#07060d" strokeWidth="1" />
      {/* whistle */}
      <path d="M44 60 q2 -6 -2 -10" fill="none" stroke="#2de2ff" strokeWidth="1" />
      <rect x="42" y="60" width="7" height="4" rx="2" fill="#ffd23f" stroke="#07060d" strokeWidth="0.8" />
      {/* head */}
      <ellipse cx="32" cy="28" rx="14" ry="16" fill="#f0c29c" stroke="#07060d" strokeWidth="1.5" />
      {/* ears */}
      <ellipse cx="18" cy="30" rx="2.5" ry="4" fill="#e8b58c" stroke="#07060d" strokeWidth="1" />
      <ellipse cx="46" cy="30" rx="2.5" ry="4" fill="#e8b58c" stroke="#07060d" strokeWidth="1" />
      {/* hair / flat-top */}
      <path d="M17 24 C17 10 26 9 32 9 C38 9 47 10 47 24 L44 18 L40 20 L36 16 L32 19 L28 16 L24 20 L20 18 Z" fill="#3a2a22" stroke="#07060d" strokeWidth="1" />
      {/* brows */}
      <path d="M23 24 L29 25.5" stroke="#2a1d17" strokeWidth="2" strokeLinecap="round" />
      <path d="M41 24 L35 25.5" stroke="#2a1d17" strokeWidth="2" strokeLinecap="round" />
      {/* eyes */}
      <rect x="24.5" y="27.5" width="3.5" height="3" rx="1" fill="#07060d" />
      <rect x="36" y="27.5" width="3.5" height="3" rx="1" fill="#07060d" />
      <rect x="25.3" y="27.9" width="1.2" height="1.1" fill="#fff" />
      <rect x="36.8" y="27.9" width="1.2" height="1.1" fill="#fff" />
      {/* nose + mustache + mouth */}
      <path d="M32 29 L30.5 35 L33 35" fill="none" stroke="#b8805c" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M25 38 C28 35.5 31 37 32 37.5 C33 37 36 35.5 39 38 C36 39.5 33 39 32 38.6 C31 39 28 39.5 25 38 Z" fill="#3a2a22" />
      <path d="M29 41 Q32 42.5 35 41" fill="none" stroke="#7a3b2e" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function Referee({ referee }: { referee: NonNullable<BattleState["referee"]> }): JSX.Element {
  const typed = useTypewriter(referee.line);
  const typing = !!referee.line && typed.length < referee.line.length;
  return (
    <div className={styles.referee}>
      <div className={styles.portraitFrame}>
        <RefereePortrait />
        <div className={styles.badge}>
          <span className={styles.badgeName}>JEV</span>
          {referee.model && <span className={styles.badgeModel}>{referee.model}</span>}
        </div>
      </div>
      {(referee.line || referee.status) && (
        <div className={styles.bubble} key={referee.line ?? referee.status ?? ""}>
          {referee.status && <div className={styles.status}>{referee.status}</div>}
          {referee.line && (
            <p className={styles.line}>
              {typed}
              <span className={typing ? styles.caretTyping : styles.caret} aria-hidden>
                ▌
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Announcer({ banner, referee }: AnnouncerProps): JSX.Element {
  return (
    <div className={styles.root}>
      {banner && banner.text && (
        <div className={styles.center}>
          <BannerView key={`${banner.text}|${banner.sub ?? ""}|${banner.tone}`} banner={banner} />
        </div>
      )}
      {referee && <Referee referee={referee} />}
    </div>
  );
}
