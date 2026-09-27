import type { JSX } from "react";
import type { EventPayloads } from "@/lib/types";
import styles from "./GapBanner.module.css";

export default function GapBanner({
  gap,
}: {
  gap: EventPayloads["gap.discovered"];
}): JSX.Element {
  return (
    <div className={styles.banner}>
      <span className={styles.label}>GAP</span>
      <div className={styles.body}>
        <p className={styles.headline}>
          No certified skill produces{" "}
          <span className={`mono ${styles.headlineSubject}`}>{gap.missingArtifactType}</span>
        </p>
        {gap.neededBy && (
          <p className={styles.neededBy}>
            needed by <span className="mono">{gap.neededBy}</span>
          </p>
        )}
        <p className={styles.reason}>{gap.reason}</p>
        <dl className={styles.footer}>
          <div>
            <dt>goal</dt>
            <dd className="mono">{gap.goal}</dd>
          </div>
          <div>
            <dt>plan</dt>
            <dd className="mono">{gap.planId}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
