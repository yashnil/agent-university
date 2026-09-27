import type { JSX, ReactNode } from "react";
import styles from "./ArtifactCard.module.css";

/**
 * The JSON an evaluator came to read. Native <details>, so it needs no client JS and stays
 * keyboard-operable; the body scrolls inside the panel rather than widening the page.
 */
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
  const body =
    json !== undefined ? JSON.stringify(json, null, 2) : markdown !== undefined ? markdown : null;

  return (
    <details className={`panel ${styles.card}`} open={open}>
      <summary className={styles.summary}>
        <span className={styles.glyph} aria-hidden="true" />
        <span className={styles.title}>{title}</span>
        {badge ? <span className={styles.badge}>{badge}</span> : null}
      </summary>
      {path ? <p className={`mono ${styles.path}`}>{path}</p> : null}
      <div className={styles.body}>
        {body === null ? <p className="muted">no artifact</p> : <pre className="code">{body}</pre>}
      </div>
    </details>
  );
}
