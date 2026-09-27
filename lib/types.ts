// Agent University shared contracts: FROZEN for the first parallel sprint.
//
// The canonical definitions are the JSON Schemas in schemas/ (Python and the runtime
// validate against those). This file mirrors them for TypeScript consumers.
// `npm test` (scripts/check_contracts.py) fails if a field here and in the schema diverge.
// Change a contract only at a merge checkpoint, in schemas/ AND here, in one commit on main.

// schemas/contracts/skill.schema.json#/$defs/SkillStatus
export type SkillStatus = "observed" | "transferred" | "certified";

// schemas/contracts/skill.schema.json#/$defs/ArtifactType, the pipeline in order:
// company.json -> repo_analysis.json -> score.json -> outreach.md
export type ArtifactType = "company.json" | "repo_analysis.json" | "score.json" | "outreach.md";

// schemas/contracts/agent-identity.schema.json
export interface AgentIdentity {
  id: string;
  name: string;
  harness: string;
}

// schemas/contracts/skill.schema.json
export interface Skill {
  id: string;
  name: string;
  status: SkillStatus;
  teacher: AgentIdentity;
  artifactType: string;
  procedureId?: string;
  transfer?: { student: AgentIdentity; examCase: string; passed: boolean };
}

// schemas/contracts/verification-result.schema.json
export interface VerificationResult {
  passed: boolean;
  checks: { name: string; passed: boolean; message?: string }[];
}

// schemas/contracts/transfer-result.schema.json
export interface TransferResult {
  skillId: string;
  procedureId?: string;
  examCase: string;
  student: AgentIdentity;
  runId?: string;
  artifact: { type: ArtifactType; path: string };
  verification: VerificationResult;
  passed: boolean;
}

// schemas/contracts/event.schema.json
export type EventType =
  | "skill.observed"
  | "skill.recalled"
  | "exam.started"
  | "exam.passed"
  | "skill.certified"
  | "plan.composed"
  | "gap.discovered";

export interface EventPayloads {
  "skill.observed": {
    skillId: string;
    teacher: AgentIdentity;
    artifactType: ArtifactType;
    runId: string;
    artifactPath: string;
    verification: VerificationResult;
  };
  "skill.recalled": { skillId: string; procedureId: string; query: string; rank?: number; agent?: AgentIdentity };
  "exam.started": { skillId: string; procedureId?: string; examCase: string; student: AgentIdentity; runId?: string };
  "exam.passed": {
    skillId: string;
    examCase: string;
    student: AgentIdentity;
    artifactPath?: string;
    verification: VerificationResult;
  };
  "skill.certified": {
    skillId: string;
    teacher: AgentIdentity;
    student: AgentIdentity;
    examCase: string;
    procedureId?: string;
  };
  "plan.composed": {
    planId: string;
    goal: string;
    agent?: AgentIdentity;
    steps: { artifactType: ArtifactType; skillId?: string; status: "certified" | "uncertified" | "missing" }[];
  };
  "gap.discovered": {
    planId: string;
    goal: string;
    missingArtifactType: ArtifactType;
    neededBy?: ArtifactType;
    reason: string;
  };
}

export interface AgentUniversityEvent<T extends EventType = EventType> {
  type: T;
  at: string; // ISO 8601 UTC
  payload: EventPayloads[T];
}
