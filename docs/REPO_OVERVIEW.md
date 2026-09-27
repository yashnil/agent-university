# Agent University: repository overview

## 1. What it is

Agent University certifies that a procedure one agent learned **transfers** to a different,
fresh agent on an unseen task before the organization trusts it. North star: *one agent learns →
another agent proves it → every agent can inherit it.*

The demo skill is **Research Company**. It produces `company.json`. The teacher case is **Linear**
and the unseen exam case is **Vercel** (`demo/cases.json`).

## 2. Product thesis

A single successful agent run proves little: the agent may have memorized the answer, reused its
own sandbox, or been lucky. A procedure becomes an organizational capability only when:
- it is captured as a *method*, not an answer;
- a *different* agent with no access to the original answer recalls it;
- that agent solves a case the teacher never saw; and
- a *deterministic* verifier (no LLM judging) passes the result.

Every step leaves evidence, and certification is a pure function of that evidence.

## 3. Architecture

```
User / UI (Next.js, app/)  ── reads contracts + fixtures + registry, never QM internals
  ↓
Agent University orchestration (Python scripts/, TypeScript lib/)
  ├── QM runtime (@yc-software/qm 0.1.12, docker target)
  │    └── teacher + fresh student agents, each in its own Docker sandbox
  ├── Memorable (memorable-cli 0.5.19, local encrypted store)
  │    └── procedure capture (ingest) / recall (recall, show)
  ├── Certification engine (lib/certification.ts, policy au-transfer-v1)
  │    └── 8 deterministic evidence rules → CertificationRecord
  └── Registry (lib/registry.ts → registry/)
       └── canonical certified capabilities, index, append-only ledger

shared, frozen: schemas/contracts/*.schema.json ⇄ lib/types.ts (npm test fails on drift)
```

## 4. Role of QM

QM is the agent harness. It runs agents in per-scope Docker sandboxes with a real shell. This
directory is also the QM deployment: `qm.config.jsonc`, `sandbox/`, `.env.example`; see
`AGENTS.md`.
- **Scope isolation.** A new QM project gives a new scope, which means its own sandbox container
  and home volume. A new threadRef means a new session. That is how the student is made fresh.
- **Skills.** The Scout skill (`sandbox/skills/scout-research-company`) teaches the *teacher* how
  to research. It is unpublished during the exam, so the student sees only the Memorable procedure.

## 5. Role of Memorable

Memorable is procedural memory. `scripts/memorable_capture.py` turns a successful QM run into a
Memorable trace. That step is custom glue, because Memorable has no QM integration:
- The company name, domain, wiki title and slug become placeholders, and the written JSON becomes a
  schema template.
- A leak check against the teacher's own answer must come back clean before anything is sent.

Storage and retrieval are native: `memorable ingest`, `memorable recall`, `memorable show`. The
recalled procedure is the only procedural knowledge injected into the student's prompt, which
mirrors Memorable's own prompt hook.

## 6. What Agent University adds

QM runs agents and Memorable remembers procedures. Agent University adds:
- **The transfer exam:** a fresh-scope student, a hidden skill, freshness checks, and leak checks.
- **The contracts:** `Skill`, `TransferResult`, `VerificationResult`, `Event`, `CertificationRecord`.
- **Deterministic verification:** `scripts/verify_company.py`, and its TypeScript twin
  `lib/verifiers/company.ts`.
- **The certification policy:** `au-transfer-v1`.
- **The registry**, which is the organization's source of truth for trusted capabilities.
- **The UI**, which explains *why* a skill is or is not trusted.

## 7. Skill lifecycle

| Step | Kind | Emitted by |
|---|---|---|
| `skill.observed` | event | runtime: the teacher's artifact passed its verifier |
| `skill.recalled` | event | runtime: Memorable ranked the procedure first (capture probe, then the student) |
| `exam.started` | event | runtime: the fresh student began the unseen case |
| **`transferred`** | **status, not an event** | runtime: the student produced the artifact; runtime stops here |
| `exam.passed` | event | certification |
| `skill.certified` | event, and status `certified` | certification |

Statuses only move forward: `observed → transferred → certified`. There is no `exam.failed`. A
failed exam is a `TransferResult` with `passed: false`, and the skill stays `transferred` or
`observed`.

## 8. Runtime flow (`feat/runtime`)

1. `scripts/scout_run.py Linear` runs the teacher turn through the portal. It verifies
   `company.json` inside the teacher's sandbox.
2. `scripts/memorable_capture.py --run <id> --company Linear`:
   - re-verifies the teacher artifact, then generalizes and leak-checks the trace;
   - runs `memorable ingest`, then checks that `recall` ranks the new procedure first and that
     `show` is leak-free;
   - emits `skill.observed` and `skill.recalled`.
