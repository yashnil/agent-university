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
- **AgentIdentity for QM agents:** `harness: "qm"`, `id: "qm-thread-<sha256(threadRef)[:12]>"`.
  The id is stable before the first run and contains no email.
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

`demo/fixtures/`. The data is fictional (Northwind Labs, `*.example.com`) and every id is fake.
Nothing is copied from a live QM trace.

| File | Contract |
|---|---|
| `company.json`, `repo_analysis.json`, `score.json`, `outreach.md` | one artifact per pipeline stage |
| `skill-observed.json`, `skill-certified.json` | `Skill` in two statuses |
| `transfer-result.json`, `verification-result.json` | `TransferResult`, `VerificationResult` |
| `plan-composed.json`, `gap-discovered.json` | `Event` (`plan.composed`, `gap.discovered`) |
| `events.json` | the full lifecycle, in order |

`demo/cases.json` holds the teacher case (Linear), the live exam case (Vercel), and the
fixture-only exam case (Northwind).

## 4. What each person builds next

**Runtime:** finish Milestone 2. Steps:
- `memorable login`.
- `python3 scripts/memorable_capture.py --run 9f8d36da-12d3-4d42-bd7d-924fce932f46 --company Linear`
- Hide the Scout layer skill: move `sandbox/skills/scout-research-company` out of `sandbox/`, then
  `npm exec qm -- layer sync`.
- `python3 scripts/transfer_run.py Vercel` must end `certified`.
- Restore the skill and sync again.

Then expose a run API (`lib/qm.ts`, `app/api/run/**`) that returns contract `TransferResult`s
and `Event`s. Hand back live `events` in the fixture shape.

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
- Render the lifecycle from `demo/fixtures/events.json`: observed → recalled → exam → certified.
- Show the transfer exam (teacher vs student, `VerificationResult` checks).
- Show the composition from `plan-composed.json` and the visible **GAP** from
  `gap-discovered.json`.
- A demo-mode switch that reads fixtures only.

## 5. Merge and checkpoint protocol

- Commit a coherent working unit every 20-30 minutes. Push after every meaningful milestone.
- **Checkpoint 1: 60 minutes after branching.** UI scaffold merged, and runtime Milestone 2
  certified or reported blocked.
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
