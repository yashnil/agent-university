import type { JSX } from "react";
import type { EventPayloads } from "@/lib/types";
import styles from "./PipelineStrip.module.css";

type Step = EventPayloads["plan.composed"]["steps"][number];

const STATUS_BADGE: Record<Step["status"], string> = {
  certified: "badge--pass",
  uncertified: "badge--warn",
  missing: "badge--fail",
};

const STEP_CLASS: Record<Step["status"], string> = {
  certified: styles["step--certified"],
  uncertified: styles["step--uncertified"],
  missing: styles["step--missing"],
};

export default function PipelineStrip({
  steps,
  missingArtifactType,
}: {
  steps: Step[];
  missingArtifactType?: string;
}): JSX.Element {
  return (
    <div className={styles.strip}>
      {steps.map((step, index) => {
        const isFirstGap = step.artifactType === missingArtifactType;
        return (
          <div key={`${step.artifactType}-${index}`} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {index > 0 && <span className={styles.arrow} aria-hidden="true">→</span>}
            <div className={`${styles.step} ${STEP_CLASS[step.status]}`}>
              <div className={styles.stepHead}>
                <span className={`mono ${styles.artifactName}`}>{step.artifactType}</span>
                <span className={`badge ${STATUS_BADGE[step.status]}`}>{step.status}</span>
              </div>
              <span className={`mono ${styles.skillLine}`}>
                {step.skillId ?? "no certified skill"}
              </span>
              {isFirstGap && <span className={styles.gapMarker}>FIRST GAP</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
