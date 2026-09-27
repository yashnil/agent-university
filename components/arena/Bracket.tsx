"use client";

import { useEffect, useState } from "react";
import type { JSX } from "react";
import SkillStatusChip from "@/components/SkillStatusChip";
import { fmtDuration, shortId, sourceLabel, type HeatView, type StudentView } from "./state";
import styles from "./Bracket.module.css";

export default function Bracket({ heats, flowMode, threshold = 0.5 }: { heats: HeatView[]; flowMode: boolean; threshold?: number }): JSX.Element {
  return (
    <div className={styles.bracket} style={{ ["--cols" as string]: String(Math.max(1, heats.length)) }}>
      {heats.map((h) => (
        <HeatColumn key={h.heat} heat={h} flowMode={flowMode} threshold={threshold} />
      ))}
    </div>
  );
}

function HeatColumn({ heat, flowMode, threshold }: { heat: HeatView; flowMode: boolean; threshold: number }): JSX.Element {
  const f = heat.finished;
  const winnerI = f?.winner?.i;
  const done = heat.students.filter((s) => s.state === "done").length;
  const certifiedSoFar = heat.students.filter((s) => s.result?.certified).length;
  const flow = heat.flow;
  const total = f?.runs ?? heat.students.length;
  const rate = f ? f.passRate : done ? certifiedSoFar / heat.students.length : 0;
  return (
    <div className={`${styles.column} ${f ? (f.advances ? styles.colAdvances : styles.colOut) : ""}`}>
      <div className={styles.heatHead}>
        {flow ? (
          <>
            <div className={styles.flowTop}>
              <span className="mono faint">flow {heat.heat}</span>
              <span className={`badge ${flow.source === "recall" ? "badge--info" : ""}`}>{sourceLabel(flow)}</span>
            </div>
            <h3 className={styles.heatTitle}>{flow.title}</h3>
            <span className="mono faint" title={flow.procedureId}>
              {shortId(flow.procedureId)}
            </span>
          </>
        ) : (
          <>
            <span className="mono faint">{flowMode ? "flow" : "heat"} {heat.heat}</span>
            <h3 className={styles.heatTitle}>{heat.examCompany ?? heat.examCase}</h3>
            <span className="mono faint">{heat.examCase}</span>
          </>
        )}
      </div>
      <div className={styles.heatStatus}>
        <div className={styles.rateBar} aria-hidden>
          <div
            className={`${styles.rateFill} ${f ? (f.advances ? styles.ratePass : styles.rateFail) : ""}`}
            style={{ width: `${Math.round(Math.max(0, Math.min(1, rate)) * 100)}%` }}
          />
          <div
            className={styles.rateMark}
            style={{ left: `${Math.round(threshold * 100)}%` }}
            title={`${Math.round(threshold * 100)}%: advance threshold`}
          />
        </div>
        {f ? (
          flow || flowMode ? (
            f.advances ? (
              <span className="badge badge--pass">
                {f.certifiedCount}/{total} certified · advances → final
              </span>
            ) : (
              <span className="badge badge--fail">
                {f.certifiedCount}/{total} · eliminated
              </span>
            )
          ) : f.winner ? (
            <span className="badge badge--pass">{f.certifiedCount} certified · winner → final</span>
          ) : (
            <span className="badge badge--fail">0 certified · no finalist</span>
          )
        ) : (
          <span className="mono faint">
            {done}/{heat.students.length} finished · {certifiedSoFar} certified
          </span>
        )}
      </div>
      <ol className={styles.students}>
        {heat.students.map((s) => (
          <li key={s.i}>
            <StudentCard s={s} winner={winnerI === s.i} flowMode={Boolean(flow) || flowMode} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function useElapsed(startedAt: string | null, active: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!startedAt) return null;
  return Math.max(0, now - new Date(startedAt).getTime());
}

function StudentCard({ s, winner, flowMode }: { s: StudentView; winner: boolean; flowMode: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const elapsed = useElapsed(s.startedAt, s.state === "running");
  const r = s.result;
  const stateClass =
    s.state === "pending" ? styles.pending : s.state === "running" ? styles.running : r?.certified ? styles.pass : styles.fail;
  const m = r?.metrics ?? {};
  const metrics = [
    m.toolCalls !== undefined ? `${m.toolCalls} tools` : null,
    fmtDuration(m.durationMs),
    m.costUsd !== undefined ? `$${m.costUsd.toFixed(2)}` : null,
  ].filter(Boolean);

  const head = (
    <>
      <div className={styles.cardHead}>
        <span className={styles.name}>{s.student.name}</span>
        {winner ? <span className="badge badge--pass">{flowMode ? "best run" : "→ final"}</span> : null}
      </div>
      {s.examCompany || s.examCase ? (
        <p className={`mono ${styles.exam}`}>
          trial: <strong>{s.examCompany ?? s.examCase}</strong>
          {s.examCompany && s.examCase ? <span className="faint"> · {s.examCase}</span> : null}
        </p>
      ) : null}
      <div className={styles.cardMeta}>
        {s.state === "pending" ? <span className="mono faint">pending</span> : null}
        {s.state === "running" ? (
          <span className={`mono ${styles.runningLabel}`}>running{elapsed !== null ? ` · ${fmtDuration(elapsed)}` : ""}</span>
        ) : null}
        {r ? (
          <>
            <span className={`badge ${r.certified ? "badge--pass" : "badge--fail"}`}>
              {r.certified ? "certified" : "not certified"}
            </span>
            <SkillStatusChip status={r.status} />
          </>
        ) : null}
      </div>
      <p className={`mono faint ${styles.harness}`}>
        {s.student.harness} · {s.student.id}
      </p>
      {r && !r.certified && (r.failedRules.length > 0 || r.failedChecks.length > 0 || r.error) ? (
        <div className={`mono ${styles.failures}`}>
          {r.failedRules.length ? <div>rules: {r.failedRules.join(", ")}</div> : null}
          {r.failedChecks.length ? <div>checks: {r.failedChecks.join(", ")}</div> : null}
          {r.error ? <div>error: {r.error}</div> : null}
        </div>
      ) : null}
      {metrics.length ? <p className={`mono faint ${styles.metrics}`}>{metrics.join(" · ")}</p> : null}
    </>
  );

  if (!r) return <div className={`${styles.card} ${stateClass}`}>{head}</div>;

  return (
    <div className={`${styles.card} ${stateClass} ${winner ? styles.winner : ""}`}>
      <button type="button" className={styles.cardButton} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {head}
        <span className={`mono faint ${styles.toggle}`}>{open ? "hide rulings ▴" : "rulings ▾"}</span>
      </button>
      {open ? (
        <div className={styles.rulings}>
          <p className={`mono ${r.certified ? styles.sumPass : styles.sumFail}`}>{r.summary}</p>
          <ol className={styles.rulingList}>
            {r.rulings.map((ru) => (
              <li key={ru.rule} className={ru.passed ? "" : styles.rulingFail}>
                <span className={`badge ${ru.passed ? "badge--pass" : "badge--fail"}`}>{ru.passed ? "pass" : "fail"}</span>
                <span className="mono">{ru.rule}</span>
                <p className={styles.reason}>{ru.reason}</p>
              </li>
            ))}
          </ol>
          {r.runId ? <p className="mono faint">run {r.runId}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
