import type { JSX } from "react";
import type { EventPayloads } from "@/lib/types";
import styles from "./GapBanner.module.css";

// A capability gap (from the composite run) carries producer-added keys on top of the frozen payload:
// the missing skill, and its new status `candidate`.
type Gap = EventPayloads["gap.discovered"] & { skillId?: string; skillName?: string; message?: string; status?: string };

export default function GapBanner({
  gap,
}: {
  gap: Gap;
}): JSX.Element {
  return (
    <div className={styles.banner}>
      <span className={styles.label}>GAP</span>
      <div className={styles.body}>
        {gap.skillName ? (
          <>
            <p className={styles.headline}>
              No certified capability:{" "}
              <span className={`mono ${styles.headlineSubject}`}>{gap.skillName.toUpperCase()}</span>
            </p>
            <p className={styles.neededBy}>
              so <span className="mono">{gap.missingArtifactType}</span> cannot be produced from trusted skills
              {gap.status ? (
                <>
                  {" · "}
                  <span className="mono">{gap.skillId}</span> is now a <strong>{gap.status}</strong>, not certified
                </>
              ) : null}
            </p>
          </>
        ) : (
          <p className={styles.headline}>
            No certified skill produces{" "}
            <span className={`mono ${styles.headlineSubject}`}>{gap.missingArtifactType}</span>
          </p>
        )}
        {!gap.skillName && gap.neededBy && (
          <p className={styles.neededBy}>
            needed by <span className="mono">{gap.neededBy}</span>
          </p>
        )}
        <p className={styles.reason}>{gap.message ?? gap.reason}</p>
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
