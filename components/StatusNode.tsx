import type { JSX } from "react";
import styles from "./StatusNode.module.css";

/**
 * The system's core glyph, taken from the logo's grammar:
 *   dotted outline   = provisional / in transit / unverified
 *   solid fill       = verified, lit
 *   ring             = the canonical, central record
 *   dashed + empty   = a GAP, a step with no certified skill
 *   pulsing dotted   = live, in progress
 *
 * Shape carries the state on its own, so colour is never the only signal. The node is decorative;
 * callers always render a text label beside it.
 */
export type NodeState = "observed" | "transferred" | "certified" | "gap" | "live" | "failed";

export default function StatusNode({
  state,
  size = "md",
}: {
  state: NodeState;
  size?: "sm" | "md" | "lg";
}): JSX.Element {
  return <span className={`${styles.node} ${styles[state]} ${styles[size]}`} aria-hidden="true" />;
}
