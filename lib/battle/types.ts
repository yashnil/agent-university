// FLOW FIGHTER — the shared contract for the /battle page. Every battle file builds against this.
//
// A Street Fighter–style visualization of a flow tournament (lib/arena.ts runArena):
//   - each Memorable flow is a FIGHTER (a procedurally drawn SVG caricature)
//   - each student run is an ATTACK: a certified run lands a hit on the opponent,
//     a failed run whiffs (the fighter stumbles and the failing rule is called out)
//   - matches are 1v1 on screen, as a ladder (A vs B, winner vs C, ...)
//   - Jev is the referee/announcer: ties ("TIME! JUDGES' DECISION") are settled by the Jev final
//   - the champion flow gets the victory screen: "TRUSTED FLOW"
//
// Data flow (all pure except the hook):
//   prompt text --parsePrompt()--> BattleSpec --POST /api/battle--> job id
//   SSE /api/arena/<id> ArenaEvents --Choreographer.push()--> FightAction[] (queued)
//   useBattle() plays the queue at a steady pace --reduce(state, action)--> BattleState --> components
//
// Components render ONLY from BattleState (+ the action being played). They never see ArenaEvents.

import type { ArenaEvent, ArenaOptions } from "../arena.ts";

export type { ArenaEvent, ArenaOptions };

// ------------------------------------------------------------------ prompt → spec (lib/battle/prompt.ts)

/** What a free-text prompt resolved to. `options` goes straight to runArena. */
export interface BattleSpec {
  prompt: string;
  options: ArenaOptions; // mode "dry" | "live", flows, perFlow, cases, procedures
  title: string; // arcade marquee, e.g. "3 FLOWS · 3 AGENTS · VERCEL / STRIPE / SUPABASE"
  notes: string[]; // human-readable interpretations and defaults applied, e.g. "mode: dry (no 'live' in prompt)"
  parser: "rules" | "jev"; // rules = deterministic regex parse; jev = OpenRouter fallback was used
}

// ------------------------------------------------------------------ fighters (lib/battle/fighters.ts)

export type FighterStyle = "karate" | "boxer" | "ninja" | "sumo" | "monk" | "robot";

export interface Palette {
  skin: string;
  hair: string;
  gi: string; // outfit main
  trim: string; // outfit trim / belt
  accent: string; // headband, gloves, aura
  aura: string; // special-move glow
}

/** A flow as a fighter. Deterministic from procedureId (same flow → same character, always). */
export interface FighterDef {
  id: string; // procedureId
  name: string; // display name, uppercase arcade style, <= 16 chars (derived from the flow title)
  title: string; // full flow title
  shortId: string; // e.g. "37196e61"
  source: "recall" | "given" | "fixture";
  rank: number | null; // Memorable recall rank
  style: FighterStyle;
  palette: Palette;
  seed: number; // 32-bit hash of procedureId, for any further procedural variation
  catchphrase: string; // shown on character select, e.g. "Two sources or bust."
}

// ------------------------------------------------------------------ fight actions (lib/battle/choreo.ts)

export type Pose = "idle" | "walk" | "punch" | "kick" | "special" | "hurt" | "block" | "stumble" | "ko" | "victory" | "taunt";
export type Side = "left" | "right";

export type FightActionKind =
  | "intro" // character select: all fighters shown; payload fighters
  | "match_start" // new 1v1: "ROUND n" then "FIGHT!"; attacker=left id, defender=right id
  | "attack_hit" // attacker's run certified: attacker punches/kicks/special, defender hurt, defender hp -= damage
  | "attack_miss" // attacker's run failed: attacker stumbles, attacker hp -= damage, label = failing rule
  | "time_up" // both finished their runs and nobody is KO'd: "TIME!" then "JUDGES' DECISION"
  | "judge" // Jev speaks: label = verdict line, sub = rationale; scores in meta
  | "ko" // defender goes down: "K.O."; attacker = winner, defender = loser
  | "match_end" // winner taunts; winner stays for the next match (hp refilled at next match_start)
  | "victory" // champion: "TRUSTED FLOW"; attacker = champion id
  | "announce" // any banner text (e.g. "LIVE: agents are working…", "ELIMINATED")
  | "error";

export interface FightAction {
  seq: number; // monotonically increasing
  kind: FightActionKind;
  duration: number; // ms the player should spend on this action before the next (choreo picks; ~600-2500)
  attacker?: string; // fighter id
  defender?: string; // fighter id
  damage?: number; // hp points (0-100 scale)
  move?: "punch" | "kick" | "special"; // for attack_hit: special when it was the flow's best/fastest run
  label?: string; // big text: "CERTIFIED!", "source_urls_min_two", "K.O.", "ROUND 2"
  sub?: string; // small text: "Stripe · 3 tools · 17.2s", rationale, etc.
  round?: number;
  meta?: Record<string, unknown>; // e.g. { scores: {id: number}, fighters: FighterDef[], runId, examCase }
}

