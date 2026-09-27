import type { JSX } from "react";
import type { AgentIdentity } from "@/lib/types";
import styles from "./AgentCard.module.css";

const ROLE_LABEL: Record<"teacher" | "student", string> = {
  teacher: "ORIGIN AGENT",
  student: "REPLICATING AGENT",
};

export default function AgentCard({
  role,
  agent,
  caseLabel,
  note,
}: {
  role: "teacher" | "student";
  agent: AgentIdentity;
  caseLabel: string;
  note?: string;
}): JSX.Element {
  const accent = role === "student" ? styles.student : styles.teacher;

  return (
    <div className={`card ${styles.agentCard} ${accent}`}>
      <p className="cardTitle">{ROLE_LABEL[role]}</p>
      <p className={styles.name}>{agent.name}</p>
      <dl className="kv">
        <dt>id</dt>
        <dd>{agent.id}</dd>
        <dt>harness</dt>
        <dd>{agent.harness}</dd>
        <dt>case</dt>
        <dd>{caseLabel}</dd>
      </dl>
      {note ? <p className={`faint ${styles.note}`}>{note}</p> : null}
    </div>
  );
}
