import type { JSX } from "react";
import type { AgentIdentity, TransferResult } from "@/lib/types";
import AgentCard from "./AgentCard";
import ChecksTable from "./ChecksTable";
import styles from "./TransferExam.module.css";

export interface IsolationFact {
  name: string;
  passed: boolean;
  detail: string;
}

export default function TransferExam({
  transfer,
  teacher,
  teacherCase,
  isolation,
}: {
  transfer: TransferResult;
  teacher: AgentIdentity;
  teacherCase: string;
  isolation: IsolationFact[];
}): JSX.Element {
  const studentNote = `Never saw the teacher's answer — worked only from the recalled procedure${
    transfer.procedureId ? ` (${transfer.procedureId})` : ""
  }.`;

  return (
    <div className={styles.exam}>
      <div className="grid2">
        <AgentCard role="teacher" agent={teacher} caseLabel={teacherCase} />
        <AgentCard role="student" agent={transfer.student} caseLabel={transfer.examCase} note={studentNote} />
      </div>

      <div className="card">
        <p className="cardTitle">Isolation</p>
        <p className="muted">
          Certification requires all of these to hold: a different agent, working only from the recalled
          procedure, on an unseen case.
        </p>
        <ul className={styles.list}>
          {isolation.map((fact) => (
            <li key={fact.name} className={styles.row}>
              <span className={`badge ${fact.passed ? "badge--pass" : "badge--fail"}`}>
                {fact.passed ? "PASS" : "FAIL"}
              </span>
              <span className="mono">{fact.name}</span>
              <span className="muted">{fact.detail}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <p className="cardTitle">Produced artifact</p>
        <dl className="kv">
          <dt>type</dt>
          <dd>{transfer.artifact.type}</dd>
          <dt>path</dt>
          <dd>{transfer.artifact.path}</dd>
          {transfer.runId ? (
            <>
              <dt>run</dt>
              <dd>{transfer.runId}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <ChecksTable result={transfer.verification} title="Deterministic verifier" />

      <p className={`${styles.verdict} ${transfer.passed ? styles.verdictPass : styles.verdictFail}`}>
        {transfer.passed
          ? "EXAM PASSED — the procedure transferred"
          : "EXAM FAILED — the skill stays `transferred`, not certified"}
      </p>
    </div>
  );
}
