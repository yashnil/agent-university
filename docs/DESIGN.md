# swarmem design system

"Academic instrument": editorial restraint, generous dark negative space, evidence set like a
scientific record. An accreditation office crossed with a lab notebook. Warmth comes only from the
logo's orange and a serif display face. The single job of every visual decision is **making
evidence legible**, so a viewer can see *why* a skill is or is not trusted.

Explicitly not: centred hero with a gradient, incidental blue/purple, uniform card grids,
glassmorphism, drop shadows, spinners, emoji.

## 1. Brand

The name is **swar*mem*** — always lowercase, one word, `mem` italic, set in the display serif.
Both halves are `--fg`; the italic is the only difference. Never "Swarmem", "SwarMem" or
"swarm mem". In running body text, plain `swarmem` is fine.

The mark is a dotted brain: cream outline, orange pathways converging on a ringed cream node.

| File | Use |
|---|---|
| `public/logo.png` | header mark, via `next/image`, `priority` |
| `app/icon.png` | favicon (Next picks it up, no code) |
| `app/apple-icon.png` | iOS home screen |

The PNG has its `#13161E` ground **baked in**, so the mark may only ever sit on `--bg` — never on a
panel, where the square edge would show. Never stretch, recolour, rotate, crop further, or add
effects. Minimum 24px in UI, 16px in the favicon only; below that the dots blur, so use the
wordmark alone. The brain is never reused as decoration — only its grammar is.

**Lockup** (`components/Logo.tsx`, rendered once in `app/layout.tsx`): mark 48×48 + 12px + wordmark
at 25px, `letter-spacing: -0.01em`, inside a link to `/` with `aria-label="swarmem home"` and
`alt=""` on the image. Hover underlines the wordmark; the mark itself never changes.

## 2. Visual grammar

Taken from the mark, and used for structure rather than ornament:

| Form | Meaning |
|---|---|
| dotted line / border | provisional, in transit, unverified |
| solid filled node | verified, lit |
| ringed node | the canonical, central record |
| dashed empty node | the GAP — a step with no certified skill |
| dotted path, leading segment pulsing | live, in progress |

Implemented once, in `components/StatusNode.tsx` (`observed · transferred · certified · gap · live
· failed`) and `components/LifecyclePath.tsx` (`done` lights dotted → solid; `live` travels).
The lifecycle and the composition pipeline use this motif instead of steppers or progress bars.
**Circles are reserved for status nodes. Nothing else is round.**

## 3. Colour

Dark only — the mark's ground is baked in, so there is no light theme to be had.

| Token | Value | Use | On `--bg` |
|---|---|---|---|
| `--bg` | `#13161E` | page ground; **must equal the PNG exactly** | — |
| `--surface` | `#1B1F29` | raised panels | — |
| `--surface-2` | `#232834` | hover, nested | — |
| `--border` | `#2E3441` | hairlines | 1.45:1 (decorative) |
| `--fg` | `#F2EEE6` | body text | 15.63:1 |
| `--fg-muted` | `#9A968E` | secondary text | 6.14:1 |
| `--accent` | `#F0A04B` | certified, primary action | 8.47:1 |
| `--accent-dim` | `#8A5E35` | decorative paths/borders, **never text** | 3.21:1 |
| `--on-accent` | `#13161E` | text on orange fills | 8.47:1 |
| `--pass` | `#7FC8A0` | verifier check PASS | 9.19:1 |
| `--fail` | `#F26D6D` | check FAIL, rule failed | 6.19:1 |

All ratios computed, not assumed. The floor is `--fg-muted` on `--surface-2` at **5.00:1** — still
above 4.5, but with no headroom, so muted text does not go on nested hover surfaces.

Status mapping: observed = cream dotted outline · transferred = `--accent-dim` dotted with a solid
endpoint · certified = solid `--accent` node + ring · GAP = `--fg-muted` dashed empty.
**Colour never carries status alone**: every state also has a shape, and a text label.

## 4. Type

Three roles, loaded with `next/font`:

