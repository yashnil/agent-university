import type { JSX } from "react";
import styles from "./LifecyclePath.module.css";

/**
 * The connector between two status nodes. Forward-only, like the statuses themselves.
 *
 * `done` lights the path: it animates dotted -> solid once, over --dur-path. Pending paths stay
 * dotted. `live` shimmers along its leading edge instead of completing.
 */
export default function LifecyclePath({
  done,
  live = false,
  orientation = "horizontal",
}: {
  done: boolean;
  live?: boolean;
  orientation?: "horizontal" | "vertical";
}): JSX.Element {
  const state = live ? styles.live : done ? styles.done : styles.pending;
  return <span className={`${styles.path} ${styles[orientation]} ${state}`} aria-hidden="true" />;
}
