# Swarmem: repository overview

## 1. What it is

Swarmem is a trust layer for shared agent capabilities. A capability demonstrated by one agent must
**transfer** to a different agent on an unseen case, and pass deterministic verification, before it
becomes reusable certified memory. North star: *one agent learns → another agent proves it → every
agent can inherit it.*

The lifecycle is **observe → transfer trial → verify → certify → registry → reuse** (§7).

The demo skill is **Research Company**. It produces `company.json`. The origin (`teacher`) case is
**Linear**, and the unseen trial cases are **Vercel**, **Stripe** and **Supabase** (`demo/cases.json`).

- **Naming.** The project was formerly called Agent University. Real technical identifiers keep that
  name: the repository and clone directory `agent-university`, `.agent-university/` (gitignored runtime
  output), the QM container `qm-agent-university-core`, `au-transfer-v1`, and `scripts/au_record.py`.
- **Vocabulary.** The UI says origin / replica / trial. Contracts and this document's technical
  sections keep the field and event names `teacher`, `student`, `exam.*`, which are data
  (`docs/UI.md`, "Brand and vocabulary").

## Final demo path

```
Origin / Linear → Memorable → Replica / Vercel → deterministic verification → Certified Research Company
  → Fresh Intern → composite of certified skills → FIND TECHNICAL CONTACT GAP → new candidate
```

This is the **Demo** story: frozen and deterministic. **Live** mode shows the current canonical
registry record instead, which today is a flow-tournament champion on Stripe (§10, §11).

| Stage | Where it comes from | Kind |
|---|---|---|
| Teacher researches Linear (run `9f8d36da`) | QM + the Scout skill, recorded | **live**, real run |
| Memorable captures the generalized procedure `procedures/37196e61-…` | native `memorable ingest` | **live**, real |
| A fresh student researches Vercel from the recalled procedure (run `5e30ec98`) | QM + Memorable recall, recorded, sanitized into `demo/fixtures/*-vercel*.json` | **live**, real run |
| Deterministic verification (6/6) and certification (all 8 rules, strict) | `lib/certification.ts` via `POST /api/exam` | deterministic engine; decision kept in `registry/ledger.jsonl` |
| Research Company is Certified | the Vercel ledger decision (Demo) or the current canonical `registry/skills/research-company.json` (Live), via `GET /api/skills` | **registry-backed** |
| A fresh Intern (0 prior runs, 0 personal skills) gets a diligence task and inherits the certified skill | `lib/composite.ts` via `POST /api/run` | orchestration only: **no agent is executed** |
| Research Company step | the certified exam's own output, re-verified 6/6 | **registry-backed** (reused, not re-run) |
| Analyze Repository, Evaluate Opportunity | hand-written stand-ins in `demo/fixtures/composite/` | **fixture**, uncertified, not inherited |
| Find Technical Contact | no skill exists → `gap.discovered` + candidate `find-technical-contact` | **GAP**, candidate, not certified |
| Draft Outreach | blocked on the missing contact; `outreach.md` is not produced | blocked |

The same responses are frozen in `demo/fixtures/final-demo.json` (`node scripts/final_demo.ts`),
which demo mode serves and a test keeps identical to what production code produces.

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
  ↓   GET /api/skills · POST /api/exam · POST /api/run   (lib/product.ts)
Swarmem orchestration (Python scripts/, TypeScript lib/)
  ├── QM runtime (@yc-software/qm 0.1.12, docker target)
  │    └── teacher + fresh student agents, each in its own Docker sandbox
  ├── Memorable (memorable-cli 0.5.19, local encrypted store)
  │    └── procedure capture (ingest) / recall (recall, show)
  ├── Certification engine (lib/certification.ts, policy au-transfer-v1)
  │    └── 8 deterministic evidence rules → CertificationRecord
  ├── Registry (lib/registry.ts → registry/)
  │    └── canonical certified capabilities, index, append-only ledger, flow records
  ├── Swarm / flow tournament (lib/swarm.ts, lib/tournament.ts, lib/jev.ts; /arena)
  │    └── many agents per flow on unseen cases → certified runs → champion flow promoted
  └── Composite run (lib/composite.ts)
       └── a Fresh Intern reuses certified skills; a missing capability → GAP → candidate

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

