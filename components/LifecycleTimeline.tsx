import { Fragment } from "react";
import type { JSX } from "react";
import type { AgentUniversityEvent, EventPayloads, EventType, SkillStatus } from "@/lib/types";
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

function hasEvent<T extends EventType>(events: AgentUniversityEvent[], type: T): boolean {
  return events.some((event) => event.type === type);
}

// The frozen lifecycle chain (docs/HANDOFF.md, docs/REPO_OVERVIEW.md §7):
//   observed -> recalled -> exam started -> exam passed -> transferred -> certified
// `transferred` is derived from Skill.status, not an event: runtime sets it, it never
// appears in the event list. `exam.passed` and `skill.certified` are certification's,
// and are absent for runs that stopped at `transferred` (e.g. the live Vercel handoff).
interface ChainStep {
  id: string;
  label: string;
  producer: string;
  done: boolean;
}

function buildChain(events: AgentUniversityEvent[], status: SkillStatus): ChainStep[] {
  const observed = hasEvent(events, "skill.observed");
  const recalled = hasEvent(events, "skill.recalled");
  const examStarted = hasEvent(events, "exam.started");
  const examPassed = hasEvent(events, "exam.passed");
  const transferred = status === "transferred" || status === "certified";
  const certified = hasEvent(events, "skill.certified") || status === "certified";

  return [
    { id: "observed", label: "observed", producer: "runtime", done: observed },
    { id: "recalled", label: "recalled", producer: "runtime", done: recalled },
    { id: "exam-started", label: "exam started", producer: "runtime", done: examStarted },
    { id: "exam-passed", label: "exam passed", producer: "certification", done: examPassed },
    { id: "transferred", label: "transferred", producer: "status", done: transferred },
    { id: "certified", label: "certified", producer: "certification", done: certified },
  ];
}

// Derives one line of truth from the chain: never a hardcoded, case-specific sentence.
function describeChain(steps: ChainStep[]): string {
  const done = steps.map((step) => step.done);
  const [, , , examPassed, transferred, certified] = done;

  if (certified) {
    return "Certified: a different agent reproduced this procedure on an unseen case and the verifier agreed.";
  }
  if (transferred) {
    return examPassed
      ? "Proven, not yet certified: the exam passed but certification has not applied its policy."
      : "Transferred: the transfer is recorded and awaiting the certification decision.";
  }
  const firstPendingIndex = done.findIndex((step) => !step);
  const stoppedAt = steps[firstPendingIndex].label;
  return `Not yet transferred: the chain stops at "${stoppedAt}" — that step has not happened yet.`;
}

// Renders the full skill lifecycle as a vertical timeline, one row per event,
// in the order given, plus the 6-step observed -> certified chain above it.
export default function LifecycleTimeline({
  events,
  status,
}: {
  events: AgentUniversityEvent[];
  status: SkillStatus;
}): JSX.Element {
  const steps = buildChain(events, status);
  const narrative = describeChain(steps);

  return (
    <section className={`card ${styles.wrapper}`}>
      <div className={styles.header}>
        <h3 className="cardTitle">Lifecycle Timeline</h3>
        <SkillStatusChip status={status} />
      </div>

      <ol className={styles.chain}>
        {steps.map((step, index) => (
          <Fragment key={step.id}>
            <li className={`${styles.step} ${step.done ? styles.stepDone : styles.stepPending}`}>
              <span className={styles.stepNum}>{index + 1}</span>
              <span className={styles.stepLabel}>{step.label}</span>
              <span
                className={
                  step.producer === "status"
                    ? `${styles.stepProducer} ${styles.stepProducerStatus}`
                    : styles.stepProducer
                }
              >
                {step.producer}
              </span>
              <span className={styles.stepState}>{step.done ? "done" : "pending"}</span>
            </li>
            {index < steps.length - 1 && (
              <li className={styles.chainArrow} aria-hidden="true">
                &rarr;
              </li>
            )}
          </Fragment>
        ))}
      </ol>

      <p className={styles.narrative}>{narrative}</p>

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
