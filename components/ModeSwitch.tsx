import Link from "next/link";
import type { JSX } from "react";
import type { DemoCaseId, Mode, Outcome } from "@/app/_lib/data";
import styles from "./ModeSwitch.module.css";

/**
 * Chooses the data source. The header badge *states* which source is live; this switches it.
 *
 * Scenario ("what happened") is deliberately a separate control from source ("where is this
 * from"), so neither question contaminates the other.
 */
export default function ModeSwitch({
  mode,
  demoCase,
  outcome,
  source,
}: {
  mode: Mode;
  demoCase: DemoCaseId;
  outcome: Outcome;
  source: string;
}): JSX.Element {
  const sources = [
    {
      key: "fiction",
      label: "Demo fiction",
      detail: "invented fixtures",
      href: `/?mode=demo&case=northwind&outcome=${outcome}`,
      current: mode === "demo" && demoCase === "northwind",
    },
    {
      key: "real",
      label: "Real run",
      detail: "sanitized, stops at transferred",
      href: `/?mode=demo&case=vercel&outcome=${outcome}`,
      current: mode === "demo" && demoCase === "vercel",
    },
    {
      key: "canonical",
      label: "Canonical",
      detail: "the promoted registry record",
      href: `/?mode=live&case=${demoCase}&outcome=${outcome}`,
      current: mode === "live",
    },
  ];

  return (
    <div className={styles.wrap}>
      <p className={styles.legend}>Data source</p>
      <ul className={styles.list}>
        {sources.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              aria-current={s.current ? "true" : undefined}
              className={`${styles.item} ${s.current ? styles.current : ""}`}
            >
              <span className={styles.label}>{s.label}</span>
              <span className={styles.detail}>{s.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className={styles.source}>
        <span className="muted">reading</span> <span className="mono">{source}</span>
      </p>
    </div>
  );
}