- **Display** — Newsreader, variable, `opsz` axis exposed. The wordmark, page titles, skill names
  and the certification verdict. It carries the register; the words stay plain.
  `font-synthesis: none` on the wordmark's italic, so the true italic is never faked.
- **Body/UI** — IBM Plex Sans (`--font-body`).
- **Data** — IBM Plex Mono (`--font-mono`), tabular numerals: run ids, rule ids, file names
  (`company.json`), JSON, check counts (`6/6`), policy names (`au-transfer-v1`).

Rule of thumb: **if a viewer might copy it or grep it, it is mono.**

Scale, 1.25 from a 16px base: `--t-2` 10.2 · `--t-1` 12.8 · `--t0` 16 · `--t1` 20 · `--t2` 25 ·
`--t3` 31.3 · `--t4` 39.1. Line heights `--lh-tight` 1.15 (display), `--lh-snug` 1.35 (data),
`--lh-body` 1.6 (prose).

## 5. Space and shape

4px grid: `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s6` 24 · `--s8` 32 · `--s12` 48 ·
`--s16` 64. Radii: `--r-sm` 4px (inputs, buttons, tags, chips), `--r` 8px (panels). Hairline 1px
borders and surface tone do all the separating — there are no drop shadows. The header sits
directly on `--bg`, not on a panel, so the mark's baked ground blends.

## 6. States and motion

| Token | Duration | Use |
|---|---|---|
| `--dur-hover` | 120ms | hover, colour |
| `--dur-expand` | 200ms | expand / collapse |
| `--dur-path` | 500ms | a path lighting dotted → solid as a status advances |

Easing `--ease`. Focus-visible is a 2px `--accent` ring at 2px offset, set globally — components
never override it. Loading is a slow dotted-path shimmer, never a spinner. Under
`prefers-reduced-motion` every animation becomes an instant state change (enforced globally in
`app/globals.css`, and again locally wherever motion is load-bearing).

## 7. Vocabulary

No education terminology in authored copy. The academic register comes from the serif, the layout
and the restraint — not the words.

| Not this | This |
|---|---|
| teacher | origin agent |
| student | replicating agent |
| exam, transfer exam | trial |
| exam case | unseen case |

`certified`, `certification`, `verified`, `skill`, `procedure`, `flow`, `registry` stay: those are
accreditation words, not school words.

**Contract identifiers are data and are never relabelled** — event names (`exam.started`), field
keys (`examCase`, `student`), rule ids (`student_distinct_from_teacher`), check names, policy ids.
They render verbatim, in mono.

**And the mapping is shown, not implied:** wherever a prose label sits beside its contract
identifier, the identifier appears next to it in a small mono tag (`.idTag`) — "Replicating agent"
carries `student`, "Trial started" carries `exam.started`. Evaluators read the JSON; this makes the
translation self-evident instead of looking like a mismatch.

## 8. Signature components

| Component | Anatomy |
|---|---|
| `Logo` | mark + wordmark lockup, global, links home |
| `StatusNode` | the grammar glyph: observed / transferred / certified / gap / live / failed |
| `LifecyclePath` | forward-only connector; lights dotted → solid; `live` travels |
| `LifecycleTimeline` | the 6-step chain + the event record |
| `RulingsPanel` | rule id in mono, pass/fail mark, one-line reason, expandable evidence |
| `ChecksTable` | the deterministic verifier's checks and its `n/m` count |
| `TransferExam` / `AgentCard` | origin vs replicating agent, symmetric, + isolation checklist |
| `ArtifactChip` | file name in mono + schema status (frozen / v0 placeholder) |
| `PipelineStrip` / `GapBanner` | the artifact chain, and where certification stops |
| `RegistryPanel` | the canonical record, ringed; champion flow when a tournament promoted it |
| `ModeBadge` | where the data came from: demo fiction / real run / canonical / live |
| `ModeSwitch` | changes the source; scenario ("what happened") is a separate control |

`ModeBadge` answers one question only — *where is this data from?* What happened in a run (a failed
trial) is a different question and rides beside it as a scenario tag, so the badge never becomes
ambiguous.
