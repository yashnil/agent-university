# Handoff: parallel work on Agent University

Read this with `README.md` before branching. Every file below has exactly one owner. If a
change is needed in a file someone else owns, ask them first; do not just edit it. Merge
conflicts are lost hackathon time.

## 1. Branches and exclusive ownership

All three branches start from the same `main` baseline commit.

### `feat/runtime` (runtime owner: QM + Memorable)

Owns:
- **QM runtime integration:** `qm.config.jsonc`, `.env.example`, `sandbox/**`,
  `slack-app-manifest.yml`, `AGENTS.md`, `deployment.md`, `.codex/**`.
- **Memorable integration:** `scripts/memorable_capture.py`, and `lib/memorable.ts` when it
  exists.
- **Runtime orchestration:** `scripts/transfer_run.py`, `scripts/au_record.py`, and
  `runtime/**` when it exists.
- **Run APIs/scripts:** `scripts/scout_run.py`, and `lib/qm.ts` and `app/api/run/**` when they
  exist.
- **Runtime tests:** `tests/test_au_record.py`.

Must not casually edit: UI components (`app/page.tsx`, `components/**`), or verifier and
certification internals (`scripts/verify_company.py`, `scripts/check_contracts.py`,
`schemas/**`).

### `feat/certification` (certification owner)

Owns:
- **Deterministic verifiers:** `scripts/verify_company.py`, plus new `scripts/verify_*.py`.
- **Schemas:** `schemas/*.schema.json` (artifacts). `schemas/contracts/**` is frozen (see §2).
- **Certification logic:** `lib/certification.ts` and `lib/artifacts.ts` when they exist.
- **Exam APIs:** `app/api/exam/**`. **Skill registry and certification records:**
  `app/api/skills/**`.
- **Fixtures and checks:** `demo/fixtures/**`, `demo/cases.json`, `scripts/check_contracts.py`.

Must not casually edit: QM/Memorable runtime (the `feat/runtime` files above) or page/layout UI.

### `feat/ui-demo` (UI owner)

Owns:
- **UI:** `app/page.tsx`, `app/layout.tsx`, `app/**` except `app/api/**`, `components/**`,
  styles and `public/**`.
- **Demo mode and presentation states:** `demo/fallback-artifacts/**` and any UI-only demo
  data under `demo/ui/**`.
- **App tooling:** the Next.js/TypeScript scaffold files (`next.config.*`, `tsconfig.json`,
  and similar).

Must not casually edit: QM/Memorable internals or verifier internals.

### Shared (change only on `main` at a checkpoint, with all three agreeing)

`lib/types.ts`, `schemas/contracts/**`, `package.json`, `package-lock.json`, `.nvmrc`,
`.gitignore`, `README.md`, this file, `PROGRESS.md`.

- **Lockfile exception, once:** the UI owner's first PR may add the Next.js/React dependencies
  to `package.json` and `package-lock.json`. Nobody else touches dependencies until that PR is
  merged.
- Use **npm only**, and Node 24.

## 2. Shared contracts (FROZEN for the first sprint)

