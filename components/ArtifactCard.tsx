import type { JSX, ReactNode } from "react";
import styles from "./ArtifactCard.module.css";

// Collapsible artifact viewer built on <details>/<summary> — no client JS required, and
// keyboard/AT behaviour (Enter/Space to toggle, native focus handling) comes for free.
export default function ArtifactCard({
  title,
  path,
  json,
  markdown,
  badge,
  open,
}: {
  title: string;
  path?: string;
  json?: unknown;
  markdown?: string;
  badge?: ReactNode;
  open?: boolean;
}): JSX.Element {
  const hasJson = json !== undefined;
  const hasMarkdown = markdown !== undefined;

  return (
    <details className={`card ${styles.details}`} open={open}>
      <summary className={styles.summary}>
        <span className={styles.disclosure} aria-hidden="true" />
        <span className={styles.title}>{title}</span>
        {badge ? <span className={styles.badge}>{badge}</span> : null}
        {path ? <span className={`mono faint ${styles.path}`}>{path}</span> : null}
      </summary>
      <div className={styles.body}>
        {hasJson ? (
          <pre className="code">{JSON.stringify(json, null, 2)}</pre>
        ) : hasMarkdown ? (
          <pre className="code">{markdown}</pre>
        ) : (
          <p className={`faint ${styles.empty}`}>no artifact</p>
        )}
      </div>
    </details>
  );
}
