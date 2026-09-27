# UI / demo app (`feat/ui-demo`)

The Next.js app that renders the swar*mem* story. New file, owned by the UI branch: it
does not touch `README.md`, `PROGRESS.md` or `docs/HANDOFF.md`, which stay shared.

## Brand and vocabulary

The mark is `public/swarmem-logo.png` (and `app/icon.png`, which Next serves as the favicon),
cropped from the source art. The dark ramp in `app/globals.css` is taken from the logo itself —
ground `#14161f`, ink `#f4f1ea` — so the mark sits *in* the page rather than on a mismatched
square. `--brand: #f0a04b` and `--brand-dim: #8d6237` are the logo's amber; they are used for the
mark only, never for status, so brand never competes with `--pass` / `--fail` / `--warn`.

**No education vocabulary in user-visible copy.** The product is about one agent's procedure being
reproduced and verified by a different agent, not about school:

| Not this | This |
|---|---|
| teacher | origin agent |
| student / fresh student | replicating agent |
| exam, transfer exam | trial, transfer trial |
| exam case | trial case |
| taught by / proved by | learned from / replicated by |
| Freshman #N, Student #N | Agent #N |

`certified`, `verified`, `skill`, `procedure`, `flow` and `registry` stay: those are quality and
compliance words, not school words.

**Contract identifiers are data and are never relabelled.** Event names (`exam.started`,
`exam.passed`), field names (`examCase`, `student`, `teacher`), rule ids
(`student_distinct_from_teacher`) and verifier check names render verbatim, in mono. A row can
legitimately read **ORIGIN AGENT** beside the raw key `teacher`: the label is ours, the key is
data. Renaming a key to match our prose would mean the page no longer shows what is on disk.

The fictional Northwind fixtures were relabelled (`Scout (origin)`, `Scout (replica)`) and the
engine-generated fixtures regenerated with `UPDATE_FIXTURES=1 npm run test:ts`. The sanitized
real-run fixtures (`demo/fixtures/*-vercel*.json`) and `registry/` were **not** touched:
`tests/integration.test.ts` pins the committed ledger to a recomputation from those fixtures, so
relabelling them would force a rewrite of an audit record. Those rows still read "teacher" and
"student" until whoever owns them re-runs the certify command in `docs/REPO_OVERVIEW.md` §9.

## Run it

```bash
nvm use            # Node 24
npm install        # the scaffold PR added next/react/react-dom + TypeScript
npm run dev        # http://localhost:3001
npm run typecheck  # tsc --noEmit
npm run build      # production build
npm test           # unchanged shared baseline (python only, offline, no node_modules needed)
```

Two scaffold constraints, both deliberate:

- **Port 3001, not 3000.** `.env`'s `PUBLIC_API_URL` points QM agents at
  `http://host.docker.internal:3000`. If the UI sat on 3000, a sandboxed agent's self-API calls
  would hit this Next app instead of QM core.
- **`typescript` is pinned to `5.9.3`.** With `typescript@7`, `next build` silently stops reading
  `paths` from `tsconfig.json` and every `@/*` import fails to resolve. Do not bump it without
  re-running `npm run build`.

`npm test` was deliberately left alone: it must keep passing without `node_modules` so runtime
and certification can use it as the shared gate.

## What it renders

One scrolling page, `app/page.tsx`, in the demo's order:

0. **The 6-step chain** — `components/LifecycleTimeline.tsx` renders
   `observed → recalled → exam started → exam passed → transferred → certified` per
   `docs/HANDOFF.md`, with every unsatisfied step marked **pending**. A run that stopped at
   `transferred` shows steps 4 and 6 pending rather than a shorter timeline: seeing where proof
   stops is the point. Step 5 is tagged `status`, because `transferred` is a `Skill.status` and
   there is no event for it.
0. **Certification decision** — `components/RulingsPanel.tsx` over the 8 rulings of policy
   `au-transfer-v1`, each with its verbatim reason and its evidence JSON. This is the credibility
   centerpiece: it shows *why* a skill was or was not certified, straight from the engine.
1. **Lifecycle** — `components/LifecycleTimeline.tsx` over the `Event[]` stream, plus the
   `observed → transferred → certified` progression.
