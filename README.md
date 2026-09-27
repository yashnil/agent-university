# Swarmem

**Swarmem is a trust layer for shared agent capabilities.** A capability one agent demonstrates
becomes reusable, certified memory only after it transfers to a *different* agent on an unseen case
and passes deterministic verification.

North star: *one agent learns → another agent proves it → every agent can inherit it.*

> The project was formerly called Agent University. Technical identifiers from that time are
> unchanged and still real: the repository and clone directory `agent-university`, the gitignored
> runtime directory `.agent-university/`, the QM container `qm-agent-university-core`, and ids such
> as `au-transfer-v1` and `scripts/au_record.py`.

## Lifecycle

```
observe → transfer trial → verify → certify → registry → reuse
```

1. **Observe.** An origin agent (contract field `teacher`) produces an artifact on a case, and its
   verifier passes (`skill.observed`). Memorable captures the procedure as a method, not an answer.
2. **Transfer trial.** A different agent (contract field `student`) in a fresh QM scope, sandbox and
   session recalls only that procedure and attempts an unseen case (`skill.recalled`,
   `exam.started`). Runtime stops at status `transferred`.
3. **Verify.** The deterministic verifier re-checks the artifact; no LLM judging.
4. **Certify.** Policy `au-transfer-v1` (8 evidence rules) promotes it to `certified`
   (`exam.passed`, `skill.certified`).
5. **Registry.** The certified record is written to `registry/`, the organization's source of truth.
6. **Reuse.** A new agent inherits certified skills, composes a larger task from them, and reports
   a **GAP** (a new candidate capability) where nothing certified exists.

- The skill is **Research Company**, which produces `company.json`. The origin case is **Linear**;
  unseen trial cases are **Vercel**, **Stripe** and **Supabase** (`demo/cases.json`).
- The UI uses origin/replica/trial wording; contracts keep their original field and event names
  (`teacher`, `student`, `exam.*`). See `docs/UI.md`, "Brand and vocabulary".

## Demo mode and Live mode

- **Demo** (`?mode=demo`, the default) is frozen and deterministic: the real Linear → Vercel
  certification story, served from `demo/fixtures/final-demo.json`. Its decision is the real Vercel
  entry in `registry/ledger.jsonl`, labelled as not the current canonical record.
- **Live** (`?mode=live`) shows the **current canonical registry**, whatever certified run was
  promoted most recently. Today that is a flow-tournament champion whose trial case is Stripe. Live
  shows only what that record supports: its own events, its own metrics (or "not recorded"), and an
  explicit "unavailable" where its artifact is inside a QM sandbox.
- Both return the same response contracts. Their values differ on purpose.

### Product API (read-only, `?mode=demo|live`, live by default)

- `GET /api/skills`: the certified skills, with provenance (`provenance.canonical` says whether it
  is the current canonical record).
- `POST /api/exam`: `{}` certifies the designated sanitized Vercel transfer with the production
  engine in strict mode. It never promotes.
- `POST /api/run`: a Fresh Intern (0 prior runs, 0 personal skills) composes a diligence task from
  certified skills, and returns labelled steps, `plan.composed` / `gap.discovered`, the new
  candidate, and metrics.

## Final demo path

```
Origin / Linear → Memorable → Replica / Vercel → deterministic verification → Certified Research Company
  → Fresh Intern → composite of certified skills → FIND TECHNICAL CONTACT GAP → new candidate
```

- **Truly live (real QM + Memorable runs, recorded):**
  - the origin agent's Linear run and the Memorable capture;
  - the replicating agent's Vercel run from the recalled procedure. It is sanitized into
    `demo/fixtures/*-vercel*.json`;
  - the flow-tournament runs recorded in `registry/ledger.jsonl`, including today's canonical
    Stripe record.
