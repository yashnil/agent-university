# Agent University

**Agent University certifies that a procedure learned by one agent transfers to a different
agent on a fresh task before it becomes trusted organizational capability.**

North star: *one agent learns → another agent proves it → every agent can inherit it.*

## Demo path (fixed)

teacher → Memorable → student transfer exam → deterministic verifier → **Certified** →
fresh-agent composition → visible **GAP**

- The teacher case is **Linear** and the unseen exam case is **Vercel** (`demo/cases.json`).
- The skill is **Research Company**, which produces `company.json`.

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
- Details are in `PROGRESS.md`.

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
