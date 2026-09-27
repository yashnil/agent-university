import type { JSX } from "react";
import type { ArenaView } from "./state";
import styles from "./FinalPanel.module.css";

export default function FinalPanel({
  started,
  finished,
  judgeModel,
  dry,
  heatsDone,
}: {
  started: ArenaView["finalStarted"];
  finished: ArenaView["finalFinished"];
  judgeModel: string | null;
  dry: boolean;
  heatsDone: boolean;
}): JSX.Element {
  const judge = finished?.judge;
  const judgeOk = judge?.status === "ok";
  const fixture = /fixture/i.test(`${judge?.status ?? ""} ${judge?.model ?? judgeModel ?? ""}`) || (dry && !judgeModel);

  return (
    <div className="card">
      <div className={styles.head}>
        <p className="cardTitle" style={{ margin: 0 }}>Jev final</p>
        {judge ? (
          <span className={`badge ${judgeOk ? "badge--pass" : "badge--warn"}`}>judge: {judge.status}</span>
        ) : started ? (
          <span className="badge badge--info">judging…</span>
        ) : (
          <span className="badge">{heatsDone ? "no finalists" : "waiting for heats"}</span>
        )}
        <span className="mono faint">
          {judge?.model ?? judgeModel ?? (dry ? "fixture judge (dry run)" : "jev")}
        </span>
      </div>
      {judge?.reason ? <p className={`mono ${styles.reason}`}>{judge.reason}</p> : null}
      {fixture && judge ? (
        <p className={`faint ${styles.note}`}>
          Dry run: scores come from the offline fixture judge, not a model call.
        </p>
      ) : null}

      {finished ? (
        finished.ranking.length === 0 ? (
          <p className="faint">No certified finalists — nobody to judge, no champion.</p>
        ) : (
          <ol className={styles.list}>
            {finished.ranking.map((r) => (
              <li key={`${r.heat}-${r.i}`} className={`${styles.row} ${r.place === 1 ? styles.first : ""}`}>
                <div className={styles.rowHead}>
                  <span className={`mono ${styles.place}`}>#{r.place}</span>
                  <span className={styles.name}>{r.student.name}</span>
                  <span className="mono faint">heat {r.heat} · {r.examCase}</span>
                </div>
                <div className={styles.scoreRow}>
                  <div className={styles.bar} aria-hidden>
                    <div className={styles.fill} style={{ width: `${Math.max(0, Math.min(10, r.score ?? 0)) * 10}%` }} />
                  </div>
                  <span className={`mono ${styles.score}`}>{r.score === null ? "–" : `${r.score.toFixed(1)}/10`}</span>
                </div>
                {r.rationale ? <p className={styles.rationale}>{r.rationale}</p> : null}
              </li>
            ))}
          </ol>
        )
      ) : started ? (
        started.finalists.length === 0 ? (
          <p className="faint">No certified finalists.</p>
        ) : (
          <ul className={styles.list}>
            {started.finalists.map((f) => (
              <li key={`${f.heat}-${f.i}`} className={`${styles.row} ${styles.waiting}`}>
                <div className={styles.rowHead}>
                  <span className={styles.name}>{f.student.name}</span>
                  <span className="mono faint">heat {f.heat} · {f.examCase}</span>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="faint">Finalists appear as each heat closes.</p>
      )}
    </div>
  );
}