## 6. What Swarmem adds

QM runs agents and Memorable remembers procedures. Swarmem adds:
- **The transfer exam:** a fresh-scope student, a hidden skill, freshness checks, and leak checks.
- **The contracts:** `Skill`, `TransferResult`, `VerificationResult`, `Event`, `CertificationRecord`.
- **Deterministic verification:** `scripts/verify_company.py`, and its TypeScript twin
  `lib/verifiers/company.ts`.
- **The certification policy:** `au-transfer-v1`.
- **The registry**, which is the organization's source of truth for trusted capabilities.
- **The flow tournament**, which decides between competing Memorable flows by certified pass rate.
- **Reuse with honest edges:** a new agent composes work from certified skills and reports a GAP,
  and a new candidate, where none exists.
- **The UI**, which explains *why* a skill is or is not trusted.

## 7. Skill lifecycle

**observe → transfer trial → verify → certify → registry → reuse.** The contract events, in order:

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

After certification:
- **Registry:** the record is promoted into `registry/` (§10).
- **Reuse:** a new agent composes from it (`plan.composed`), and each missing capability becomes a
  `gap.discovered` and a candidate (§11).

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

`judge.score` counts only on already-certified records. It is set by the Jev judge (`lib/jev.ts`,
OpenRouter, advisory only).

**Swarm and flow tournament.** They share one pipeline, which `/arena` streams:
- **Runners:** `lib/swarm.ts` and `lib/tournament.ts`, via `node scripts/tournament.ts` or `/arena`.
- **Candidates:** each Memorable flow (procedure) is screened for answer leaks, then handed to
  several different agents, each on a different unseen case.
- **Certification:** every run is certified by the same engine.
- **Advancing:** a flow advances when at least half its runs certify.
- **Final:** Jev (or a deterministic ranking) picks the champion among the advancing flows.
- **Promotion:** `registry.promoteProcedure` makes the champion's best certified run canonical and
  points the index row at the flow (`registry/procedures/<skill>/<flow>.json`).
- **Modes:** a dry run uses fixture agents and a throwaway registry. A live run needs QM, Docker,
  Memorable and keys.

`node scripts/registry.ts list | show <id> | ledger` inspects it. Today:
- The canonical Research Company record is a **live flow-tournament champion**: trial case Stripe,
  procedure `procedures/37196e61-…`, 6/6, pass rate 3/3.
- The ledger also keeps the original real Linear → Vercel decision, which `tests/integration.test.ts`
  re-derives from the sanitized fixtures.

## 11. UI / demo layer (`feat/ui-demo`)

A Next.js page (`app/page.tsx`, `components/*`, data access in `app/_lib/data.ts`), branded
Swarmem, shows:
1. **Lifecycle:** the 6-step chain and its events.
2. **Transfer trial:** origin vs replicating agent, isolation facts, verifier checks, the 8 policy
   rulings.
3. **Certified capability.**
4. **The registry:** `RegistryPanel`, including the champion-flow block.
5. **The Fresh Intern:** a composite run with its visible **GAP**, the new candidate, and metrics.

`/arena` runs and streams a flow tournament.

Modes, set by URL query. Switching keeps the case, so the story on screen stays the same:
- `?mode=demo` (default; `case=vercel` is the default case): frozen. The real sanitized Vercel
  handoff, plus `final-demo.json` for the engine's decision, the registry state (the Vercel ledger
  decision, labelled as not canonical) and the Intern's composite run.
- `?mode=live`: the current canonical record in `registry/skills/research-company.json`, via
  `GET /api/skills` and `POST /api/run`. Live shows only what that record supports:
  - its own events, and no runtime history it does not have;
  - its own metrics, or "not recorded";
  - its artifact, or an explicit "unavailable" if it is inside a QM sandbox;
  - an Intern step 1 that is certified and inherited but has no Vercel output, so its dependent
    steps are blocked.
