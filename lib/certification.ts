// Certification engine output, for the UI. Owned by feat/certification.
//
// Canonical definition: schemas/certification-record.schema.json (produced by scripts/certify.py).
// `npm test` (scripts/check_contracts.py) fails if CertificationRecord's fields drift from it.
// Only frozen contract types from ./types are reused; nothing in ./types changes.
//
// Where the UI reads it:
//   registry/index.json            RegistryIndex: one row per certified skill
//   registry/skills/<id>.json      CertificationRecord: the canonical record of a certified skill
//   registry/ledger.jsonl          CertificationRecord per line: every decision, pass or fail
//   demo/fixtures/certification-record{,-failed}.json   demo mode

import type { AgentIdentity, AgentUniversityEvent, ArtifactType, Skill, SkillStatus, VerificationResult } from "./types";

// Stable rule ids of policy au-transfer-v1, in evaluation order.
export type CertificationRule =
  | "teacher_run_verified"
  | "procedure_recalled"
  | "exam_case_unseen"
  | "student_distinct_from_teacher"
  | "artifact_matches_skill"
  | "verifier_checks_complete"
  | "verifier_checks_passed"
  | "isolation_attested";

export interface Ruling {
  rule: CertificationRule;
  passed: boolean;
  reason: string; // human-readable, show it verbatim
  evidence: Record<string, unknown>;
}

export interface CertificationRecord {
  recordVersion: number;
  skill: Skill; // status is the decision's outcome
  teacher: AgentIdentity;
  procedureId?: string;
  transfer: {
    student: AgentIdentity;
    examCase: string;
    examCompany?: string;
    runId?: string;
    artifact: { type?: ArtifactType; path?: string };
    passed: boolean;
  };
  verification: VerificationResult;
  decision: {
    certified: boolean;
    status: SkillStatus;
    policy: { id: string; rules: CertificationRule[]; requireIsolation?: boolean };
    summary: string; // "CERTIFIED: all 8 rules passed" | "NOT CERTIFIED (transferred): failed …"
    failedRules: CertificationRule[];
    rulings: Ruling[];
    decidedAt: string;
    inputsDigest: string;
  };
  events: AgentUniversityEvent[]; // exam.passed and/or skill.certified, when earned
  metrics?: { durationMs?: number; toolCalls?: number; turns?: number; costUsd?: number };
}

export interface RegistryIndex {
  skills: {
    id: string;
    name: string;
    status: SkillStatus;
    artifactType: ArtifactType;
    teacher: AgentIdentity;
    student: AgentIdentity;
    examCase: string;
    procedureId?: string;
    certifiedAt: string;
    policy: string;
    record: string; // repo path of the canonical CertificationRecord
  }[];
}