2. **Transfer exam** — `components/TransferExam.tsx`: teacher vs fresh student, the derived
   isolation facts, and the deterministic verifier's `VerificationResult` checks.
3. **Certified capability** — the `Skill` record and the `company.json` the student produced.
4. **Composition and the GAP** — `components/PipelineStrip.tsx` over `plan.composed` steps and
   `components/GapBanner.tsx` over `gap.discovered`.

Everything is derived from contract data. Nothing about the lifecycle is hardcoded in the UI,
so live data replaces fixtures without component changes.

## Demo mode / live mode / outcome

The mode is a URL query param, so it needs no client JS and is safe to drive from a keyboard
during a demo:

- `/` or `/?mode=demo` — **demo mode.** Reads `demo/fixtures/*` and `demo/cases.json` only. No
  QM, no Docker, no secrets, no network.
- `/?mode=live` — **live mode.** Reads the runtime's record at
  `.agent-university/skills/<skillId>.json` (gitignored). If that file does not exist yet, the
  page falls back to fixtures and says so in a banner. **The demo can never break because the
  runtime is mid-flight.**

`?case=vercel` presents the **real** transfer exam instead of the fictional one: the sanitized
Linear → Vercel run `feat/runtime` produced (`demo/fixtures/*-vercel*.json`), including the 13
isolation checks the runtime actually performed, which the UI renders in place of its own derived
ones (`TransferResult.isolation`, a producer-added key per `docs/HANDOFF.md` §2). That run stops at
`transferred` by design — runtime proves, certification promotes — so the page says so instead of
claiming certification. `?case=northwind` (default) is the fictional end-to-end lifecycle with the
certified decision and the composition GAP.

`?outcome=failed` presents the recorded **failed** exam instead of the certified one
(`demo/fixtures/certification-record-failed.json`): the timeline drops `exam.passed` and
`skill.certified`, the failing verifier check is shown, the failed rule's evidence is expanded, and
section 03 becomes "Capability withheld". A failed exam is a `TransferResult` with
`passed: false` — there is no `exam.failed` event and the skill stays `transferred`.

All of that lives in one file: `app/_lib/data.ts` (`loadLifecycle(mode, outcome, case)`), which resolves
sources in this order:

| Order | Source | Written by |
|---|---|---|
| 1 | `registry/skills/<id>.json` (`CertificationRecord`) | `feat/certification`, `certify.ts --promote` |
| 2 | `.agent-university/skills/<id>.json` (`Skill` + `events[]`) | `feat/runtime`, `au_record.py` |
| 3 | `demo/fixtures/**` | committed fixtures |

`registry/index.json` is read in **every** mode (it is committed, so it is real data either way) and
rendered by `components/RegistryPanel.tsx` as section 04, "The registry" — one row per certified
skill, with the champion-flow block (`title`, `passRate`, `runs`, `judgeScore`, `tournamentId`) when
a flow tournament promoted it, and an explicit "certified by a single exam" line when it did not.
Empty registry renders as "nothing is certified yet", which is a meaningful state, not an error.

The UI imports `CertificationRecord` and `RegistryIndex` from `@/lib/certification` directly — the
structural stand-in that predated that file is gone. `decision.policy.requireIsolation` and the
optional `metrics` (`durationMs`, `toolCalls`, `turns`, `costUsd`) are rendered when present and
omitted silently when absent, which is the common case for hand-certified records.

A promoted record's `transfer.artifact.path` is either a sandbox path (unreadable from Next) or a
repo-relative path certification committed. The UI reads the latter, so live mode shows the artifact
that was actually certified instead of a stand-in.

The UI declares the `CertificationRecord` fields it reads structurally, so it compiles before the
certification branch merges; afterwards that block can become
`import type { CertificationRecord } from "@/lib/certification"` with no other change.

## Seam for the backend branches

The UI reads contract shapes from `lib/types.ts` and nothing else. Two integration points, both
in `app/_lib/data.ts`:

- **Live record (works today):** the UI expects a `Skill` object with an added `events` array,
  and optionally `transferResult`, at `.agent-university/skills/<skillId>.json`. That is the
  shape `scripts/au_record.py` already owns — a record with `events` is exactly what
  `docs/HANDOFF.md` §2 describes. Nothing new to build: write that file and live mode lights up.
