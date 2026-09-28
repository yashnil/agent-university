<p align="center">
  <img src="public/logo.png" alt="" width="120" height="120">
</p>

<h1 align="center">swar<em>mem</em></h1>

<p align="center">
  <strong>swarmem certifies that a procedure learned by one agent transfers to a different
  agent on a fresh task before it becomes trusted organizational capability.</strong>
</p>

<p align="center">
  <em>one agent learns → another agent proves it → every agent can inherit it</em>
</p>

<p align="center">
  <a href="https://swarmem.vercel.app">swarmem.vercel.app</a>
</p>

## Demo path (fixed)

teacher → Memorable → student transfer exam → deterministic verifier → **Certified** →
fresh-agent composition → visible **GAP**

- The teacher case is **Linear** and the unseen exam case is **Vercel** (`demo/cases.json`).
- The skill is **Research Company**, which produces `company.json`.

## Final demo path

```
Teacher / Linear → Memorable → Student / Vercel → deterministic verification → Certified Research Company
  → Fresh Intern → composite of certified skills → FIND TECHNICAL CONTACT GAP → new candidate
```

- **Truly live (real QM + Memorable runs, recorded):**
  - the teacher's Linear run and the Memorable capture;
  - the fresh student's Vercel run from the recalled procedure. It is sanitized into
    `demo/fixtures/*-vercel*.json`.
- **Registry-backed:**
  - the certification decision: strict, all 8 rules, 6/6 checks;
  - the certified Research Company skill (`registry/`, `GET /api/skills`);
  - the Intern's first step, which reuses that certified, re-verified output.
- **Fixture-backed, labelled in the UI and the API:**
  - Analyze Repository and Evaluate Opportunity (hand-written stand-ins, uncertified);
  - the whole composite run, which is orchestration only: no agent is executed.
- **GAP:** Find Technical Contact has no skill at all. `POST /api/run` emits `gap.discovered`, and
  it becomes a candidate that is never certified. Draft Outreach is blocked.
- **Known limitations:** see `docs/REPO_OVERVIEW.md` §15–16. The composite task is fixed to Vercel,
  candidates are not persisted, and certification is still a manual CLI step.
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
  --require-isolation` certifies it on all 8 rules of `au-transfer-v1`. The canonical record is
  `registry/skills/research-company.json`, and `tests/integration.test.ts` replays the whole handoff.
- **Final demo layer: complete.** A fresh Intern composes a diligence task from the certified skill
  (`POST /api/run`), surfaces the Find Technical Contact GAP, and creates a candidate. Covered by
  `tests/product.test.ts`.
- The whole system in one page: [`docs/REPO_OVERVIEW.md`](docs/REPO_OVERVIEW.md). Runtime details
  are in `PROGRESS.md`.

## Setup

Requirements:
- **Node 24** (`.nvmrc`; `nvm use`). The qm CLI refuses Node 22.
- Python 3.9+. Stdlib only, nothing to pip install.
- git.
- Docker Desktop, **only** for the runtime owner.

```bash
git clone <GITHUB_REPO_URL> agent-university
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

## Branch ownership

| Branch | Owns | Must not casually edit |
|---|---|---|
| `feat/runtime` | QM runtime + Memorable integration, runtime orchestration, run APIs/scripts | UI components, verifier/certification internals |
| `feat/certification` | deterministic verifiers, schemas, certification logic, exam APIs, skill registry/certification records | QM/Memorable runtime, page/layout UI |
| `feat/ui-demo` | UI, visualization, demo mode, presentation states | QM/Memorable internals, verifier internals |

The exact file lists, next tasks and merge protocol are in [`docs/HANDOFF.md`](docs/HANDOFF.md).