- **Registry-backed:**
  - the Vercel certification decision: strict, all 8 rules, 6/6 checks, kept in the ledger;
  - the current canonical Research Company record (`registry/skills/`, `GET /api/skills`);
  - in Demo, the Intern's first step reuses the certified, re-verified Vercel output. In Live it
    inherits the canonical skill but has no Vercel output to reuse, so its dependent steps are
    shown as blocked.
- **Fixture-backed, labelled in the UI and the API:**
  - Analyze Repository and Evaluate Opportunity (hand-written stand-ins, uncertified);
  - the whole composite run, which is orchestration only: no agent is executed.
- **GAP:** Find Technical Contact has no skill at all. `POST /api/run` emits `gap.discovered`, and
  it becomes a candidate that is never certified. Draft Outreach is blocked.
- **Arena:** `/arena` runs a flow tournament (`lib/tournament.ts`): candidate Memorable flows each
  go to several different agents on different unseen cases, every run is certified by the same
  engine, and the champion flow's best run becomes canonical. Dry runs use fixtures and a
  throwaway registry. Live runs need the local QM stack.
- **Known limitations:** see `docs/REPO_OVERVIEW.md` §15–16. The composite task is fixed to Vercel,
  candidates are not persisted, the composite executes no agents, and certification of a single
  transfer is still a manual CLI step.