3. Hide the Scout layer skill and run `qm layer sync`. This is manual.
4. `scripts/transfer_run.py Vercel`:
   - Runs `memorable recall` and `memorable show`, and leak-checks the prompt.
   - Creates a new QM project (new scope) and a new threadRef. A freshness snapshot comes first:
     no sandbox may exist for that scope, and all existing containers and volumes are recorded.
   - Runs one turn, then verifies the artifact inside the student's sandbox.
   - Checks 13 isolation and freshness facts.
   - Writes a `TransferResult` to `.agent-university/transfers/<runId>.json` and sets status
     `transferred`.
5. Restore the Scout skill and run `layer sync` again.

Live output goes to `.agent-university/`, which is gitignored because it holds raw traces and
email-bearing scope names. The shareable copy is the sanitized `demo/fixtures/*-vercel*.json` set.

## 9. Certification flow (`feat/certification`)

```bash
node scripts/certify.ts \
  --skill demo/fixtures/skill-transferred-vercel.json \
  --transfer demo/fixtures/transfer-result-vercel.json \
  --events demo/fixtures/events-vercel-transferred.json \
  --reverify --require-isolation [--promote]
```

`certify()` evaluates 8 rules and records a reason and evidence for each:
1. `teacher_run_verified`
2. `procedure_recalled`
3. `exam_case_unseen`
4. `student_distinct_from_teacher`
5. `artifact_matches_skill`
6. `verifier_checks_complete`
7. `verifier_checks_passed`
8. `isolation_attested`

Options:
- `--reverify` re-runs the verifier on `artifact.path` instead of trusting the reported result.
- Isolation facts come from `--isolation <file>`, or else from the `isolation` key the runtime
  writes into its `TransferResult`.
- `--require-isolation` makes those facts mandatory.

Outcome:
- All 8 rules pass: status `certified`, plus the `exam.passed` and `skill.certified` events.
- A distinct student really took the unseen exam but another rule failed: `transferred`.
- Otherwise: `observed`.

The output is a `CertificationRecord` (`schemas/certification-record.schema.json`) with an
`inputsDigest`. It is deterministic.

## 10. Registry behavior

`lib/registry.ts` writes three things under `registry/`:
- `ledger.jsonl`: every decision, pass or fail, append-only.
- `skills/<id>.json`: the canonical *certified* record.
- `index.json`: one row per certified skill.

Only a certified record can become canonical, and it is never replaced by a worse one. The
ranking is:
1. certified
2. rules passed
3. checks passed
4. optional `judge.score`
5. cost
6. tool calls
7. duration
8. runId

`judge.score` counts only on already-certified records. No judge integration or swarm runner
exists yet; the ranking merely accepts the field.

`node scripts/registry.ts list | show <id> | ledger` inspects it. Today it holds **Research
Company, certified** from the real Vercel transfer.

## 11. UI / demo layer (`feat/ui-demo`)

A Next.js page (`app/page.tsx`, `components/*`, data access in `app/_lib/data.ts`) shows:
- the certification rulings;
- the lifecycle timeline;
- the transfer exam: teacher vs student, isolation facts, verifier checks;
- the certified capability;
- the composition, with its visible **GAP**.

Modes, set by URL query:
- `?mode=demo` (default): committed fictional Northwind fixtures.
- `?mode=demo&case=vercel`: the real sanitized runtime handoff, stopping at `transferred`.
- `?mode=live`: `registry/skills/research-company.json` first, then the runtime record.

The UI never calls QM, Memorable or Docker. Details: `docs/UI.md`.

## 12. Important files

| Path | What |
|---|---|
| `lib/types.ts`, `schemas/contracts/` | frozen shared contracts (JSON Schema canonical) |
| `schemas/*.schema.json` | artifact schemas; `certification-record.schema.json` |
| `scripts/scout_run.py`, `memorable_capture.py`, `transfer_run.py`, `au_record.py` | runtime |
| `scripts/verify_company.py`, `lib/verifiers/company.ts` | the deterministic verifier (Python and TS, kept identical by test) |
| `lib/certification.ts`, `scripts/certify.ts` | certification engine and CLI |
| `lib/registry.ts`, `scripts/registry.ts`, `registry/` | registry |
| `app/`, `components/`, `docs/UI.md` | UI |
| `demo/cases.json`, `demo/fixtures/` | cases; fictional and sanitized-real fixtures |
| `tests/` | Python runtime tests, TS certification and integration tests |
| `qm.config.jsonc`, `sandbox/`, `AGENTS.md` | the QM deployment |
| `docs/HANDOFF.md`, `PROGRESS.md` | ownership and protocol; the detailed runtime log |

## 13. Shared contracts and artifacts

- Contracts: `SkillStatus`, `AgentIdentity`, `Skill`, `VerificationResult`, `TransferResult`, and
  `Event` (7 frozen names).
- Consumers ignore unknown keys. For example, runtime adds `teacher`, `sourceCase`, `isolation`
  and `provenance` to its `TransferResult`.
- The artifact pipeline is `company.json → repo_analysis.json → score.json → outreach.md`. Only
  `company.json` is frozen and verified live. The other three are v0 placeholder schemas with
  fixtures, and none has a verifier, which is the composition GAP.