// ------------------------------------------------------------------ state (lib/battle/reducer.ts)

export interface FighterState {
  def: FighterDef;
  hp: number; // 0-100
  pose: Pose;
  side: Side | null; // null = off stage (waiting / eliminated)
  runs: number; // finished student runs
  certified: number;
  failed: number;
  combo: number; // consecutive hits (resets on miss)
  eliminated: boolean;
  score: number | null; // Jev score 0-10 once judged
  rationale: string | null;
  lastRule: string | null; // last failing rule, for the HUD
}

export interface BattleMatch {
  round: number;
  left: string; // fighter id
  right: string;
  winner: string | null;
  decidedBy: "ko" | "judges" | "walkover" | null;
}

export type BattlePhase = "idle" | "starting" | "select" | "fighting" | "judging" | "victory" | "error";

export interface Banner {
  text: string; // "ROUND 1", "FIGHT!", "K.O.", "TIME!", "TRUSTED FLOW"
  sub?: string;
  tone: "neutral" | "hit" | "miss" | "ko" | "judge" | "win" | "error";
}

export interface BattleState {
  phase: BattlePhase;
  spec: BattleSpec | null;
  jobId: string | null;
  fighters: Record<string, FighterState>;
  order: string[]; // fighter ids in flow order
  matches: BattleMatch[];
  current: BattleMatch | null;
  action: FightAction | null; // the action being played right now (drives animations/effects)
  banner: Banner | null;
  referee: { model: string | null; status: string | null; line: string | null } | null;
  champion: string | null; // fighter id
  championRecord: unknown; // tournament.finished record (CertificationRecord) for the victory screen
  procedure: unknown; // tournament.finished procedure (ProcedureRecord)
  registry: string | null;
  feed: { seq: number; text: string; tone: Banner["tone"] }[]; // commentary ticker, newest last, capped 50
  dry: boolean;
  error: string | null;
}

// ------------------------------------------------------------------ module signatures (implemented by each owner)
//
// lib/battle/prompt.ts     export function parsePrompt(prompt: string): BattleSpec              (pure, rules)
//                          export async function parsePromptSmart(prompt: string): Promise<BattleSpec>
//                            (rules first; Jev/OpenRouter only if the rules found nothing numeric and a key exists)
// lib/battle/fighters.ts   export function fighterFor(flow: {procedureId: string; title: string; source: FighterDef["source"]; rank: number | null}): FighterDef
// lib/battle/choreo.ts     export function createChoreographer(): { push(e: ArenaEvent): FightAction[]; flush(): FightAction[] }
// lib/battle/reducer.ts    export const initialBattleState: BattleState
//                          export function reduce(state: BattleState, action: FightAction): BattleState  (pure)
// lib/battle/sfx.ts        export function createSfx(): { play(kind: "hit"|"miss"|"special"|"ko"|"round"|"fight"|"win"|"select"|"judge"): void; setMuted(m: boolean): void }  (WebAudio synth, no files, browser only)
// app/api/battle/route.ts  POST {prompt} -> 200 {id, spec} | 409 {error, running} | 400 {error}; uses startJob from app/_lib/arena-jobs
//                          events stream from the existing GET /api/arena/<id> (SSE, `event: arena`, data = ArenaEvent)
// components/battle/useBattle.ts   "use client"; export function useBattle(): { state: BattleState; start(prompt: string): Promise<void>; reset(): void; muted: boolean; setMuted(m: boolean): void; speed: number; setSpeed(x: number): void }
//
// components/battle/*.tsx props (all "use client", CSS modules next to each file, no new npm deps):
//   <Battle />                                                  page shell; composes everything; uses useBattle
//   <PromptConsole onStart={(p: string) => void} busy={boolean} lastSpec={BattleSpec|null} />   arcade "INSERT PROMPT" console + example prompts
//   <CharacterSelect fighters={FighterDef[]} spec={BattleSpec|null} />                          versus/select screen shown in phase "select"
//   <Stage action={FightAction|null} phase={BattlePhase}>{children}</Stage>                     background, floor, crowd, camera shake on hits
//   <Fighter def={FighterDef} pose={Pose} side={Side} hp={number} action={FightAction|null} />   SVG caricature + pose animations (faces right on the left side, mirrored on the right)
//   <HUD left={FighterState|null} right={FighterState|null} round={number} banner={Banner|null} dry={boolean} />  health bars, names, round, timer-ish
//   <Effects action={FightAction|null} />                                                        hit sparks, whiff dust, special aura, KO flash
//   <Announcer banner={Banner|null} referee={BattleState["referee"]} />                          big centered banner text + Jev referee speech bubble
//   <Ticker feed={BattleState["feed"]} />                                                        commentary ticker
//   <Victory state={BattleState} onRematch={() => void} />                                       champion screen with stats, flow text, record link
