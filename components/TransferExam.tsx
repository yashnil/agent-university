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
  const replicatingNote = `The replicating agent never saw the origin agent's answer — worked only from the recalled procedure${
    transfer.procedureId ? ` (${transfer.procedureId})` : ""
  }.`;

  const passedIsolation = isolation.filter((fact) => fact.passed).length;

  return (
    <div className={styles.exam}>
      <div className="grid2">
        <AgentCard role="teacher" agent={teacher} caseLabel={teacherCase} />
        <AgentCard role="student" agent={transfer.student} caseLabel={transfer.examCase} note={replicatingNote} />
      </div>

      <section className="panel" aria-label="Isolation">
        <div className={styles.isolationHead}>
          <p className="panelTitle">Isolation</p>
          <span className="muted count mono">
            {passedIsolation}/{isolation.length}
          </span>
        </div>
        {isolation.length === 0 ? (
          <p className="muted">no isolation facts recorded</p>
        ) : (
          <ul className={styles.list}>
            {isolation.map((fact) => (
              <li key={fact.name} className={styles.row}>
                <span className={`tag ${fact.passed ? "tag--pass" : "tag--fail"}`}>
                  <span aria-hidden="true">{fact.passed ? "✓" : "✗"}</span>
                  {fact.passed ? "pass" : "fail"}
                </span>
                <span className={`mono ${styles.factName}`}>{fact.name}</span>
                <span className={`muted ${styles.detail}`}>{fact.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-label="Produced artifact">
        <p className="panelTitle">Produced artifact</p>
        <dl className="kv">
          <dt>type</dt>
          <dd className="mono">{transfer.artifact.type}</dd>
          <dt>path</dt>
          <dd>{transfer.artifact.path}</dd>
          {transfer.runId ? (
            <>
              <dt>runId</dt>
              <dd>{transfer.runId}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <ChecksTable result={transfer.verification} title="Deterministic verifier" />

      <p className={`${styles.verdict} ${transfer.passed ? styles.pass : styles.fail}`}>
        {transfer.passed ? (
          "TRIAL PASSED — the procedure transferred"
        ) : (
          <>
            TRIAL FAILED — the skill stays at <span className="mono">transferred</span>, nothing is promoted
          </>
        )}
      </p>
    </div>
  );
}
