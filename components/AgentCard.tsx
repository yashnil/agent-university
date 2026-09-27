import type { JSX } from "react";
import type { AgentIdentity } from "@/lib/types";
import StatusNode from "@/components/StatusNode";
import styles from "./AgentCard.module.css";

const ROLE_LABEL: Record<"teacher" | "student", string> = {
  teacher: "ORIGIN AGENT",
  student: "REPLICATING AGENT",
};

// The contract identifier for the case each role worked, mirroring the field names on the
// callers that feed AgentCard: TransferExam's own `teacherCase` prop for the origin column,
// and TransferResult's `examCase` for the replicating column (the unseen case).
const CASE_ID: Record<"teacher" | "student", string> = {
  teacher: "teacherCase",
  student: "examCase",
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
  const isStudent = role === "student";

  return (
    <div className={`panel ${styles.card} ${isStudent ? styles.student : styles.teacher}`}>
      <div className={styles.head}>
        <p className="panelTitle">{ROLE_LABEL[role]}</p>
        <span className="idTag">{role}</span>
        {isStudent ? <StatusNode state="live" size="sm" /> : null}
      </div>

      <p className={styles.name}>{agent.name}</p>

      <dl className="kv">
        <dt>id</dt>
        <dd>{agent.id}</dd>
        <dt>harness</dt>
        <dd>{agent.harness}</dd>
        <dt className={styles.caseDt}>
          case <span className="idTag">{CASE_ID[role]}</span>
        </dt>
        <dd>{caseLabel}</dd>
      </dl>

      {note ? <p className={`muted ${styles.note}`}>{note}</p> : null}
    </div>
  );
}