- `&case=northwind`: the older fictional lifecycle, including its `repo_analysis.json` GAP.
- `&run=1`: render the Intern's run immediately. Without it, "Assign the diligence task" POSTs
  `/api/run` and reveals the steps in order.

Section 05 is the product layer: the Fresh Intern, its inherited skills, the labelled composite
timeline, the yellow GAP, the new candidate, and a metrics panel. Metrics are attributed by run id
only: a run's numbers never come from another run or company, and tokens are never shown because
QM does not record them.

APIs (read-only; `?mode=demo|live`, live by default):
- `GET /api/skills`: the certified skills with provenance. `provenance.canonical` is true in Live
  and false for the frozen demo decision.
- `POST /api/exam`: `{}` certifies the designated sanitized Vercel transfer in strict mode (it is
  not compared with whatever is canonical); or send
  `{skill, transfer, events}` with the artifact under `demo/fixtures/`. It never promotes.
- `POST /api/run`: the composite run.

The routes and the page adapter call the same functions (`lib/product.ts`), so both return the
same contracts.

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
| `lib/composite.ts`, `lib/product.ts`, `app/api/{skills,exam,run}/` | composite run and product API |
| `demo/fixtures/final-demo.json`, `run-metrics.json`, `composite/` | frozen final demo, recorded run metrics, seeded stand-ins |
| `lib/swarm.ts`, `lib/tournament.ts`, `lib/jev.ts`, `app/arena/` | swarm and flow tournament (Arena) |
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
  by the production engine in strict mode, and that decision is in `registry/ledger.jsonl`.
  `tests/integration.test.ts` re-derives it and fails if it goes stale. The canonical record may
  since have been replaced by a tournament champion. "Replay" here means re-running the engine,
  not re-running the agents.
- **Fictional (Northwind, `*.example.com`, fake ids).** `events.json`, `skill-observed.json`,
  `skill-certified.json`, `transfer-result{,-failed}.json`,
  `certification-record{,-failed}.json`, `plan-composed.json`, `gap-discovered.json`, and
  `repo_analysis.json`, `score.json`, `outreach.md`.
- **Seeded stand-ins (hand-written, labelled `fixture`).** `composite/repo_analysis-vercel.json`,
  `composite/score-vercel.json`.
- **Recorded run metrics.** `run-metrics.json` holds wall-clock and shell tool calls from the two
  real runs (`scripts/export_run_metrics.py`). Tokens are `null` because QM does not record them.
- **Not implemented.**
  - Automatic promotion from a live run: certification is a manual CLI step.
  - Live execution in the composite run: the Intern runs no agent.
  - Analyze Repository, Evaluate Opportunity and Draft Outreach as live, certified skills. They have
    no verifiers.
  - Find Technical Contact: it exists only as a candidate.
  - Persisting candidates: they are derived per run and not stored in `registry/`.

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
- **The composite run is fixed to one task** (Vercel diligence). A certified step is reused only when
  the certified exam produced a verified artifact for that same company. In Live, with a Stripe
  canonical record, the research step is inherited but produces nothing, and its dependents are
  blocked.
- **Vercel deployment needs output-file tracing.**
  - The page and the product API read committed data (`demo/cases.json`, `demo/fixtures/**`,
    `registry/**`) with node `fs` at request time.
  - `next.config.mjs` lists those files in `outputFileTracingIncludes` for `/`, `/api/skills`,
    `/api/exam` and `/api/run`. `tests/deploy.test.ts` guards that list.
  - `lib/certification.ts` falls back to the working directory as the repo root, because Next
    inlines `import.meta.url` with the build machine's path.
  - The Arena's live mode writes to `.agent-university/`, so it is not usable on a read-only
    serverless host.
- **Some committed registry data predates the rename.** The canonical tournament record names its
  student `Freshman #2` and carries real (not pseudonymized) `qm-thread-…` ids. It is certified
  data under an `inputsDigest`, so it is left as recorded; a re-run tournament with current code
  replaces it.
