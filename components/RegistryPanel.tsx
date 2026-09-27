import type { JSX } from "react";
import type { SkillStatus } from "@/lib/types";
import SkillStatusChip from "./SkillStatusChip";
import styles from "./RegistryPanel.module.css";

export interface RegistryRow {
  id: string;
  name: string;
  status: SkillStatus;
  artifactType: string;
  teacher: { id: string; name: string; harness: string };
  student: { id: string; name: string; harness: string };
  examCase: string;
  procedureId?: string;
  certifiedAt: string;
  policy: string;
  record: string;
  procedure?: {
    procedureId: string;
    title: string;
    passRate: number;
    runs: number;
    judgeScore: number | null;
    tournamentId: string;
    record: string;
  };
}

// Deterministic, locale-free formatting for an ISO 8601 UTC timestamp — never
// toLocaleString, which renders differently on the server and in the browser
// and trips a hydration mismatch warning.
function formatCertifiedAt(iso: string): string {
  return `${iso.slice(0, 19).replace("T", " ")} UTC`;
}

function formatPassRate(passRate: number): string {
  return `${Math.round(passRate * 100)}%`;
}

function formatJudgeScore(judgeScore: number | null): string {
  return judgeScore === null ? "not judged" : `${judgeScore}/10`;
}

export default function RegistryPanel({
  rows,
  source,
  note,
}: {
  rows: RegistryRow[];
  source: string;
  note?: string;
}): JSX.Element {
  return (
    <div className="card">
      <div className={styles.header}>
        <p className="cardTitle">What the organization trusts</p>
        <span className="faint mono">
          {rows.length} certified {rows.length === 1 ? "skill" : "skills"}
        </span>
        <span className="faint mono">{source}</span>
      </div>

      {note ? <p className={styles.note}>{note}</p> : null}

      {rows.length === 0 ? (
        <p className="faint">nothing is certified yet — no agent may inherit anything</p>
      ) : (
        <ol className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.name}>{row.name}</span>
                <SkillStatusChip status={row.status} />
                <span className="faint mono">{row.id}</span>
                <span className="faint mono">{row.artifactType}</span>
              </div>

              <dl className="kv">
                <dt>taught by</dt>
                <dd>
                  {row.teacher.name} ({row.teacher.id})
                </dd>
                <dt>proved by</dt>
                <dd>
                  {row.student.name} ({row.student.id})
                </dd>
                <dt>exam case</dt>
                <dd>{row.examCase}</dd>
                <dt>policy</dt>
                <dd>{row.policy}</dd>
                <dt>certified at</dt>
                <dd>{formatCertifiedAt(row.certifiedAt)}</dd>
                <dt>record</dt>
                <dd>{row.record}</dd>
              </dl>

              {row.procedure ? (
                <div className={styles.procedure}>
                  <p className={styles.procedureLabel}>
                    <span aria-hidden="true">★</span> champion flow — won its tournament
                  </p>
                  <p className={styles.procedureTitle}>{row.procedure.title}</p>
                  <dl className="kv">
                    <dt>procedure</dt>
                    <dd>{row.procedure.procedureId}</dd>
                    <dt>runs</dt>
                    <dd>{row.procedure.runs}</dd>
                    <dt>pass rate</dt>
                    <dd>{formatPassRate(row.procedure.passRate)}</dd>
                    <dt>judge score</dt>
                    <dd>{formatJudgeScore(row.procedure.judgeScore)}</dd>
                    <dt>tournament</dt>
                    <dd className="faint">{row.procedure.tournamentId}</dd>
                    <dt>record</dt>
                    <dd className="faint">{row.procedure.record}</dd>
                  </dl>
                </div>
              ) : (
                <p className={styles.noProcedure}>
                  certified by a single exam — no flow tournament was run for this skill
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
