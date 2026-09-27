import type { JSX } from "react";
import type { CompositeMetrics } from "@/lib/composite";
import styles from "./MetricsPanel.module.css";

// Only values derived from the registry record, the composite run, or recorded QM run metadata
// (demo/fixtures/run-metrics.json). Anything not recorded shows as "not recorded", never a guess.
const secs = (ms: number | null) => (ms === null ? null : `${(ms / 1000).toFixed(1)} s`);

export default function MetricsPanel({ metrics }: { metrics: CompositeMetrics }): JSX.Element {
  const tiles: [string, string, string][] = [
    ["verified checks passed", metrics.verifiedChecks ? `${metrics.verifiedChecks.passed}/${metrics.verifiedChecks.total}` : "—",
      "the replica's artifact, deterministic verifier"],
    ["certified skills reused", String(metrics.certifiedSkillsReused), "inherited by the fresh Intern"],
    ["steps solved from certified capability", `${metrics.stepsFromCertified} of ${metrics.stepsTotal}`,
      `${metrics.stepsFromFixtures} from labelled stand-ins, ${metrics.blockedSteps} blocked`],
    ["gaps discovered", String(metrics.gapsDiscovered), `${metrics.candidatesCreated} new candidate skill${metrics.candidatesCreated === 1 ? "" : "s"}`],
  ];
  return (
    <div className={`card ${styles.panel}`}>
      <h3 className="cardTitle">Metrics</h3>
      <div className={styles.tiles}>
        {tiles.map(([label, value, sub]) => (
          <div key={label} className={styles.tile}>
            <span className={styles.value}>{value}</span>
            <span className={styles.label}>{label}</span>
            <span className={`faint ${styles.sub}`}>{sub}</span>
          </div>
        ))}
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>research step</th>
            <th>verifier</th>
            <th>wall-clock</th>
            <th>tool calls</th>
            <th>tokens</th>
          </tr>
        </thead>
        <tbody>
          {metrics.comparison.map((row) => (
            <tr key={row.role}>
              <td>
                {row.label}
                <div className="mono faint">{row.runId ? `run ${row.runId.slice(0, 8)} · ${row.note}` : row.note}</div>
              </td>
              <td className="mono">{row.verification ?? "—"}</td>
              <td className="mono">{secs(row.wallClockMs) ?? (row.role === "intern" ? "not re-run" : "not recorded")}</td>
              <td className="mono">
                {row.shellToolCalls !== null
                  ? `${row.shellToolCalls} shell${row.failedShellToolCalls ? ` (${row.failedShellToolCalls} failed)` : ""}`
                  : row.toolCalls != null ? `${row.toolCalls} (all tools)` : "not recorded"}
              </td>
              <td className="mono faint">{row.tokens ?? "not recorded"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`faint ${styles.caveat}`}>
        Single recorded runs, not a benchmark. Each row&apos;s numbers come only from that row&apos;s own run; a run with
        nothing recorded says so. The Intern re-ran nothing. QM records no token usage, so none is shown. Sources:{" "}
        <span className="mono">{metrics.sources.join(", ")}</span>.
      </p>
    </div>
  );
}
