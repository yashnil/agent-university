import type { JSX } from "react";
import StatusNode from "./StatusNode";
import styles from "./ArtifactChip.module.css";

/**
 * A pipeline artifact, named the way it is on disk.
 *
 * The file name is the thing an evaluator copies, so it is mono and verbatim. The schema status
 * says whether the shape is settled (`frozen`) or still a stand-in (`v0 placeholder`), because an
 * artifact nobody has frozen cannot be certified against anything.
 */
export type SchemaStatus = "frozen" | "v0-placeholder" | "unknown";

const SCHEMA_LABEL: Record<SchemaStatus, string> = {
  frozen: "frozen",
  "v0-placeholder": "v0 placeholder",
  unknown: "schema unknown",
};

const NODE = {
  certified: "certified",
  uncertified: "transferred",
  missing: "gap",
} as const;

export default function ArtifactChip({
  name,
  schemaStatus = "unknown",
  state = "missing",
  note,
}: {
  name: string;
  schemaStatus?: SchemaStatus;
  state?: "certified" | "uncertified" | "missing";
  note?: string;
}): JSX.Element {
  return (
    <span className={`${styles.chip} ${styles[state]}`}>
      <StatusNode state={NODE[state]} size="sm" />
      <span className={styles.body}>
        <span className={`mono ${styles.name}`}>{name}</span>
        <span className={styles.meta}>
          <span className={styles.schema}>{SCHEMA_LABEL[schemaStatus]}</span>
          <span className={styles.state}>{state === "uncertified" ? "not certified" : state}</span>
        </span>
        {note ? <span className={styles.note}>{note}</span> : null}
      </span>
    </span>
  );
}
