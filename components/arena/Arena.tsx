"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import type { ArenaEvent, ArenaMode } from "@/app/_lib/arena-jobs";
import { foldEvents, isTerminal } from "./state";
import Bracket from "./Bracket";
import FinalPanel from "./FinalPanel";
import ChampionBanner from "./ChampionBanner";
import EventLog from "./EventLog";
import styles from "./Arena.module.css";

type Conn = "idle" | "starting" | "streaming" | "done";

const COUNTS = [1, 2, 3, 4, 5];

export default function Arena(): JSX.Element {
  const [mode, setMode] = useState<ArenaMode>("dry");
  const [heats, setHeats] = useState(3);
  const [perHeat, setPerHeat] = useState(3);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobMode, setJobMode] = useState<ArenaMode | null>(null);
  const [events, setEvents] = useState<ArenaEvent[]>([]);
  const [conn, setConn] = useState<Conn>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const attach = useCallback((id: string) => {
    esRef.current?.close();
    setJobId(id);
    setEvents([]);
    setConn("streaming");
    const es = new EventSource(`/api/arena/${id}`);
    esRef.current = es;
    es.addEventListener("arena", (msg) => {
      const e = JSON.parse((msg as MessageEvent<string>).data) as ArenaEvent;
      // The server replays from the start on every (re)connect, so drop anything already seen.
      setEvents((prev) => (prev.some((p) => p.at === e.at && p.type === e.type && JSON.stringify(p) === JSON.stringify(e)) ? prev : [...prev, e]));
      if (isTerminal(e)) {
        es.close();
        setConn("done");
      }
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setConn((c) => (c === "streaming" ? "done" : c));
        setNotice("Lost the connection to this tournament (the server may have restarted).");
      }
    };
  }, []);

  // On load: re-attach to the running tournament, or show the most recent one.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/arena")
      .then((r) => r.json() as Promise<{ current: string | null; jobs: { id: string; mode: ArenaMode; done: boolean }[] }>)
      .then((s) => {
        if (cancelled) return;
        const job = s.jobs.find((j) => j.id === s.current) ?? s.jobs[0];
        if (job) {
          setJobMode(job.mode);
          attach(job.id);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, [attach]);

  const running = conn === "starting" || conn === "streaming";

  const run = async () => {
    setNotice(null);
    setConn("starting");
    try {
      const r = await fetch("/api/arena", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, heats, perHeat }),
      });
      const body = (await r.json()) as { id?: string; running?: string; error?: string };
      if (r.status === 409 && body.running) {
        setNotice("A tournament is already running — showing it.");
        attach(body.running);
        return;
      }
      if (!r.ok || !body.id) throw new Error(body.error ?? `HTTP ${r.status}`);
      setJobMode(mode);
      attach(body.id);
    } catch (err) {
      setConn("idle");
      setNotice(`Could not start: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const view = useMemo(() => foldEvents(events), [events]);
  const dry = view.started?.dry ?? jobMode !== "live";

  return (
    <>
      <section className={`card ${styles.controls}`} aria-label="Tournament controls">
        <div className={styles.field}>
          <span className={styles.label}>Mode</span>
          <div className={styles.segment} role="group" aria-label="Mode">
            {(["dry", "live"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={mode === m ? `${styles.option} ${styles.active}` : styles.option}
                aria-pressed={mode === m}
                disabled={running}
                onClick={() => setMode(m)}
              >
                {m === "dry" ? "Dry run" : "Live (QM)"}
              </button>
            ))}
          </div>
        </div>
        <label className={styles.field}>
          <span className={styles.label}>Heats</span>
          <select className={styles.select} value={heats} disabled={running} onChange={(e) => setHeats(Number(e.target.value))}>
            {COUNTS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Students / heat</span>
          <select className={styles.select} value={perHeat} disabled={running} onChange={(e) => setPerHeat(Number(e.target.value))}>
            {COUNTS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <button type="button" className={styles.run} onClick={run} disabled={running}>
          {running ? "Running…" : "Run tournament"}
        </button>
        <p className={`mono faint ${styles.modeNote}`}>
          {mode === "dry"
            ? "Dry run: fabricated students, real certification engine, offline fixture judge. No QM, no keys."
            : "Live: real students on QM. Needs QM + Memorable running and API keys (OpenRouter for Jev) configured on the server."}
        </p>
      </section>

      {notice ? (
        <div className="notice">
          <span className="badge badge--warn">note</span>
          <span>{notice}</span>
        </div>
      ) : null}

      {view.error ? (
        <div className={`notice ${styles.error}`}>
          <span className="badge badge--fail">error</span>
          <span className="mono">{view.error.message}</span>
        </div>
      ) : null}

      {!jobId && conn === "idle" ? (
        <p className={`faint ${styles.empty}`}>No tournament yet. Pick a mode and press Run.</p>
      ) : null}

      {view.started ? (
        <>
          <section className="section">
            <div className="sectionHead">
              <span className="sectionNum">01</span>
              <h2>Heats</h2>
              <span className="mono faint">
                {view.started.tournamentId} · {view.started.dry ? "dry run" : "live"}
              </span>
            </div>
            <p className="sectionSub">
              Each heat is one unseen exam case. Every student is certified by the 8-rule engine; the best
              certified record in a heat advances. A heat with nobody certified sends no finalist.
            </p>
            <Bracket heats={view.heats} />
          </section>

          {view.finalStarted || view.heats.some((h) => h.finished) ? (
            <section className="section">
              <div className="sectionHead">
                <span className="sectionNum">02</span>
                <h2>Final</h2>
              </div>
              <p className="sectionSub">
                Only certified heat winners reach the final. Jev compares them on procedure-execution quality — it
                ranks, it never certifies.
              </p>
              <FinalPanel
                started={view.finalStarted}
                finished={view.finalFinished}
                judgeModel={view.started.judgeModel}
                dry={dry}
                heatsDone={view.heats.every((h) => h.finished)}
              />
            </section>
          ) : null}

          {view.finished ? (
            <section className="section">
              <div className="sectionHead">
                <span className="sectionNum">03</span>
                <h2>Champion</h2>
              </div>
              <ChampionBanner finished={view.finished} heats={view.heats} dry={dry} />
            </section>
          ) : null}
        </>
      ) : jobId ? (
        <p className={`faint mono ${styles.empty}`}>waiting for the tournament to start…</p>
      ) : null}

      {events.length > 0 ? <EventLog events={events} /> : null}
    </>
  );
}
