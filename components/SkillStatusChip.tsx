import type { JSX } from "react";
import type { SkillStatus } from "@/lib/types";
import StatusNode from "@/components/StatusNode";
import styles from "./SkillStatusChip.module.css";

// Pairs a StatusNode with its status word — observed | transferred | certified.
// StatusNode alone is decorative (aria-hidden), so the mono label beside it is
// what actually carries the state to assistive tech and to anyone reading past
// colour. `active === false` marks a status not yet reached (e.g. a step in a
// lifecycle progression that hasn't happened yet); see SkillStatusChip.module.css
// for how the dimmed state stays legible.
export default function SkillStatusChip({
  status,
  active,
}: {
  status: SkillStatus;
  active?: boolean;
}): JSX.Element {
  const reached = active !== false;

  return (
    <span className={reached ? styles.chip : `${styles.chip} ${styles.dimmed}`}>
      <span className={styles.node}>
        <StatusNode state={status} size="sm" />
      </span>
      <span className={styles.label}>{status}</span>
    </span>
  );
}