## 14. Proven live today

- **Teacher:** a real QM run researched Linear from live web sources. Verifier PASS 6/6
  (run `9f8d36da…`).
- **Capture:** real Memorable capture of a generalized procedure,
  `procedures/37196e61-add-company-data-to-company-json-file`. Leak test: 0 of 79 answer terms
  present.
- **Transfer:** a real fresh QM student (new scope, container, volume and session, and the Scout
  skill hidden) recalled it through native Memorable. It researched Vercel live, and the verifier
  passed 6/6 (run `5e30ec98…`). All 13 isolation and freshness facts are true. Evidence is in
  `PROGRESS.md`, Milestone 2.

## 15. Replayed deterministically, or fixture-only

- **Deterministic certification replay.** The real, sanitized Vercel `TransferResult` is certified
  by the production engine in strict mode, and the result is promoted into `registry/`.
  `tests/integration.test.ts` re-derives the committed record and fails if it goes stale. This
  step is deterministic and needs no live services, so "replay" here means re-running the
  engine, not re-running the agents.
- **Fictional (Northwind, `*.example.com`, fake ids).** `events.json`, `skill-observed.json`,
  `skill-certified.json`, `transfer-result{,-failed}.json`,
  `certification-record{,-failed}.json`, `plan-composed.json`, `gap-discovered.json`, and
  `repo_analysis.json`, `score.json`, `outreach.md`.
- **Not implemented.**
  - Automatic promotion from a live run: certification is a manual CLI step today.
  - A run API (`lib/qm.ts`, `app/api/**`).
  - Composition beyond the fixtures.
  - Verifiers for the three downstream artifacts.
  - A swarm or judge runner.

## 16. Known limitations and workarounds

- **QM core patch.** The pinned core (0.1.12) needs a one-line patch in the running container
  (`QM_CORE_CONTAINER`). It is lost if core is recreated, so do not run `qm up` casually. Re-apply
  steps are in `PROGRESS.md`.
- **Docker socket group.** Core needs `--group-add 0`, which resets when Docker Desktop restarts.
- **Hiding the Scout skill** for an exam is manual (move it, then `layer sync`).
- **Memorable recall is store-wide.** It also holds procedures captured from coding sessions, which
  could someday outrank Research Company.
- **Memorable titled the procedure** "Add company data to company.json file".
- **Occasional admin sign-in HTTP 400** on the first try; a retry succeeds.
- **Agent ids are pseudonymized in shared fixtures.** The real ids hash an email-bearing threadRef.
- **Certification is manual.** `transfer_run.py` does not call `certify.ts`; promotion is a
  separate command.

## 17. Tests

```bash
nvm use 24 && npm ci
npm test            # contracts + Python unit tests + TS tests (node --test) + py_compile; offline
npm run typecheck && npm run build
```

`npm test` covers:
- contract and fixture validation (`scripts/check_contracts.py`);
- runtime tests (`test_au_record.py`, `test_memorable_capture.py` for the leakage test, and
  `test_runtime_fixtures.py` for sanitized fixtures and the privacy scan);
- certification tests (`certification.test.ts`);
- the end-to-end test (`integration.test.ts`: real Vercel handoff → engine → record → registry →
  retrieval, plus failure cases).

## 18. Run the UI

```bash
nvm use 24 && npm ci && npm run dev    # http://localhost:3001 (not 3000; see docs/UI.md)
```

## 19. Branch → system mapping

| Branch | Became |
|---|---|
| `feat/runtime` | QM deployment + Scout skill, Memorable capture/recall adapter, fresh-student transfer exam, `TransferResult` + sanitized fixtures |
| `feat/certification` | deterministic verifiers, policy `au-transfer-v1`, `CertificationRecord` schema, registry, `certify`/`registry` CLIs |
| `feat/ui-demo` | Next.js lifecycle/exam/certification/GAP views, demo/live modes |

The handoff seams are `TransferResult` (runtime → certification) and `CertificationRecord` /
`registry/` (certification → UI). Runtime ends at `transferred`; certification owns `certified`.

## 20. Recommended demo flow

1. `npm run dev`, then open `/?mode=demo`. Walk the fictional lifecycle end to end, including the
   GAP.
2. `/?mode=demo&case=vercel`: the **real** Linear → Vercel run. Show the teacher vs student, the
   13 isolation facts, the 6/6 checks, and the student's real `company.json`. Point out that it
   stops at `transferred`, because runtime proves the transfer and does not certify itself.
3. In a terminal, run the certify command in section 9 without `--promote`. Show the 8 rulings,
   each with its reason, and the result `CERTIFIED: all 8 rules passed`.
4. `/?mode=live`: the canonical registry record. Research Company is certified by `au-transfer-v1`.
5. Close on the GAP: nothing certified produces `repo_analysis.json`. That is the next skill to
   teach.
6. Optional, not safe to improvise live: the live QM + Memorable run (section 8) takes a few
   minutes and needs the local QM stack.
