"use client";

import { usePathname, useSearchParams } from "next/navigation";
import styles from "./ModeBadge.module.css";

/**
 * Answers one question and only one: where does the data on screen come from?
 *
 * What *happened* in a run (a failed trial, say) is a different question, so it rides beside the
 * badge as a scenario tag rather than inside it — otherwise the badge stops being trustworthy.
 */
type Mode = {
  key: "fiction" | "real" | "canonical" | "live";
  label: string;
  detail: string;
};

function resolve(pathname: string, params: URLSearchParams): Mode {
  if (pathname.startsWith("/arena")) {
    return { key: "live", label: "live", detail: "streaming from a running tournament" };
  }
  if (params.get("mode") === "live") {
    return { key: "canonical", label: "canonical", detail: "the promoted registry record" };
  }
  if (params.get("case") === "vercel") {
    return { key: "real", label: "real run", detail: "a real run, sanitized" };
  }
  return { key: "fiction", label: "demo fiction", detail: "invented fixture data" };
}

export default function ModeBadge() {
  const pathname = usePathname();
  const params = useSearchParams();
  const mode = resolve(pathname, params);
  const failed = params.get("outcome") === "failed" && !pathname.startsWith("/arena");

  return (
    <div className={styles.wrap}>
      <span className={`${styles.badge} ${styles[mode.key]}`} title={mode.detail}>
        <span className={styles.node} aria-hidden="true" />
        <span className={styles.label}>{mode.label}</span>
      </span>
      {failed ? <span className={styles.scenario}>scenario: failed trial</span> : null}
      <span className="sr-only">Data source: {mode.detail}.</span>
    </div>
  );
}
