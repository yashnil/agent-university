import type { JSX } from "react";
import type { EventPayloads } from "@/lib/types";
import ArtifactChip, { type SchemaStatus } from "./ArtifactChip";
import LifecyclePath from "./LifecyclePath";
import StatusNode from "./StatusNode";
import styles from "./PipelineStrip.module.css";

type Step = EventPayloads["plan.composed"]["steps"][number];

// company.json is frozen and certified today; the rest are v0 placeholders with no certified skill.
const SCHEMA: Record<string, SchemaStatus> = {
  "company.json": "frozen",
  "repo_analysis.json": "v0-placeholder",
  "score.json": "v0-placeholder",
  "outreach.md": "v0-placeholder",
};

const NODE = { certified: "certified", uncertified: "transferred", missing: "gap" } as const;

/**
 * The artifact chain, drawn with the node grammar rather than a stepper: a path is lit only when
 * the step before it is certified, so the chain visibly stops where certification stops.
 */
export default function PipelineStrip({
  steps,
  missingArtifactType,
}: {
  steps: Step[];
  missingArtifactType?: string;
}): JSX.Element {
  if (steps.length === 0) {
    return <p className="muted">No plan composed, so there is no chain to inspect.</p>;
  }

  return (
    <ol className={styles.strip}>
      {steps.map((step, i) => {
        const firstGap = missingArtifactType === step.artifactType;
        return (
          <li key={`${step.artifactType}-${i}`} className={styles.step}>
            <div className={styles.rail}>
              <StatusNode state={NODE[step.status]} size="md" />
              {i < steps.length - 1 ? <LifecyclePath done={step.status === "certified"} /> : null}
            </div>
            <ArtifactChip
              name={step.artifactType}
              schemaStatus={SCHEMA[step.artifactType] ?? "unknown"}
              state={step.status}
            />
            <p className={styles.skill}>
              {step.skillId ? (
                <span className="mono">{step.skillId}</span>
              ) : (
                <span className="muted">no certified skill</span>
              )}
            </p>
            {firstGap ? <p className={styles.firstGap}>the chain stops here</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