- **Run it:** `npm run dev`, then open `http://localhost:3001/`. Click **Assign the diligence task**,
  then switch **Live**/**Demo** at the top right. The click-by-click script is in
  `docs/REPO_OVERVIEW.md` §20.

## Architecture

```
            ┌──────────── feat/runtime ────────────┐   ┌──── feat/certification ────┐   ┌─ feat/ui-demo ─┐
 teacher ──▶│ QM agent run (sandbox, real shell)   │   │ deterministic verifiers    │   │ lifecycle view │
            │   │ run trace (activity)             │   │   verify_company.py …      │   │ transfer exam  │
            │   ▼                                  │   │ schemas/ (artifacts)       │   │ composition +  │
            │ Memorable adapter: ingest / recall   │──▶│ certification decision     │──▶│ GAP            │
            │   │ recalled procedure               │   │ skill registry / exam API  │   │ demo mode      │
 student ──▶│ fresh QM agent (new scope + session) │   └────────────────────────────┘   └────────────────┘
            └──────────────────────────────────────┘
                     shared, frozen: lib/types.ts ⇄ schemas/contracts/*.schema.json
```

- **QM** (`@yc-software/qm`, pinned in `package.json`) runs agents in Docker sandboxes. This
  directory is also the QM deployment: `qm.config.jsonc`, `sandbox/` and `.env.example`.
  See `AGENTS.md` and `deployment.md`.
- **Memorable** (`memorable` CLI, local procedure store) captures and recalls procedures.
- **Contracts.** JSON Schemas in `schemas/` are canonical. `lib/types.ts` mirrors them for
  TypeScript. `npm test` fails if the two drift apart.

## Artifact pipeline (frozen names)

```
company.json  →  repo_analysis.json  →  score.json  →  outreach.md
```

| Artifact | Schema | Status |
|---|---|---|
| `company.json` | `schemas/company.schema.json` | **Frozen.** Produced live by QM and certified by `scripts/verify_company.py` |
| `repo_analysis.json` | `schemas/repo_analysis.schema.json` | v0 placeholder |
| `score.json` | `schemas/score.schema.json` | v0 placeholder |
| `outreach.md` | `schemas/outreach.schema.json` (its parsed form) | v0 placeholder |

`company.json` requires `company_name`, `website`, `product_summary`, and `source_urls` (at least 2
distinct http(s) URLs).

## Current milestone

- **Milestone 1: complete.** A real QM sandbox researched Linear and wrote `company.json`, and the
  verifier reports PASS.
- **Milestone 2: complete (runtime side).**
  - Memorable captured a generalized "Research Company" procedure from the Linear run.
  - A fresh QM agent recalled it and researched Vercel. The verifier reports PASS (6/6), and the
    transfer was isolated.
  - Runtime ends at status `transferred`. Certification owns promotion to `certified`
    (`docs/HANDOFF.md` §2, "Who promotes a skill").
  - The shared, sanitized result is `demo/fixtures/transfer-result-vercel.json`.
- **Certification of the real transfer: complete.** `scripts/certify.ts --reverify
  --require-isolation` certifies it on all 8 rules of `au-transfer-v1`. That decision stays in
  `registry/ledger.jsonl`, and `tests/integration.test.ts` replays it.
- **Flow tournament: complete.** A live 3-flow tournament promoted its champion flow's best run.
  That run (Stripe) is now the canonical `registry/skills/research-company.json`.
- **Final demo layer: complete.** A fresh Intern composes a diligence task from the certified skill
  (`POST /api/run`), surfaces the Find Technical Contact GAP, and creates a candidate. Covered by
  `tests/product.test.ts`.
- **Swarmem rename: complete** in the UI and docs (technical identifiers unchanged, see above).
- The whole system in one page: [`docs/REPO_OVERVIEW.md`](docs/REPO_OVERVIEW.md). Runtime details
  are in `PROGRESS.md`.

## Setup

Requirements:
- **Node 24** (`.nvmrc`; `nvm use`). The qm CLI refuses Node 22.
- Python 3.9+. Stdlib only, nothing to pip install.
- git.
- Docker Desktop, **only** for the runtime owner.

```bash
git clone <GITHUB_REPO_URL> agent-university    # the repository keeps its original name
cd agent-university
nvm use            # Node 24
npm install        # installs the pinned qm CLI; needs no secrets
npm test           # contracts + fixtures + verifier + unit tests, offline
```

## Working without QM or secrets

Only `feat/runtime` needs QM, Docker, `.env` and a Memorable login. Everyone else builds
against committed fixtures:

- `demo/fixtures/*`: sanitized, fictional data (Northwind Labs, fake ids). There is one fixture
  per artifact, both skill states (observed, certified), a transfer result, a verification
  result, a composed plan, a discovered gap, and the full `events.json` lifecycle.
- `demo/fixtures/*-vercel*.json`: the real Linear → Vercel transfer, sanitized, stopping at
  `transferred`. That is the transfer result, the skill record, the runtime's events, and the
  student's `company.json`.
- `npm run verify:fixture` runs the real verifier on the fixture `company.json`.
- `python3 scripts/verify_company.py --json <file>` prints a contract `VerificationResult`.

Never commit `.env`, tokens, admin-login links or raw run traces. `.agent-university/` (live
runtime output) is gitignored.

## Deploying (Vercel)

The page and the product API read committed repo data with node `fs` at request time. Next's
output tracing cannot see those reads, so `next.config.mjs` lists them in
`outputFileTracingIncludes` for `/`, `/api/skills`, `/api/exam` and `/api/run`:
- `demo/cases.json`;
- `demo/fixtures/**`;
- `registry/index.json`, `ledger.jsonl`, `skills/**`, `procedures/**`.

Without that, a deployed function has none of those files (`ENOENT /var/task/demo/cases.json`).
`lib/certification.ts` resolves the repo root from the working directory when the build machine's
path does not exist at runtime. `tests/deploy.test.ts` checks that every file these routes read is
included, and that `.agent-university/`, `.env` and other local state never are.

## Branch ownership

| Branch | Owns | Must not casually edit |
|---|---|---|
| `feat/runtime` | QM runtime + Memorable integration, runtime orchestration, run APIs/scripts | UI components, verifier/certification internals |
| `feat/certification` | deterministic verifiers, schemas, certification logic, exam APIs, skill registry/certification records | QM/Memorable runtime, page/layout UI |
| `feat/ui-demo` | UI, visualization, demo mode, presentation states | QM/Memorable internals, verifier internals |

The exact file lists, next tasks and merge protocol are in [`docs/HANDOFF.md`](docs/HANDOFF.md).
