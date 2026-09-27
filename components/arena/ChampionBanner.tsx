import type { JSX } from "react";
import type { ArenaView, HeatView } from "./state";
import styles from "./ChampionBanner.module.css";

export default function ChampionBanner({
  finished,
  heats,
  dry,
}: {
  finished: NonNullable<ArenaView["finished"]>;
  heats: HeatView[];
  dry: boolean;
}): JSX.Element {
  const c = finished.champion;
  if (!c) {
    return (
      <div className={`card ${styles.none}`}>
        <p className={styles.title}>No champion</p>
        <p className="muted">
          No student produced a certified record, so nothing was promoted. The registry is unchanged.
        </p>
      </div>
    );
  }
  const heat = heats.find((h) => h.heat === c.heat);
  return (
    <div className={`card ${styles.banner}`}>
      <div className={styles.top}>
        <span className="badge badge--pass">champion</span>
        {finished.promoted === true ? <span className="badge badge--pass">promoted</span> : null}
        {finished.promoted === false ? <span className="badge badge--warn">not promoted</span> : null}
      </div>
      <p className={styles.title}>{c.student.name}</p>
      <p className={`mono ${styles.summary}`}>{c.summary || "CERTIFIED: all 8 rules passed"}</p>
      <dl className="kv">
        <dt>heat</dt>
        <dd>
          {c.heat} · {heat?.examCompany ?? c.examCase} ({c.examCase})
        </dd>
        <dt>student</dt>
        <dd>
          {c.student.id} · {c.student.harness}
        </dd>
        <dt>jev score</dt>
        <dd>{c.score === null ? "–" : `${c.score.toFixed(1)}/10`}</dd>
        {c.runId ? (
          <>
            <dt>run</dt>
            <dd>{c.runId}</dd>
          </>
        ) : null}
        <dt>saved to</dt>
        <dd>{finished.registry}</dd>
      </dl>
      {dry ? (
        <p className={`faint ${styles.note}`}>
          Dry run: saved to a throwaway registry; the committed registry and the lifecycle page are untouched.
        </p>
      ) : (
        <p className={styles.note}>
          <a href="/?mode=live">See the full lifecycle for this record →</a>
        </p>
      )}
      {finished.record ? (
        <details className={styles.record}>
          <summary className="mono faint">certification record</summary>
          <pre className="code">{JSON.stringify(finished.record, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}
