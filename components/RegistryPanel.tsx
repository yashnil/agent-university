import type { JSX } from "react";
import type { SkillStatus } from "@/lib/types";
import SkillStatusChip from "./SkillStatusChip";
import styles from "./RegistryPanel.module.css";

// The organization's canonical register: what every agent may inherit. A row is
// written only by a promotion (skill.certified), never by a run — so this panel
// reads like an accreditation office's record book, not a live status view.
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
    <section className={`panel ${styles.panel}`} aria-label="Certified skills registry">
      <header className={styles.header}>
        <p className="panelTitle">Certified skills registry</p>
        <span className="muted count">
          {rows.length} certified {rows.length === 1 ? "skill" : "skills"}
        </span>
        <span className="mono muted">{source}</span>
      </header>

      {note ? <p className={`muted ${styles.note}`}>{note}</p> : null}

      {rows.length === 0 ? (
        <p className="muted">nothing is certified yet — no agent may inherit anything</p>
      ) : (
        <ol className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.name}>{row.name}</span>
                <SkillStatusChip status={row.status} />
                <span className={styles.tags}>
                  <span className="mono">{row.id}</span>
                  <span className="mono">{row.artifactType}</span>
                </span>
              </div>

              <dl className="kv">
                <dt>
                  origin agent <span className="idTag">teacher</span>
                </dt>
                <dd>
                  {row.teacher.name} <span className="mono">{row.teacher.id}</span>
                </dd>
                <dt>
                  replicating agent <span className="idTag">student</span>
                </dt>
                <dd>
                  {row.student.name} <span className="mono">{row.student.id}</span>
                </dd>
                <dt>
                  unseen case <span className="idTag">examCase</span>
                </dt>
                <dd className="mono">{row.examCase}</dd>
                <dt>policy</dt>
                <dd className="mono">{row.policy}</dd>
                <dt>certified at</dt>
                <dd className="mono">{formatCertifiedAt(row.certifiedAt)}</dd>
                <dt>record</dt>
                <dd className="mono">{row.record}</dd>
              </dl>

              {row.procedure ? (
                <div className={styles.procedure}>
                  <div className={styles.procedureHead}>
                    <span className="tag tag--accent">champion flow</span>
                    <span className="muted">won its tournament</span>
                  </div>
                  <p className={styles.procedureTitle}>{row.procedure.title}</p>
                  <dl className="kv">
                    <dt>procedure</dt>
                    <dd className="mono">{row.procedure.procedureId}</dd>
                    <dt>runs</dt>
                    <dd className="mono">{row.procedure.runs}</dd>
                    <dt>pass rate</dt>
                    <dd className="mono">{formatPassRate(row.procedure.passRate)}</dd>
                    <dt>judge score</dt>
                    <dd className="mono">{formatJudgeScore(row.procedure.judgeScore)}</dd>
                    <dt>tournament</dt>
                    <dd className="mono muted">{row.procedure.tournamentId}</dd>
                    <dt>record</dt>
                    <dd className="mono muted">{row.procedure.record}</dd>
                  </dl>
                </div>
              ) : (
                <p className={`muted ${styles.noProcedure}`}>
                  certified by a single trial — no flow tournament was run for this skill
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
