"use client";

import { useLayoutEffect, useRef } from "react";
import type { JSX } from "react";
import type { BattleState } from "@/lib/battle/types";
import styles from "./Ticker.module.css";

export interface TickerProps {
  feed: BattleState["feed"];
}

const VISIBLE = 14;

export default function Ticker({ feed }: TickerProps): JSX.Element {
  const items = feed.slice(-VISIBLE);
  const newest = items.length ? items[items.length - 1].seq : -1;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const lastRef = useRef<HTMLSpanElement | null>(null);
  const prevNewest = useRef<number>(-1);

  // FLIP: when a new line lands, slide the whole track in from the right by the new item's width.
  useLayoutEffect(() => {
    if (newest === prevNewest.current) return;
    const first = prevNewest.current === -1;
    prevNewest.current = newest;
    const track = trackRef.current;
    const last = lastRef.current;
    if (first || !track || !last || typeof track.animate !== "function") return;
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    } catch {
      /* ignore */
    }
    const w = last.offsetWidth + 28;
    track.animate([{ transform: `translateX(${w}px)` }, { transform: "translateX(0)" }], {
      duration: 650,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    });
  }, [newest]);

  return (
    <div className={styles.ticker} role="log" aria-live="polite" aria-label="Commentary">
      <div className={styles.label}>
        <span className={styles.liveDot} aria-hidden />
        LIVE
      </div>
      <div className={styles.window}>
        {items.length === 0 ? (
          <div className={styles.empty}>AWAITING CHALLENGERS · INSERT PROMPT TO BEGIN</div>
        ) : (
          <div className={styles.track} ref={trackRef}>
            {items.map((it, i) => {
              const isNew = it.seq === newest;
              return (
                <span
                  key={it.seq}
                  ref={isNew ? lastRef : undefined}
                  className={`${styles.item} ${styles[`tone_${it.tone}`]} ${isNew ? styles.newest : ""}`}
                  style={{ opacity: isNew ? 1 : Math.max(0.35, 1 - (items.length - 1 - i) * 0.07) }}
                >
                  <span className={styles.dot} aria-hidden />
                  {it.text}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