- **Run API (when it lands):** when runtime adds `app/api/run/**` returning contract
  `TransferResult`s and `Event`s, swap the disk read in `loadLifecycle`'s live branch for a fetch
  of that route. It is a single function, and no component signature changes.

The UI never writes to `.agent-university/`, never shells out to `qm`, `docker` or `memorable`,
and never imports anything under `scripts/`.

### Live QM artifacts

With `sandbox.backend: local`, QM writes the certified artifact *inside* the sandbox container
(`/root/workspace/scout/<slug>/company.json` on a `qm-home-*` volume), which Next cannot read.
Convention, so the UI can show the real file:

```
.agent-university/artifacts/<examCase>/<artifactType>     # e.g. exam-vercel/company.json
```

Runtime `docker cp`s it there after the verifier passes (the record still carries the true
in-sandbox `artifactPath` for provenance). If the file is absent, live mode renders the lifecycle
from the record and says in a banner that the artifact body is fixture-backed — it never pretends
a fixture is live output.

### Nothing identifying on screen

QM scope slugs embed the operator's email: a real sandbox is `qm-sbx-personal-<slugified-admin-
email>-<hash>`, and live artifact paths carry it. `redactPath()` in `app/_lib/data.ts` rewrites
those to `<redacted>` for every live path before render, so the demo can be projected or streamed.
Agent identities are already safe by contract (`qm-thread-<sha256(threadRef)[:12]>`, no email).
Admin-login links, tokens and raw run traces must never reach a page prop.

Failing fixtures are welcome: `components/ChecksTable.tsx` and `TransferExam.tsx` render
`passed: false` and per-check failures already, and there is no `exam.failed` event — a failed
exam is a `TransferResult` with `passed: false`, leaving the skill at `transferred`.

## Merge safety

Run before opening a PR:

```bash
bash scripts/ui_merge_check.sh
```

It (1) checks every changed file against the UI ownership list in `docs/HANDOFF.md` §1,
(2) trial-merges `origin/main`, `origin/feat/runtime` and `origin/feat/certification` and prints
any conflicting paths, and (3) runs `npm test`.

`package.json` conflicts with `feat/certification` while both PRs are open (both sides edit the
`scripts` block). The check reports that as WARN, not a failure. The resolution is a union — keep
every script from both sides, keep `"type": "module"` from certification and the UI dependencies:

```jsonc
"type": "module",                                   // certification (Node 24 native TS engine)
"scripts": {
  "dev": "next dev -p 3001",                        // UI
  "build": "next build",                            // UI
  "start": "next start -p 3001",                    // UI
  "typecheck": "tsc --noEmit",                      // UI
  "test": "npm run test:contracts && npm run test:unit && npm run test:ts && npm run test:compile",
  "test:ts": "node --test tests/*.test.ts",         // certification
  "certify": "node scripts/certify.ts",             // certification
  "registry": "node scripts/registry.ts",           // certification
  // ... existing qm scripts unchanged
}
```

Verified: with both sibling branches merged in, `npm test` passes (31 tests) and `npm run build`
succeeds. One UI-side fix was needed for that and is already in `tsconfig.json`:
`allowImportingTsExtensions`, because certification's engine imports with explicit `.ts`
extensions and Next type-checks the whole project.

Shared files this branch touches, all allowed by `docs/HANDOFF.md` §1 for the scaffold PR only:

| File | Change |
|---|---|
| `package.json` | added `next`, `react`, `react-dom`, TypeScript dev deps, and the `dev`/`build`/`start`/`typecheck` scripts. Existing scripts and `@yc-software/qm` untouched. |
| `package-lock.json` | the matching lockfile. **Nobody else changes dependencies until this is merged.** |
| `.gitignore` | appended `/.next/`, `/out/`, `next-env.d.ts`, `*.tsbuildinfo`. |

Not touched by this branch: `lib/types.ts`, `schemas/**`, `demo/fixtures/**`, `demo/cases.json`,
`scripts/*.py`, `sandbox/**`, `qm.config.jsonc`, `.env.example`, `README.md`, `PROGRESS.md`,
`docs/HANDOFF.md`, `app/api/**`.
