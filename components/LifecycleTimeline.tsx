import { Fragment } from "react";
import type { JSX } from "react";
import type { AgentUniversityEvent, EventPayloads, EventType } from "@/lib/types";
import SkillStatusChip from "./SkillStatusChip";
import styles from "./LifecycleTimeline.module.css";

type DotColor = "pass" | "accent" | "warn" | "neutral";

interface RowDescription {
  summary: string;
  details: [string, string][];
  dot: DotColor;
}

// Fixed, deterministic timestamp rendering (no toLocaleString) so server and
// client markup always match and hydration never warns. "2026-01-01T00:00:00Z"
// -> "2026-01-01 00:00:00".
function formatTimestamp(at: string): string {
  return at.length >= 19 ? `${at.slice(0, 10)} ${at.slice(11, 19)}` : at;
}

function countPassed(checks: { passed: boolean }[]): string {
  const passed = checks.filter((check) => check.passed).length;
  return `${passed}/${checks.length}`;
}

function describeEvent(event: AgentUniversityEvent): RowDescription {
  switch (event.type) {
    case "skill.observed": {
      const p = event.payload as EventPayloads["skill.observed"];
      return {
        summary: `${p.teacher.name} (${p.teacher.id}) produced ${p.artifactType} in run ${p.runId}, verification passed ${countPassed(p.verification.checks)} checks.`,
        details: [
          ["skillId", p.skillId],
          ["artifactPath", p.artifactPath],
        ],
        dot: "neutral",
      };
    }
    case "skill.recalled": {
      const p = event.payload as EventPayloads["skill.recalled"];
      const who = p.agent ? `${p.agent.name} (${p.agent.id})` : "the student agent";
      const rankPart = p.rank !== undefined ? `, rank ${p.rank}` : "";
      return {
        summary: `${who} recalled ${p.procedureId} for the query "${p.query}"${rankPart}.`,
        details: [
          ["skillId", p.skillId],
          ["procedureId", p.procedureId],
        ],
        dot: "accent",
      };
    }
    case "exam.started": {
      const p = event.payload as EventPayloads["exam.started"];
      const fromPart = p.procedureId ? ` from ${p.procedureId}` : "";
      const runPart = p.runId ? `, run ${p.runId}` : "";
      return {
        summary: `${p.student.name} (${p.student.id}) started exam case ${p.examCase}${fromPart}${runPart}.`,
        details: [
          ["skillId", p.skillId],
          ["examCase", p.examCase],
        ],
        dot: "accent",
      };
    }
    case "exam.passed": {
      const p = event.payload as EventPayloads["exam.passed"];
      const atPart = p.artifactPath ? ` at ${p.artifactPath}` : "";
      return {
        summary: `The artifact${atPart} passed the deterministic verifier ${countPassed(p.verification.checks)} checks, for ${p.examCase}.`,
        details: [
          ["skillId", p.skillId],
          ["student", `${p.student.name} (${p.student.id})`],
        ],
        dot: "pass",
      };
    }
    case "skill.certified": {
      const p = event.payload as EventPayloads["skill.certified"];
      return {
        summary: `${p.skillId} certified: taught by ${p.teacher.name}, proved by ${p.student.name} on ${p.examCase}.`,
        details: [
          ["teacher", p.teacher.id],
          ["student", p.student.id],
        ],
        dot: "pass",
      };
    }
    case "plan.composed": {
      const p = event.payload as EventPayloads["plan.composed"];
      const certifiedSteps = p.steps.filter((step) => step.status === "certified").length;
      const who = p.agent ? p.agent.name : "a fresh agent";
      return {
        summary: `${who} composed ${p.planId} for "${p.goal}" with ${certifiedSteps} of ${p.steps.length} steps backed by certified skills.`,
        details: [
          ["planId", p.planId],
          ["steps", String(p.steps.length)],
        ],
        dot: "neutral",
      };
    }
    case "gap.discovered": {
      const p = event.payload as EventPayloads["gap.discovered"];
      const neededByPart = p.neededBy ? `needed by ${p.neededBy}` : "no downstream artifact recorded";
      return {
        summary: `GAP: ${p.missingArtifactType} has no certified skill (${neededByPart}: ${p.reason}).`,
        details: [
          ["planId", p.planId],
          ["missingArtifactType", p.missingArtifactType],
        ],
        dot: "warn",
      };
    }
    default: {
      const unknownType = event.type as string;
      return {
        summary: `${unknownType}: ${JSON.stringify(event.payload)}`,
        details: [],
        dot: "neutral",
      };
    }
  }
}

function reachedStatus(events: AgentUniversityEvent[], types: EventType[]): boolean {
  return events.some((event) => types.includes(event.type));
}

// Renders the full skill lifecycle as a vertical timeline, one row per event,
// in the order given, plus a compact status-progression summary above it.
export default function LifecycleTimeline({
  events,
}: {
  events: AgentUniversityEvent[];
}): JSX.Element {
  const observedReached = reachedStatus(events, ["skill.observed"]);
  const transferredReached = reachedStatus(events, ["exam.started", "exam.passed"]);
  const certifiedReached = reachedStatus(events, ["skill.certified"]);

  return (
    <section className={`card ${styles.wrapper}`}>
      <h3 className="cardTitle">Lifecycle Timeline</h3>

      <div className={styles.progression}>
        <SkillStatusChip status="observed" active={observedReached} />
        <span className={styles.arrow} aria-hidden="true">
          &rarr;
        </span>
        <SkillStatusChip status="transferred" active={transferredReached} />
        <span className={styles.arrow} aria-hidden="true">
          &rarr;
        </span>
        <SkillStatusChip status="certified" active={certifiedReached} />
      </div>

      <ol className={styles.timeline}>
        {events.map((event, index) => {
          const { summary, details, dot } = describeEvent(event);
          const isLast = index === events.length - 1;
          const rowContentClassName =
            event.type === "gap.discovered" ? `${styles.content} ${styles.gap}` : styles.content;

          return (
            <li key={`${event.type}-${event.at}-${index}`} className={styles.row}>
              <div className={styles.rail}>
                <span className={`${styles.dot} ${styles[`dot--${dot}`]}`} aria-hidden="true" />
                {!isLast && <span className={styles.line} aria-hidden="true" />}
              </div>
              <div className={rowContentClassName}>
                <div className={styles.rowHead}>
                  <span className={`mono ${styles.type}`}>{event.type}</span>
                  <span className="mono faint">{formatTimestamp(event.at)}</span>
                </div>
                <p className={styles.summary}>{summary}</p>
                {details.length > 0 && (
                  <dl className="kv">
                    {details.map(([key, value]) => (
                      <Fragment key={key}>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </Fragment>
                    ))}
                  </dl>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
