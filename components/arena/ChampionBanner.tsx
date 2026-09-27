import type { JSX } from "react";
import { pct, procedurePath, type ArenaView, type HeatView } from "./state";
import styles from "./ChampionBanner.module.css";

export default function ChampionBanner({
  finished,
  heats,
  dry,
  flowMode,
}: {
  finished: NonNullable<ArenaView["finished"]>;
  heats: HeatView[];
  dry: boolean;
  flowMode: boolean;
}): JSX.Element {
  const c = finished.champion;
  if (!c) {
    return (
      <div className={`card ${styles.none}`}>
        <p className={styles.title}>{flowMode ? "No trusted flow" : "No champion"}</p>
        <p className="muted">
          {flowMode
            ? "No flow passed enough of its trials to reach a verdict, so nothing was promoted. The registry is unchanged."
            : "No agent produced a certified record, so nothing was promoted. The registry is unchanged."}
        </p>
      </div>
    );
  }
  const heat = heats.find((h) => h.heat === c.heat);
  const proc = finished.procedure ?? null;
  const title = c.title ?? proc?.title ?? heat?.flow?.title ?? null;
  const procedureId = c.procedureId ?? proc?.procedureId ?? heat?.flow?.procedureId ?? null;
  const passRate = c.passRate ?? proc?.passRate ?? heat?.finished?.passRate ?? null;
  const extra = finished as unknown as { procedurePath?: string };
  const procPath =
    extra.procedurePath ?? (typeof proc?.path === "string" ? proc.path : procedurePath(finished.registry, proc?.skillId, proc?.procedureId));
  const isFlow = Boolean(title || procedureId);

  return (
    <div className={`card ${styles.banner}`}>
      <div className={styles.top}>
        <span className="badge badge--pass">{isFlow ? "trusted flow" : "champion"}</span>
        {finished.promoted === true ? <span className="badge badge--pass">promoted</span> : null}
        {finished.promoted === false ? <span className="badge badge--warn">not promoted</span> : null}
        {heat?.flow ? <span className="badge">{heat.flow.source}</span> : null}
      </div>
      <p className={styles.title}>{isFlow ? `Trusted flow: ${title ?? procedureId}` : c.student.name}</p>
      <p className={`mono ${styles.summary}`}>
        {isFlow
          ? `${heat?.finished ? `${heat.finished.certifiedCount}/${heat.finished.runs}` : pct(passRate)} runs certified · best run: ${c.summary || "CERTIFIED: all 8 rules passed"}`
          : c.summary || "CERTIFIED: all 8 rules passed"}
      </p>
      <dl className="kv">
        {procedureId ? (
          <>
            <dt>procedure</dt>
            <dd>{procedureId}</dd>
          </>
        ) : null}
        {passRate !== null ? (
          <>
            <dt>pass rate</dt>
            <dd>{pct(passRate)}</dd>
          </>
        ) : null}
        <dt>jev score</dt>
        <dd>{c.score === null ? "–" : `${c.score.toFixed(1)}/10`}</dd>
        <dt>{isFlow ? "flow" : "heat"}</dt>
        <dd>
          {c.heat}
          {proc?.examCases?.length ? ` · trials ${proc.examCases.join(", ")}` : ` · ${heat?.examCompany ?? c.examCase} (${c.examCase})`}
        </dd>
        <dt>best run</dt>
        <dd>
          {c.student.name} on {c.examCase}
          {c.runId ? ` · ${c.runId}` : ""}
        </dd>
        <dt>saved to</dt>
        <dd>
          {procPath ? (
            <>
              {procPath}
              <br />
            </>
          ) : null}
          {finished.registry}
        </dd>
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
      {proc?.flow ? (
        <details className={styles.record}>
          <summary className="mono faint">the flow (procedure text)</summary>
          <pre className={`code ${styles.flowText}`}>{proc.flow}</pre>
        </details>
      ) : null}
      {proc ? (
        <details className={styles.record}>
          <summary className="mono faint">procedure record</summary>
          <pre className="code">{JSON.stringify(proc, null, 2)}</pre>
        </details>
      ) : null}
      {finished.record ? (
        <details className={styles.record}>
          <summary className="mono faint">certification record (best run)</summary>
          <pre className="code">{JSON.stringify(finished.record, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}