| Contract | Canonical schema | TypeScript |
|---|---|---|
| `SkillStatus = "observed" \| "transferred" \| "certified"` | `schemas/contracts/skill.schema.json#/$defs/SkillStatus` | `lib/types.ts` |
| `AgentIdentity {id, name, harness}` | `schemas/contracts/agent-identity.schema.json` | `lib/types.ts` |
| `Skill {id, name, status, teacher, artifactType, procedureId?, transfer?{student, examCase, passed}}` | `schemas/contracts/skill.schema.json` | `lib/types.ts` |
| `VerificationResult {passed, checks[{name, passed, message?}]}` | `schemas/contracts/verification-result.schema.json` | `lib/types.ts` |
| `TransferResult`: one exam outcome (the exam API's response) | `schemas/contracts/transfer-result.schema.json` | `lib/types.ts` |
| `Event {type, at, payload}`: the 7 event names below | `schemas/contracts/event.schema.json` | `lib/types.ts` |
| `ArtifactType`: the 4 pipeline artifact names | `schemas/contracts/skill.schema.json#/$defs/ArtifactType` | `lib/types.ts` |

Rules:
- **JSON Schema is canonical; `lib/types.ts` mirrors it.** `npm test` fails when field names,
  optionality or enum members differ. Change both files in one commit, on `main`, at a
  checkpoint.
- **Consumers ignore unknown keys.** Producers may add keys; they may not rename or remove them.
- **Status meaning:**
  - `observed`: the teacher produced an artifact that passed its verifier.
  - `transferred`: a different agent ran an exam case from the recalled procedure and produced
    the artifact.
  - `certified`: that artifact passed the deterministic verifier and the transfer was isolated
    (different agent, scope and sandbox; no access to the teacher's answer).
- **Who promotes a skill (ownership boundary):**
  | Stage | Owner | Produces |
  |---|---|---|
  | teacher run → `observed` | runtime | `skill.observed`, `skill.recalled` |
  | exam run → `transferred` | runtime | `exam.started`, a `TransferResult` (with its `VerificationResult`) |
  | `transferred` → `certified` | certification | `exam.passed`, `skill.certified`, the canonical certified `Skill` |
  | display | UI | nothing; it reads contracts and fixtures |

  Runtime **ends at `transferred`**. It never emits `exam.passed` or `skill.certified` and never
  sets `certified`. It guarantees that the verifier ran on the student's artifact and reports the
  isolation facts as `TransferResult.isolation` (a producer-added key). Certification applies its policy
  to that and emits the certified record. The UI renders contracts and fixtures and never calls QM,
  Memorable, Docker or `.agent-university/` directly.
- **AgentIdentity for QM agents:** `harness: "qm"`, `id: "qm-thread-<sha256(threadRef)[:12]>"`.
  The id is stable before the first run and contains no email. A web threadRef does contain the
  user's email, so a guessable one (the default thread) can be confirmed from the id. Shared fixtures
  therefore use pseudonymous ids (`qm-thread-sanitized-*`).
- **Verifiers are CLIs.** A verifier prints a `VerificationResult` with `--json`, exits 0 on PASS
  and 1 on FAIL, and uses no network. Check names are stable `snake_case`.

### Events (names frozen, no bus yet)

Producers append `{type, at, payload}` objects to a list: a record's `events` array, or a
`.jsonl` file. The full example is `demo/fixtures/events.json`.

| Event | Emitted by | Payload (required; `?` optional) |
|---|---|---|
| `skill.observed` | runtime | `skillId, teacher, artifactType, runId, artifactPath, verification` |
| `skill.recalled` | runtime | `skillId, procedureId, query, rank?, agent?` |
| `exam.started` | runtime | `skillId, procedureId?, examCase, student, runId?` |
| `exam.passed` | certification | `skillId, examCase, student, artifactPath?, verification` |
| `skill.certified` | certification | `skillId, teacher, student, examCase, procedureId?` |
| `plan.composed` | runtime (composition) | `planId, goal, agent?, steps[{artifactType, skillId?, status: certified\|uncertified\|missing}]` |
| `gap.discovered` | runtime (composition) | `planId, goal, missingArtifactType, neededBy?, reason` |

There is no `exam.failed` event. A failed exam is a `TransferResult` with `passed: false`, and
the skill stays `transferred`.

### Artifact pipeline

`company.json → repo_analysis.json → score.json → outreach.md`, joined by `company_name`.

- `company.json` is frozen and certified live today.
- The other three have v0 placeholder schemas. Build against them. Only certification changes
  them, and only at a checkpoint.
- `outreach.md` is Markdown: `# Outreach: <company_name>` plus `## Why now`, `## Message` and
  `## Sources`.

## 3. Fixtures (no QM or secrets needed)

`demo/fixtures/`. The Northwind set below is fictional (Northwind Labs, `*.example.com`) and every id
in it is fake.

| File | Contract |
|---|---|
| `company.json`, `repo_analysis.json`, `score.json`, `outreach.md` | one artifact per pipeline stage |
| `skill-observed.json`, `skill-certified.json` | `Skill` in two statuses |
| `transfer-result.json`, `verification-result.json` | `TransferResult`, `VerificationResult` |
| `plan-composed.json`, `gap-discovered.json` | `Event` (`plan.composed`, `gap.discovered`) |
| `events.json` | the full lifecycle, in order |

**Live, sanitized (runtime Milestone 2: teacher Linear → student Vercel).** These come from the real
QM transfer exam. Agent ids are pseudonymous, and no scope, container, volume, session, threadRef,
URL, prompt or trace is included. They stop at `transferred` on purpose: they are runtime's handoff.
Certification's decision on them is `registry/skills/research-company.json`, and `tests/integration.test.ts`
replays it.
`tests/test_runtime_fixtures.py` validates them against the contracts and scans them for personal data.

| File | Contract |
|---|---|
| `transfer-result-vercel.json` | `TransferResult` + producer keys `teacher`, `sourceCase`, `sourceRunId`, `examStartedAt`, `examFinishedAt`, `isolation`, `provenance` |
| `skill-transferred-vercel.json` | `Skill` in `transferred` (runtime's last state) |
| `events-vercel-transferred.json` | `Event`s runtime emitted: `skill.observed`, `skill.recalled` ×2 (capture probe, then the student), `exam.started` |
| `company-vercel.json` | the student's `company.json`; `artifact.path` points here |

`demo/cases.json` holds the teacher case (Linear), the live exam case (Vercel), and the
fixture-only exam case (Northwind).

## 4. What each person builds next

**Runtime:** Milestone 2 is done (see `PROGRESS.md`). `scripts/transfer_run.py Vercel` ends at
`transferred` and writes a `TransferResult` to `.agent-university/transfers/<runId>.json`. The
shared, sanitized copy is `demo/fixtures/transfer-result-vercel.json`. Next: a run API (`lib/qm.ts`,
`app/api/run/**`) that returns `TransferResult`s and `Event`s in the fixture shape.

**Certification:**
- Verifiers for `repo_analysis.json`, `score.json` and `outreach.md`. Each is a CLI like
  `verify_company.py`: `--json` prints a `VerificationResult`, and the exit code is 0 or 1.
- The certification decision as a pure function: `Skill + TransferResult (+ isolation facts)`
  gives the next `status`, plus `exam.passed` and `skill.certified` events.
- The skill registry and exam/skills API shapes. Add **failing** fixtures so the UI can show a
  failed exam.

**UI/demo:**
- Scaffold Next.js with npm and Node 24. It is the first PR, and the only one allowed to touch
  dependencies.
- Render the lifecycle from `demo/fixtures/events.json`: observed → recalled → exam started →
  exam passed → transferred → certified.
- Show the transfer exam (teacher vs student, `VerificationResult` checks).
- Show the composition from `plan-composed.json` and the visible **GAP** from
  `gap-discovered.json`.
- A demo-mode switch that reads fixtures only.

### Handoff: Milestone 2 transfer result

**Certification teammate**
- Consume `demo/fixtures/transfer-result-vercel.json`. Live runs write the same shape, unsanitized,
  to `.agent-university/transfers/<runId>.json`.
- Apply the deterministic certification policy to it together with `skill-transferred-vercel.json`.
  Output the canonical certified `Skill` and the `exam.passed` and `skill.certified` events.
- Runtime already guarantees:
  - `verification` is `verify_company.py --json` run on the student's own artifact. It passed 6/6,
    and re-running it on `company-vercel.json` gives the identical result.
  - `passed == verification.passed`.
  - `isolation` holds 13 booleans, all true. They cover: different agent, session, scope,
    container, home volume and threadRef; the layer skill unpublished and never read; no teacher
    artifact in the student's sandbox; no teacher answer in the prompt; a new container and volume;
    and the artifact written after the exam started.
- Decide how `isolation` feeds the policy. It is a producer-added key, not part of the frozen
  contract.

**UI teammate**
- Build against `lib/types.ts` and `demo/fixtures/` only.
- Render observed → recalled → exam started → exam passed → transferred → certified.
  - `transferred` is a `Skill.status`, not an event. Show it when the status is `transferred`,
    or after `exam.started` once a `TransferResult` exists.
  - `exam.passed` and `skill.certified` come from certification. For the live Vercel run they do
    not exist yet, so show those two steps as pending.
- Two sets:
  - Fictional full lifecycle: `events.json`, `skill-certified.json`.
  - Live, stopping at `transferred`: `events-vercel-transferred.json`,
    `skill-transferred-vercel.json`, `transfer-result-vercel.json`.
- Never call QM internals: no portal or core URLs, Docker, Memorable, or `.agent-university/`.
  Use fixtures until the runtime run API exists.

## 5. Merge and checkpoint protocol

- Commit a coherent working unit every 20-30 minutes. Push after every meaningful milestone.
- **Checkpoint 1: 60 minutes after branching.** UI scaffold merged, and runtime Milestone 2
  transferred with a passing `TransferResult` (done), or reported blocked.
  **Checkpoint 2: 2 hours after branching.** The UI renders live runtime output, and the next
  verifier is merged.
  Retime these out loud at the pre-branch meeting.
- Before opening a PR:
  ```bash
  git status
  git add <only-your-files>
  git commit -m "feat: <specific working unit>"
  git fetch origin && git rebase origin/main    # resolve conflicts only in files you own
  nvm use && npm test
  git push -u origin <your-branch>
  ```
- If `main` is broken, all new work stops until `main` is demoable again. `npm test` must pass
  on `main` at all times.

## 6. Do NOT change

- The frozen contracts or artifact names, except at a checkpoint on `main` (§2).
- `.env` must never be committed, and neither may tokens, admin-login links (`…#token=…`),
  Memorable keys, or raw run traces. `.agent-university/` is gitignored for this reason.
- Do not run `npm run deploy` / `qm up`, `qm init`, `docker system prune`, or delete QM volumes
  on the runtime owner's machine (see §7).
- Package manager (npm), Node version (24), or the pinned qm version, unless the change is
  agreed.
- Another owner's files, without asking.

## 7. Known QM runtime patch (runtime owner's machine only)

The pinned QM core image (qm 0.1.12) ignores `QM_CORE_CONTAINER` for the local sandbox backend.
Every sandbox then fails with "exec daemon never became reachable (ECONNREFUSED 127.0.0.1)".

The running `qm-agent-university-core` container has a one-line patch in
`/app/src/config.ts` → `localSandboxEnv()`:

```ts
    ...(env.QM_CORE_CONTAINER ? { coreContainer: env.QM_CORE_CONTAINER } : {}),
```

The patch survives `docker restart` but is **lost whenever core is recreated** (`qm up`, a
core image change). The re-apply steps are in `PROGRESS.md` (Known issues). Teammates using
fixtures are unaffected.
