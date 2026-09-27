"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, JSX, KeyboardEvent } from "react";
import type { BattleSpec } from "@/lib/battle/types";
import styles from "./PromptConsole.module.css";

export interface PromptConsoleProps {
  onStart: (p: string) => void;
  busy: boolean;
  lastSpec: BattleSpec | null;
}

export const EXAMPLE_PROMPTS: string[] = [
  "3 flows, 3 agents each on Vercel, Stripe and Supabase — dry run",
  "2 flows x 2 agents, Stripe only, fast",
  "live: 3 flows, 2 agents each, Vercel and Supabase",
  "5 flows 1 agent dramatic",
];

export default function PromptConsole({ onStart, busy, lastSpec }: PromptConsoleProps): JSX.Element {
  const [text, setText] = useState<string>(lastSpec?.prompt ?? EXAMPLE_PROMPTS[0]);
  const [pressed, setPressed] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);

  const submit = useCallback(() => {
    const p = text.trim();
    if (!p || busy) return;
    setPressed(true);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setPressed(false), 260);
    onStart(p);
  }, [text, busy, onStart]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  const pick = (p: string) => {
    if (busy) return;
    setText(p);
    taRef.current?.focus();
  };

  const isLive = /\blive\b/i.test(text);

  return (
    <form className={styles.cabinet} onSubmit={onSubmit} aria-busy={busy}>
      <div className={styles.scan} aria-hidden="true" />
      <header className={styles.head}>
        <span className={styles.coin} aria-hidden="true">
          ◉
        </span>
        <h2 className={styles.title}>INSERT PROMPT</h2>
        <span className={styles.credit}>CREDIT 01</span>
      </header>

      {lastSpec ? (
        <div className={styles.marquee} aria-label={lastSpec.title}>
          <div className={styles.marqueeTrack}>
            <span>{lastSpec.title}</span>
            <span aria-hidden="true">{lastSpec.title}</span>
          </div>
        </div>
      ) : null}

      <label className={styles.screen}>
        <span className={styles.prompt} aria-hidden="true">
          &gt;
        </span>
        <textarea
          ref={taRef}
          className={styles.textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={3}
          spellCheck={false}
          disabled={busy}
          placeholder="describe the fight… e.g. 3 flows, 2 agents each on Stripe"
          aria-label="Battle prompt"
        />
      </label>

      <div className={styles.chips}>
        {EXAMPLE_PROMPTS.map((p, i) => (
          <button
            key={p}
            type="button"
            className={`${styles.chip} ${text === p ? styles.chipOn : ""}`}
            style={{ animationDelay: `${i * 70}ms` }}
            onClick={() => pick(p)}
            disabled={busy}
          >
            {p}
          </button>
        ))}
      </div>

      <div className={styles.row}>
        <p className={`${styles.hint} ${isLive ? styles.hintLive : ""}`}>
          {isLive ? "● LIVE — real QM agents will fight. Takes minutes." : "tip: say “live” to use real QM agents · default is a dry run"}
          <span className={styles.kbd}>⌘/Ctrl + Enter</span>
        </p>
        <button
          type="submit"
          className={`${styles.start} ${pressed ? styles.pressed : ""} ${busy ? styles.busy : ""}`}
          disabled={busy || !text.trim()}
        >
          <span className={styles.startFace}>{busy ? "FIGHTING…" : "START"}</span>
        </button>
      </div>

      {lastSpec && lastSpec.notes.length ? (
        <div className={styles.notes} aria-label="How the prompt was parsed">
          <span className={styles.notesLabel}>PARSED{lastSpec.parser === "jev" ? " BY JEV" : ""}</span>
          {lastSpec.notes.map((n, i) => (
            <span key={`${i}-${n}`} className={styles.note}>
              {n}
            </span>
          ))}
        </div>
      ) : null}
    </form>
  );
}
