import { Fragment } from "react";
import type { JSX } from "react";
import type { AgentUniversityEvent, EventPayloads, EventType, SkillStatus } from "@/lib/types";
import StatusNode, { type NodeState } from "@/components/StatusNode";
import LifecyclePath from "@/components/LifecyclePath";
import styles from "./LifecycleTimeline.module.css";

interface RowDescription {
  summary: string;
  details: [string, string][];
  state: NodeState;
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

// Node grammar reused for the event record: dotted (observed) for a raw, unverified
// occurrence; dotted-with-core (transferred) for a verified-but-not-certified check;
// solid ring (certified) for the one event that promotes a skill; dashed-empty (gap)
// for a missing-coverage record.
function eventNodeState(type: EventType): NodeState {
  switch (type) {
    case "skill.certified":
      return "certified";
    case "exam.passed":
      return "transferred";
    case "gap.discovered":
      return "gap";
    default:
      return "observed";
  }
}

function describeEvent(event: AgentUniversityEvent): RowDescription {
  switch (event.type) {
    case "skill.observed": {
      const p = event.payload as EventPayloads["skill.observed"];
      return {
        summary: `${p.teacher.name} (${p.teacher.id}), the origin agent, produced ${p.artifactType} in run ${p.runId}; verification passed ${countPassed(p.verification.checks)} checks.`,
        details: [
          ["skillId", p.skillId],
          ["artifactPath", p.artifactPath],
        ],
        state: eventNodeState(event.type),
      };
    }
    case "skill.recalled": {
      const p = event.payload as EventPayloads["skill.recalled"];
      const who = p.agent ? `${p.agent.name} (${p.agent.id})` : "an unnamed agent";
      const rankPart = p.rank !== undefined ? `, rank ${p.rank}` : "";
      return {
        summary: `${who}, the replicating agent, recalled ${p.procedureId} for the query "${p.query}"${rankPart}.`,
        details: [
          ["skillId", p.skillId],
          ["procedureId", p.procedureId],
        ],
        state: eventNodeState(event.type),
      };
    }
    case "exam.started": {
      const p = event.payload as EventPayloads["exam.started"];
      const fromPart = p.procedureId ? ` from ${p.procedureId}` : "";
      const runPart = p.runId ? `, run ${p.runId}` : "";
      return {
        summary: `${p.student.name} (${p.student.id}), the replicating agent, started a trial on unseen case ${p.examCase}${fromPart}${runPart}.`,
        details: [
          ["skillId", p.skillId],
          ["examCase", p.examCase],
        ],
        state: eventNodeState(event.type),
      };
    }
    case "exam.passed": {
      const p = event.payload as EventPayloads["exam.passed"];
      const atPart = p.artifactPath ? ` at ${p.artifactPath}` : "";
      return {
        summary: `The artifact${atPart} passed the trial's verifier, ${countPassed(p.verification.checks)} checks, on unseen case ${p.examCase}.`,
        details: [
          ["skillId", p.skillId],
          ["student", `${p.student.name} (${p.student.id})`],
        ],
        state: eventNodeState(event.type),
      };
    }
    case "skill.certified": {
      const p = event.payload as EventPayloads["skill.certified"];
      return {
        summary: `${p.skillId} certified: originated with ${p.teacher.name}, replicated by ${p.student.name} on unseen case ${p.examCase}.`,
        details: [
          ["teacher", p.teacher.id],
          ["student", p.student.id],
        ],
        state: eventNodeState(event.type),
      };
    }
    case "plan.composed": {
      const p = event.payload as EventPayloads["plan.composed"];
      const certifiedSteps = p.steps.filter((step) => step.status === "certified").length;
      const who = p.agent ? p.agent.name : "an unnamed agent";
      return {
        summary: `${who} composed ${p.planId} for "${p.goal}", with ${certifiedSteps} of ${p.steps.length} steps backed by certified skills.`,
        details: [
          ["planId", p.planId],
          ["steps", String(p.steps.length)],
        ],
        state: eventNodeState(event.type),
      };
    }
    case "gap.discovered": {
      const p = event.payload as EventPayloads["gap.discovered"] & { skillName?: string; status?: string };
      const neededByPart = p.neededBy ? `needed by ${p.neededBy}` : "no downstream artifact recorded";
      return {
        summary: `GAP: no certified skill covers ${p.missingArtifactType} (${neededByPart}: ${p.reason}).`,
        details: [
          ["planId", p.planId],
          ["missingArtifactType", p.missingArtifactType],
        ],
        state: eventNodeState(event.type),
      };
    }
    default: {
      const unknownType = event.type as string;
      return {
        summary: `${unknownType}: ${JSON.stringify(event.payload)}`,
        details: [],
        state: "observed",
      };
    }
  }
}

function hasEvent<T extends EventType>(events: AgentUniversityEvent[], type: T): boolean {
  return events.some((event) => event.type === type);
}

// The frozen lifecycle chain (docs/HANDOFF.md, docs/REPO_OVERVIEW.md §7):
//   observed -> recalled -> trial started -> trial passed -> transferred -> certified
// `transferred` is derived from Skill.status, not an event: runtime sets it, it never
// appears in the event list. `exam.passed` and `skill.certified` are certification's,
// and are absent for runs that stopped at `transferred`.
interface ChainStep {
  id: string;
  label: string;
  identifier: string;
  producer: string;
  satisfied: boolean;
}

function buildChain(events: AgentUniversityEvent[], status: SkillStatus): ChainStep[] {
  const observed = hasEvent(events, "skill.observed");
  const recalled = hasEvent(events, "skill.recalled");
  const examStarted = hasEvent(events, "exam.started");
  const examPassed = hasEvent(events, "exam.passed");
  const transferred = status === "transferred" || status === "certified";
  const certified = hasEvent(events, "skill.certified") || status === "certified";

  return [
    { id: "observed", label: "Observed", identifier: "skill.observed", producer: "runtime", satisfied: observed },
    { id: "recalled", label: "Recalled", identifier: "skill.recalled", producer: "runtime", satisfied: recalled },
    {
      id: "exam-started",
      label: "Trial started",
      identifier: "exam.started",
      producer: "runtime",
      satisfied: examStarted,
    },
    {
      id: "exam-passed",
      label: "Trial passed",
      identifier: "exam.passed",
      producer: "certification",
      satisfied: examPassed,
    },
    {
      id: "transferred",
      label: "Transferred",
      identifier: "status",
      producer: "status, not an event",
      satisfied: transferred,
    },
    {
      id: "certified",
      label: "Certified",
      identifier: "skill.certified",
      producer: "certification",
      satisfied: certified,
    },
  ];
}

// Step 5 has no event of its own — it can never appear in the event list — so its node
// reads as the "transferred" state the moment it's satisfied, and step 6 reads as the
// ringed "certified" state. Every other satisfied step reads as a plain lit "observed"
// node; unsatisfied steps are always the dashed, empty "gap" node.
function nodeStateFor(step: ChainStep): NodeState {
  if (!step.satisfied) return "gap";
  if (step.id === "certified") return "certified";
  if (step.id === "transferred") return "transferred";
  return "observed";
}

// Derives one line of truth from the chain: never a hardcoded, case-specific sentence.
function describeChain(steps: ChainStep[]): string {
  const satisfied = steps.map((step) => step.satisfied);
  const [, , , examPassed, transferred, certified] = satisfied;

  if (certified) {
    return "Certified: a different agent reproduced this procedure on an unseen case and the verifier agreed.";
  }
  if (transferred) {
    return examPassed
      ? "Proven, not yet certified: the trial passed but certification has not applied its policy."
      : "Transferred: the transfer is recorded and awaiting the certification decision.";
  }
  const firstPendingIndex = satisfied.findIndex((step) => !step);
  const stoppedAt = steps[firstPendingIndex].label.toLowerCase();
  return `Not yet transferred: the chain stops at "${stoppedAt}" — that step has not happened yet.`;
}

function statusTagClass(status: SkillStatus): string {
  if (status === "certified") return "tag tag--pass";
  if (status === "transferred") return "tag tag--accent";
  return "tag tag--muted";
}

// Renders the full skill lifecycle: the 6-step observed -> certified chain (forward-only
// StatusNodes joined by LifecyclePaths), the one derived sentence of current truth, and
// the event record below it — one hairline-ruled row per event, in the order given.
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
    <section className={`panel ${styles.wrapper}`}>
      <div className={styles.header}>
        <h3 className="panelTitle">Lifecycle timeline</h3>
        <span className={statusTagClass(status)}>{status}</span>
      </div>

