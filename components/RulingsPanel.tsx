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
    <section className={`panel ${styles.panel}`} aria-label="Certification decision">
      <header className={styles.header}>
        <p className={`${styles.verdict} ${certified ? styles.verdictPass : styles.verdictFail}`}>{summary}</p>
        <div className={styles.headerMeta}>
          <span className={`tag ${certified ? "tag--pass" : "tag--fail"}`}>
            <span aria-hidden="true">{certified ? "✓" : "✗"}</span>
            {certified ? "certified" : "not certified"}
          </span>
          {policyId ? <span className="idTag">{policyId}</span> : null}
          <span className="muted count">
            {passedCount}/{rulings.length} rules passed
          </span>
        </div>
      </header>

      {rulings.length === 0 ? (
        <p className="muted">no rulings recorded</p>
      ) : (
        <ol className={styles.list}>
          {rulings.map((ruling, index) => {
            const hasEvidence = Boolean(ruling.evidence && Object.keys(ruling.evidence).length > 0);
            return (
              <li key={ruling.rule} className={`${styles.row} ${ruling.passed ? "" : styles.rowFail}`}>
                <div className={styles.rowHead}>
                  <span className={`mono ${styles.index}`} aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className={`tag ${ruling.passed ? "tag--pass" : "tag--fail"}`}>
                    <span aria-hidden="true">{ruling.passed ? "✓" : "✗"}</span>
                    {ruling.passed ? "pass" : "fail"}
                  </span>
                  <span className={`mono ${styles.rule}`}>{ruling.rule}</span>
                </div>
                <p className={styles.reason}>{ruling.reason}</p>
                {hasEvidence ? (
                  <details className={styles.details} open={!ruling.passed}>
                    <summary className={styles.summary}>
                      <span className={styles.disclosureGlyph} aria-hidden="true">
                        &#9656;
                      </span>
                      evidence
                    </summary>
                    <pre className={`code ${styles.evidence}`}>{JSON.stringify(ruling.evidence, null, 2)}</pre>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {hasFooter ? (
        <footer className={styles.footer}>
          {decidedAt ? (
            <p className={styles.footerItem}>
              <span className="muted">decided at</span> <span className="mono">{decidedAt}</span>
            </p>
          ) : null}
          {inputsDigest ? (
            <p className={styles.footerItem}>
              <span className="muted">inputs digest (reproducibility)</span> <span className="mono">{inputsDigest}</span>
            </p>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
