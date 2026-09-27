import type { JSX } from "react";
import type { VerificationResult } from "@/lib/types";
import styles from "./ChecksTable.module.css";

export default function ChecksTable({
  result,
  title = "Verification",
}: {
  result: VerificationResult;
  title?: string;
}): JSX.Element {
  const { checks, passed } = result;
  const passedCount = checks.filter((check) => check.passed).length;

  return (
    <div className="card">
      <div className={styles.header}>
        <p className="cardTitle">{title}</p>
        <span className={`badge ${passed ? "badge--pass" : "badge--fail"}`}>{passed ? "PASS" : "FAIL"}</span>
        <span className="faint mono">
          {passedCount}/{checks.length} checks passed
        </span>
      </div>
      {checks.length === 0 ? (
        <p className="faint">no checks reported</p>
      ) : (
        <ul className={styles.list}>
          {checks.map((check) => (
            <li key={check.name} className={styles.row}>
              <span className={`badge ${check.passed ? "badge--pass" : "badge--fail"}`}>
                {check.passed ? "PASS" : "FAIL"}
              </span>
              <span className="mono">{check.name}</span>
              {check.message ? <span className={`muted ${styles.message}`}>{check.message}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