- **`plan.composed` / `gap.discovered` are the frozen v1 events.** The missing contact is not a
  pipeline artifact, so the GAP names `outreach.md` as the artifact that cannot be produced. The
  capability travels in producer-added keys (`skillId`, `status: "candidate"`, `message`).

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
  retrieval, plus failure cases);
- the product layer (`product.test.ts`):
  - the three route handlers;
  - the composite run and GAP;
  - the frozen final demo;
  - Live derived from the current canonical record;
  - a tampered registry;
  - the page adapter in both modes;
- deployment packaging (`deploy.test.ts`): the Vercel output-tracing include list;
- swarm and tournament (`swarm.test.ts`, `tournament.test.ts`, `arena.test.ts`).

## 18. Run the UI

```bash
nvm use 24 && npm ci && npm run dev    # http://localhost:3001 (not 3000; see docs/UI.md)
```

## 19. Branch → system mapping

| Branch | Became |
|---|---|
| `feat/runtime` | QM deployment + Scout skill, Memorable capture/recall adapter, fresh-student transfer exam, `TransferResult` + sanitized fixtures |
| `feat/certification` | deterministic verifiers, policy `au-transfer-v1`, `CertificationRecord` schema, registry, `certify`/`registry` CLIs |
| `feat/ui-demo` | Next.js lifecycle/exam/certification/GAP views, demo/live modes, then the Swarmem rename and RegistryPanel (`feat/ui-rename-swarmem`) |
| `feat/arena`, `feat/live-flow-result` | swarm, flow tournament, Jev judge, `/arena`, and the live tournament result now canonical |
| `feat/demo-final-integration` | product API, Fresh Intern composite run, GAP → candidate, metrics, frozen final demo, Vercel tracing |

The handoff seams are `TransferResult` (runtime → certification) and `CertificationRecord` /
`registry/` (certification → UI). Runtime ends at `transferred`; certification owns `certified`.

## 20. Recommended demo flow

`npm run dev`, then open `http://localhost:3001/`. This is Demo mode: the frozen, real Vercel case.
1. **01 Lifecycle.** Observed on Linear → procedure recalled → trial started on Vercel → verified
   → certified. Then the Intern's `plan.composed` and `gap.discovered`.
2. **02 Transfer trial.** The origin vs the replicating agent, the 13 runtime isolation facts, the
   6/6 checks, and the 8 policy rulings: "one agent learned it, a different agent proved it".
3. **03 Certified capability.** The skill record and the replica's real `company.json`: "the
   organization certified it".
4. **04 The registry.** What the organization trusts. In Demo it is the frozen Vercel decision,
   labelled as not canonical.
5. **05 Fresh Intern.** Point at *prior runs 0 · personal skills 0 · inherits research-company*,
   then click **Assign the diligence task**. The steps appear in order:
   - certified and inherited (green);
   - two fixture stand-ins (dashed, uncertified);
   - **FIND TECHNICAL CONTACT** (yellow GAP);
   - Draft Outreach blocked;
   - then the GAP banner and the **new candidate**, not certified.

   Talking point: "a brand-new agent inherited it, and the system knew where its knowledge
   stopped."
6. **Metrics.** 6/6 verified; 1 certified skill reused; 1 of 5 steps from certified capability;
   1 gap; the recorded wall-clock and tool calls of the two real runs (no tokens: QM does not
   record them).
7. Click **Live (runtime)** at the top right. The same screen now reads the current canonical
   registry, which today is the Stripe tournament champion.
   - Its Intern run inherits the skill but has no Vercel output, so the downstream steps are
     blocked. That is the honest result, so present from Demo.
   - `/arena` shows how that champion was chosen.
8. Optional: `curl -XPOST localhost:3001/api/exam -d '{}'` to show the engine certifying the real
   Vercel transfer. Do not improvise the live QM + Memorable run (section 8) or a live tournament on
   stage: they take minutes and need the local QM stack.
