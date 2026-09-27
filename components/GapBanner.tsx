import type { JSX } from "react";
import type { EventPayloads } from "@/lib/types";
import StatusNode from "./StatusNode";
import styles from "./GapBanner.module.css";

/**
 * A capability gap from the composite run carries producer-added keys on top of the frozen
 * payload: the missing skill, and its new status (`candidate`).
 */
type Gap = EventPayloads["gap.discovered"] & {
  skillId?: string;
  skillName?: string;
  message?: string;
  status?: string;
};

/**
 * The GAP: the honest edge of certified capability, and the next skill to teach.
 *
 * Deliberately not an error — nothing failed here, because nothing was ever taught. It uses the
 * dashed-empty node grammar rather than a warning colour, and reads as a finding the system
 * reports about itself.
 */
export default function GapBanner({ gap }: { gap: Gap }): JSX.Element {
  return (
    <section className={styles.banner} aria-labelledby="gap-heading">
      <div className={styles.head}>
        <StatusNode state="gap" size="lg" />
        <p className={styles.label} id="gap-heading">
          GAP
        </p>
        <span className="idTag">gap.discovered</span>
      </div>
      {gap.skillName ? (
        <>
          <p className={styles.subject}>
            No certified capability: <span className="mono">{gap.skillName}</span>
          </p>
          <p className={styles.neededBy}>
            so <span className="mono">{gap.missingArtifactType}</span> cannot be produced from trusted
            skills{gap.status ? <> — new {gap.status}</> : null}.
          </p>
        </>
      ) : (
        <p className={styles.subject}>
          <span className="mono">{gap.missingArtifactType}</span> has no certified skill
          {gap.neededBy ? (
            <>
              {" "}
              — and <span className="mono">{gap.neededBy}</span> needs it
            </>
          ) : null}
          .
        </p>
      )}
      <p className={styles.reason}>{gap.message ?? gap.reason}</p>
      <dl className="kv">
        <dt>goal</dt>
        <dd>{gap.goal}</dd>
        <dt>planId</dt>
        <dd>{gap.planId}</dd>
      </dl>
    </section>
  );
}
