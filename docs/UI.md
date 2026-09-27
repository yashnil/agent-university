# UI / demo app (`feat/ui-demo`)

The Next.js app that renders the Agent University story. New file, owned by the UI branch: it
does not touch `README.md`, `PROGRESS.md` or `docs/HANDOFF.md`, which stay shared.

## Run it

```bash
nvm use            # Node 24
npm install        # the scaffold PR added next/react/react-dom + TypeScript
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm run build      # production build
npm test           # unchanged shared baseline (python only, offline, no node_modules needed)
```

`npm test` was deliberately left alone: it must keep passing without `node_modules` so runtime
and certification can use it as the shared gate.

## What it renders

One scrolling page, `app/page.tsx`, in the demo's order:

1. **Lifecycle** — `components/LifecycleTimeline.tsx` over the `Event[]` stream, plus the
   `observed → transferred → certified` progression.
2. **Transfer exam** — `components/TransferExam.tsx`: teacher vs fresh student, the derived
   isolation facts, and the deterministic verifier's `VerificationResult` checks.
3. **Certified capability** — the `Skill` record and the `company.json` the student produced.
4. **Composition and the GAP** — `components/PipelineStrip.tsx` over `plan.composed` steps and
   `components/GapBanner.tsx` over `gap.discovered`.

Everything is derived from contract data. Nothing about the lifecycle is hardcoded in the UI,
so live data replaces fixtures without component changes.

## Demo mode / live mode

The mode is a URL query param, so it needs no client JS and is safe to drive from a keyboard
during a demo:

- `/` or `/?mode=demo` — **demo mode.** Reads `demo/fixtures/*` and `demo/cases.json` only. No
  QM, no Docker, no secrets, no network.
- `/?mode=live` — **live mode.** Reads the runtime's record at
  `.agent-university/skills/<skillId>.json` (gitignored). If that file does not exist yet, the
  page falls back to fixtures and says so in a banner. **The demo can never break because the
  runtime is mid-flight.**

All of that lives in one file: `app/_lib/data.ts` (`loadLifecycle(mode)`).

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

Shared files this branch touches, all allowed by `docs/HANDOFF.md` §1 for the scaffold PR only:

| File | Change |
|---|---|
| `package.json` | added `next`, `react`, `react-dom`, TypeScript dev deps, and the `dev`/`build`/`start`/`typecheck` scripts. Existing scripts and `@yc-software/qm` untouched. |
| `package-lock.json` | the matching lockfile. **Nobody else changes dependencies until this is merged.** |
| `.gitignore` | appended `/.next/`, `/out/`, `next-env.d.ts`, `*.tsbuildinfo`. |

Not touched by this branch: `lib/types.ts`, `schemas/**`, `demo/fixtures/**`, `demo/cases.json`,
`scripts/*.py`, `sandbox/**`, `qm.config.jsonc`, `.env.example`, `README.md`, `PROGRESS.md`,
`docs/HANDOFF.md`, `app/api/**`.
