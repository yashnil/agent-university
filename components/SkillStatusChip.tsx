import type { CSSProperties, JSX } from "react";
import type { SkillStatus } from "@/lib/types";
import styles from "./SkillStatusChip.module.css";

// Small pill for a single SkillStatus ("observed" | "transferred" | "certified"),
// colored via the --observed / --transferred / --certified CSS vars from globals.css.
// When `active` is explicitly false, the chip renders dimmed so a progression row
// (see LifecycleTimeline) can show which statuses have been reached so far.
export default function SkillStatusChip({
  status,
  active,
}: {
  status: SkillStatus;
  active?: boolean;
}): JSX.Element {
  const reached = active !== false;
  const chipStyle = { "--chip-color": `var(--${status})` } as CSSProperties;

  return (
    <span
      className={reached ? styles.chip : `${styles.chip} ${styles.dimmed}`}
      style={chipStyle}
    >
      <span className={styles.dot} aria-hidden="true" />
      {status}
    </span>
  );
}
