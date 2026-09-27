import type { JSX } from "react";
import type { ArenaEvent } from "@/app/_lib/arena-jobs";
import { fmtTime } from "./state";
import styles from "./EventLog.module.css";

function describe(e: ArenaEvent): string {
  switch (e.type) {
    case "tournament.started":
      return `${e.tournamentId} · ${e.heats.length} heats × ${e.perHeat} · ${e.dry ? "dry" : "live"} · judge ${e.judgeModel ?? "fixture"}`;
    case "student.started":
      return `heat ${e.heat} · ${e.student.name}`;
    case "student.finished":
      return `heat ${e.heat} · ${e.student.name} · ${e.certified ? "CERTIFIED" : `not certified (${[...e.failedRules, ...e.failedChecks].join(", ") || e.error || e.status})`}`;
    case "heat.finished":
      return `heat ${e.heat} · ${e.examCase} · ${e.certifiedCount} certified · ${e.winner ? `winner ${e.winner.student.name}` : "no finalist"}`;
    case "final.started":
      return `${e.finalists.length} finalist(s): ${e.finalists.map((f) => f.student.name).join(", ") || "none"}`;
    case "final.finished":
      return `judge ${e.judge.status}${e.judge.reason ? ` (${e.judge.reason})` : ""} · ${e.ranking.map((r) => `#${r.place} ${r.student.name}${r.score !== null ? ` ${r.score}` : ""}`).join(", ")}`;
    case "tournament.finished":
      return e.champion ? `champion ${e.champion.student.name} (heat ${e.champion.heat}) · promoted ${String(e.promoted)} · ${e.registry}` : "no champion";
    case "error":
      return e.message;
  }
}

export default function EventLog({ events }: { events: ArenaEvent[] }): JSX.Element {
  return (
    <details className={`section ${styles.log}`}>
      <summary className={styles.summary}>
        <span className="sectionNum">log</span> Event stream <span className="mono faint">({events.length})</span>
      </summary>
      <ol className={styles.list}>
        {events.map((e, k) => (
          <li key={k} className={e.type === "error" ? styles.err : ""}>
            <span className="mono faint">{fmtTime(e.at)}</span>
            <span className={`mono ${styles.type}`}>{e.type}</span>
            <span className={styles.text}>{describe(e)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
