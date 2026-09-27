import type { JSX } from "react";
import type { VerificationResult } from "@/lib/types";
import styles from "./ChecksTable.module.css";

export default function ChecksTable({
  result,
  title = "Deterministic verifier",
}: {
  result: VerificationResult;
  title?: string;
}): JSX.Element {
  const { checks, passed } = result;
  const passedCount = checks.filter((check) => check.passed).length;

  return (
    <section className={`panel ${styles.panel}`} aria-label={title}>
      <header className={styles.header}>
        <p className="panelTitle">{title}</p>
        <div className={styles.headerMeta}>
          <span className={`tag ${passed ? "tag--pass" : "tag--fail"}`}>
            <span aria-hidden="true">{passed ? "✓" : "✗"}</span>
            {passed ? "pass" : "fail"}
          </span>
          <span className={`mono ${styles.count}`}>
            {passedCount}/{checks.length}
          </span>
        </div>
      </header>

      {checks.length === 0 ? (
        <p className="muted">no checks reported</p>
      ) : (
        <ul className={styles.list}>
          {checks.map((check) => (
            <li key={check.name} className={styles.row}>
              <span className={`tag ${check.passed ? "tag--pass" : "tag--fail"}`}>
                <span aria-hidden="true">{check.passed ? "✓" : "✗"}</span>
                {check.passed ? "pass" : "fail"}
              </span>
              <span className={`mono ${styles.name}`}>{check.name}</span>
              {check.message ? <span className={`muted ${styles.message}`}>{check.message}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