      <div className={styles.chainScroll}>
        <ol className={styles.chain}>
          {steps.map((step, index) => {
            const nodeState = nodeStateFor(step);
            return (
              <Fragment key={step.id}>
                <li className={styles.step}>
                  <StatusNode state={nodeState} size="md" />
                  <span className={`mono ${styles.stepNum}`}>{index + 1}</span>
                  <span className={styles.stepLabel}>{step.label}</span>
                  <span className="idTag">{step.identifier}</span>
                  <span className={styles.producerLine}>
                    {step.id === "transferred" ? (
                      <span className="tag tag--accent">{step.producer}</span>
                    ) : (
                      step.producer
                    )}
                  </span>
                  <span className={styles.stateWord}>{step.satisfied ? "recorded" : "pending"}</span>
                </li>
                {index < steps.length - 1 && (
                  <li className={styles.pathItem} aria-hidden="true">
                    <LifecyclePath done={step.satisfied} orientation="horizontal" />
                  </li>
                )}
              </Fragment>
            );
          })}
        </ol>
      </div>

      <p className={styles.narrative}>{narrative}</p>

      <ol className={styles.timeline}>
        {events.map((event, index) => {
          const { summary, details, state } = describeEvent(event);
          const isLast = index === events.length - 1;
          const isGap = event.type === "gap.discovered";
          const rowContentClassName = isGap ? `${styles.content} ${styles.gapContent}` : styles.content;

          return (
            <li key={`${event.type}-${event.at}-${index}`} className={styles.row}>
              <div className={styles.rail}>
                <StatusNode state={state} size="sm" />
                {!isLast && (
                  <span className={styles.railLine}>
                    <LifecyclePath done orientation="vertical" />
                  </span>
                )}
              </div>
              <div className={rowContentClassName}>
                <div className={styles.rowHead}>
                  <span className="mono">{event.type}</span>
                  <span className={`mono ${styles.timestamp}`}>{formatTimestamp(event.at)}</span>
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
