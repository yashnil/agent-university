import type { JSX } from "react";
import type { Mode } from "@/app/_lib/data";
import styles from "./ModeSwitch.module.css";

// Segmented control for the demo/live toggle. Rendered by a server component and driven
// purely by the `?mode=` search param, so it needs zero client JS: each option is a plain
// link, and the page (a server component reading searchParams) re-renders with the new mode.
const OPTIONS: { mode: Mode; label: string }[] = [
  { mode: "demo", label: "Demo (fixtures)" },
  { mode: "live", label: "Live (runtime)" },
];

export default function ModeSwitch({ mode, source }: { mode: Mode; source: string }): JSX.Element {
  return (
    <div className={styles.wrap}>
      <div className={styles.switch} role="group" aria-label="Data mode">
        {OPTIONS.map((option) => {
          const active = option.mode === mode;
          return (
            <a
              key={option.mode}
              href={`?mode=${option.mode}`}
              className={active ? `${styles.option} ${styles.active}` : styles.option}
              aria-current={active ? "page" : undefined}
            >
              {option.label}
            </a>
          );
        })}
      </div>
      <p className={`mono faint ${styles.source}`}>data: {source}</p>
    </div>
  );
}
