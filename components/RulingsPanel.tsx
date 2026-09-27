import type { JSX } from "react";
import styles from "./RulingsPanel.module.css";

export interface RulingRow {
  rule: string;
  passed: boolean;
  reason: string;
  evidence?: Record<string, unknown>;
}

export default function RulingsPanel({
  policyId,
  summary,
  certified,
  rulings,
  decidedAt,
  inputsDigest,
}: {
  /** Optional so other surfaces (e.g. the arena bracket) can reuse this panel per agent. */
  policyId?: string;
  summary: string;
  certified: boolean;
  rulings: RulingRow[];
  decidedAt?: string;
  inputsDigest?: string;
}): JSX.Element {
  const passedCount = rulings.filter((ruling) => ruling.passed).length;
  const hasFooter = Boolean(decidedAt || inputsDigest);

  return (
    <div className="card">
      <div className={styles.header}>
        <p className="cardTitle">Certification decision</p>
        <span className={`badge ${certified ? "badge--pass" : "badge--fail"}`}>
          {certified ? "certified" : "not certified"}
        </span>
        {policyId ? <span className="faint mono">{policyId}</span> : null}
        <span className="faint mono">
          {passedCount}/{rulings.length} rules passed
        </span>
      </div>

      <p className={`${styles.summary} ${certified ? styles.summaryPass : styles.summaryFail}`}>{summary}</p>

      {rulings.length === 0 ? (
        <p className="faint">no rulings recorded</p>
      ) : (
        <ol className={styles.list}>
          {rulings.map((ruling, index) => {
            const hasEvidence = Boolean(ruling.evidence && Object.keys(ruling.evidence).length > 0);
            return (
              <li key={ruling.rule} className={`${styles.row} ${ruling.passed ? "" : styles.rowFail}`}>
                <div className={styles.rowHead}>
                  <span className="faint mono">{index + 1}.</span>
                  <span className={`badge ${ruling.passed ? "badge--pass" : "badge--fail"}`}>
                    {ruling.passed ? "PASS" : "FAIL"}
                  </span>
                  <span className="mono">{ruling.rule}</span>
                </div>
                <p className={styles.reason}>{ruling.reason}</p>
                {hasEvidence ? (
                  <details className={styles.details} open={!ruling.passed}>
                    <summary className={styles.summaryToggle}>evidence</summary>
                    <pre className={`code ${styles.evidence}`}>{JSON.stringify(ruling.evidence, null, 2)}</pre>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {hasFooter ? (
        <div className={styles.footer}>
          {decidedAt ? (
            <span className="faint mono">
              decided at <span className={styles.footerValue}>{decidedAt}</span>
            </span>
          ) : null}
          {inputsDigest ? (
            <span className="faint mono">
              inputs digest (reproducibility): <span className={styles.footerValue}>{inputsDigest}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
