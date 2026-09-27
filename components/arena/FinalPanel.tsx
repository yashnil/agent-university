import type { JSX } from "react";
import { pct, shortId, type ArenaView, type HeatView } from "./state";
import styles from "./FinalPanel.module.css";

export default function FinalPanel({
  started,
  finished,
  judgeModel,
  dry,
  heatsDone,
  heats,
  flowMode,
}: {
  started: ArenaView["finalStarted"];
  finished: ArenaView["finalFinished"];
  judgeModel: string | null;
  dry: boolean;
  heatsDone: boolean;
  heats: HeatView[];
  flowMode: boolean;
}): JSX.Element {
  const judge = finished?.judge;
  const judgeOk = judge?.status === "ok";
  const fixture = /fixture/i.test(`${judge?.status ?? ""} ${judge?.model ?? judgeModel ?? ""}`) || (dry && !judgeModel);
  // Flow identity: prefer the event's own fields, else the column's flow, else the heat's exam.
  const ident = (r: { heat: number; examCase: string; procedureId?: string; title?: string; passRate?: number; student: { name: string } }) => {
    const h = heats.find((x) => x.heat === r.heat);
    const title = r.title ?? h?.flow?.title ?? null;
    const procedureId = r.procedureId ?? h?.flow?.procedureId ?? null;
    const passRate = r.passRate ?? h?.finished?.passRate ?? null;
    return {
      name: title ?? r.student.name,
      sub: title
        ? `flow ${r.heat}${procedureId ? ` · ${shortId(procedureId)}` : ""} · best run ${r.student.name} on ${r.examCase}`
        : `${flowMode ? "flow" : "heat"} ${r.heat} · ${r.examCase}`,
      procedureId,
      passRate,
    };
  };

  return (
    <div className="card">
      <div className={styles.head}>
        <p className="cardTitle" style={{ margin: 0 }}>Jev final</p>
        {judge ? (
          <span className={`badge ${judgeOk ? "badge--pass" : "badge--warn"}`}>judge: {judge.status}</span>
        ) : started ? (
          <span className="badge badge--info">judging…</span>
        ) : (
          <span className="badge">{heatsDone ? "no finalists" : flowMode ? "waiting for flows" : "waiting for heats"}</span>
        )}
        <span className="mono faint">{judge?.model ?? judgeModel ?? (dry ? "fixture judge (dry run)" : "jev")}</span>
      </div>
      {judge?.reason ? <p className={`mono ${styles.reason}`}>{judge.reason}</p> : null}
      {fixture && judge ? (
        <p className={`faint ${styles.note}`}>Dry run: scores come from the offline fixture judge, not a model call.</p>
      ) : null}

      {finished ? (
        finished.ranking.length === 0 ? (
          <p className="faint">
            {flowMode ? "No flow reached the pass-rate bar — nothing to judge, no trusted flow." : "No certified finalists — nobody to judge, no champion."}
          </p>
        ) : (
          <ol className={styles.list}>
            {finished.ranking.map((r) => {
              const id = ident(r);
              return (
                <li key={`${r.heat}-${r.i}`} className={`${styles.row} ${r.place === 1 ? styles.first : ""}`}>
                  <div className={styles.rowHead}>
                    <span className={`mono ${styles.place}`}>#{r.place}</span>
                    <span className={styles.name}>{id.name}</span>
                    {id.passRate !== null ? <span className="badge">pass rate {pct(id.passRate)}</span> : null}
                  </div>
                  <p className={`mono faint ${styles.sub}`} title={id.procedureId ?? undefined}>{id.sub}</p>
                  <div className={styles.scoreRow}>
                    <div className={styles.bar} aria-hidden>
                      <div className={styles.fill} style={{ width: `${Math.max(0, Math.min(10, r.score ?? 0)) * 10}%` }} />
                    </div>
                    <span className={`mono ${styles.score}`}>{r.score === null ? "–" : `${r.score.toFixed(1)}/10`}</span>
                  </div>
                  {r.rationale ? <p className={styles.rationale}>{r.rationale}</p> : null}
                </li>
              );
            })}
          </ol>
        )
      ) : started ? (
        started.finalists.length === 0 ? (
          <p className="faint">No finalists.</p>
        ) : (
          <ul className={styles.list}>
            {started.finalists.map((f) => {
              const id = ident(f);
              return (
                <li key={`${f.heat}-${f.i}`} className={`${styles.row} ${styles.waiting}`}>
                  <div className={styles.rowHead}>
                    <span className={styles.name}>{id.name}</span>
                    {id.passRate !== null ? <span className="badge">pass rate {pct(id.passRate)}</span> : null}
                  </div>
                  <p className={`mono faint ${styles.sub}`}>{id.sub}</p>
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <p className="faint">{flowMode ? "Flows that pass at least half their exams appear here." : "Finalists appear as each heat closes."}</p>
      )}
    </div>
  );
}
