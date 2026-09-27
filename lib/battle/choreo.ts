// FLOW FIGHTER choreographer: turns the ArenaEvent stream (lib/arena.ts runArena) into a watchable fight
// script of FightActions. Pure and synchronous: no timers, no I/O. The hook (useBattle) paces playback.
//
// SEMANTICS (exact)
//   ids        A fighter id is the heat's flow.procedureId, or "heat-<n>" when the heat has no flow
//              (fallback flow {procedureId: "heat-<n>", title: examCompany ?? examCase, source: "fixture", rank: null}).
//   damage     dmg = round(100 / (perFlow + 1)). Every fighter has 100 hp at each match_start (SF refill).
//   seq        Every action gets a unique, strictly increasing seq (1, 2, 3, ...) across the whole script.
//
//   tournament.started  -> "intro" (meta.fighters: FighterDef[] in flow order, meta.dry, meta.perFlow, meta.threshold,
//                          meta.judgeModel, meta.rejected), then the ladder begins:
//                          match 1 = flows[0] vs flows[1]; match k = winner(k-1) vs flows[k].
//                          1 flow: announce "EXHIBITION" then a solo match_start (attacker = flow, defender undefined).
//                          Duplicate tournament.started events are ignored.
//   match_start         attacker = left id, defender = right id (undefined in a solo match), round = k,
//                          label "ROUND k", sub "<LEFT> VS <RIGHT>", meta {left: FighterDef, right: FighterDef|null, walkover?: true}.
//   student.finished    buffered per heat (duplicates of the same heat+i are ignored; runs of eliminated flows are dropped).
//                          While a match is active the two fighters' buffers are played alternating left/right
//                          (if the side whose turn it is has nothing buffered, the other side goes; the turn stays):
//                          certified -> "attack_hit": attacker = flow, defender = opponent (undefined when solo),
//                            damage = dmg (opponent hp -= dmg), move = "special" for the flow's fastest known certified
//                            run (once per flow; fastest among played + buffered by metrics.durationMs), otherwise
//                            alternating "punch"/"kick" per flow. label "CERTIFIED!", sub "<Company> · <n> tools · <t>s".
//                            duration 1600 for special, 1100 otherwise.
//                          failed -> "attack_miss": attacker = flow, damage = dmg (attacker hp -= dmg, self damage),
//                            label = first failed rule ?? first failed check ?? "RUN CRASHED", sub = company. duration 1200.
//                          meta on both: {heat, i, runId, examCase, examCompany, student, summary, error, hp: {id: hp}}.
//                          Runs of flows not on stage stay buffered until their match.
//   KO by damage        as soon as a fighter's hp <= 0: "ko" (attacker = winner, defender = loser, label "K.O.",
//                          meta.decidedBy "ko") then "match_end". The loser is eliminated; its unplayed runs are dropped.
//                          The winner keeps its unplayed runs for the next match.
//   decision            when both fighters have played all their runs (heat.finished.runs, else perFlow) and no KO,
//                          it waits for heat.finished of both, then:
//                          - exactly one does not advance: "ko" (winner = the advancing one, label "ELIMINATED",
//                            sub "pass rate 33% < 50%") then "match_end" (decidedBy "ko").
//                          - both advance: "time_up", then WAIT for final.finished; the winner is the one ranked higher
//                            (lower place) in final.finished.ranking: "judge" (attacker = winner, defender = loser,
//                            label "JEV: <NAME> WINS", sub = winner rationale, meta.scores {id: score} for every scored
//                            finalist, meta.ranking) then "match_end" (meta.decidedBy "judges"). No "ko" for judges.
//                          - neither advances: DOUBLE K.O. = two "ko" actions (attacker undefined, defender = left, then
//                            right, label "DOUBLE K.O.") then "match_end" (attacker undefined, meta.decidedBy "double_ko").
//                            The next match's left is the next flow (walkover; match_start meta.walkover = true). If only one
//                            flow is left it fights solo like an exhibition.
//                          - solo match: advances -> "match_end" (winner = flow, decidedBy "walkover");
//                            does not advance -> "ko" (attacker undefined, defender = flow, "ELIMINATED") then "match_end"
//                            (attacker undefined, decidedBy "ko").
//   match_end           attacker = winner (undefined if nobody), defender = loser (undefined if none), round,
//                          label "<WINNER> WINS" | "NO CONTEST", meta {decidedBy, winner, loser, eliminated: string[]}.
//                          The next match_start follows immediately if flows remain.
//   final.started       announce "FINAL JUDGMENT" (sub "Jev weighs N finalists", meta.finalists ids) once. It is emitted
//                          right away if the ladder is waiting on the judges or finished; otherwise it is deferred and
//                          emitted right before the first "judge" action (so it never interrupts a fight).
//   final.finished      stored; resolves a pending judges' decision.
//   tournament.finished "victory": attacker = champion.procedureId, label "TRUSTED FLOW",
//                          sub "<pass rate>% pass · Jev <score>" (Jev part omitted without a score),
//                          meta {record, procedure, registry, promoted, champion, fighter: FighterDef}.
//                          First the ladder is force-resolved (see flush). If the ladder winner differs from the champion,
//                          announce "REFEREE OVERRULES" (sub "<CHAMPION> TAKES THE BELT") precedes victory.
//                          No champion: announce "NO TRUSTED FLOW" (meta.final = true) instead of victory.
//   error               "error" action, label = message.
//   student.started, unknown or out-of-order events never throw; events before tournament.started are buffered.
//
//   flush()             force-resolves whatever it can with the information available now: plays all buffered runs of
//                          the current fighters, treats a missing heat.finished as "advances iff certified/played >= threshold
//                          (and >= 1 certified)" and a missing final.finished as "champion wins, else higher pass rate,
//                          tie -> left". Emits victory if tournament.finished was seen and victory is not out yet.
//
// Durations (ms): intro 3000, match_start 2200, hit 1100, special 1600, miss 1200, ko 2000, match_end 1600,
//                 time_up 1800, judge 2600, victory 2500, announce 1500, error 2500.

import type { ArenaEvent, FighterDef, FightAction } from "./types.ts";
import { fighterFor } from "./fighters.ts";

type StartedEv = Extract<ArenaEvent, { type: "tournament.started" }>;
type RunEv = Extract<ArenaEvent, { type: "student.finished" }>;
type HeatEv = Extract<ArenaEvent, { type: "heat.finished" }>;
type FinalStartedEv = Extract<ArenaEvent, { type: "final.started" }>;
type FinalEv = Extract<ArenaEvent, { type: "final.finished" }>;
type DoneEv = Extract<ArenaEvent, { type: "tournament.finished" }>;

export interface Choreographer {
  push(e: ArenaEvent): FightAction[];
  flush(): FightAction[];
}

export const DURATIONS = {
  intro: 3000, match_start: 2200, hit: 1100, special: 1600, miss: 1200, ko: 2000, match_end: 1600,
  time_up: 1800, judge: 2600, victory: 2500, announce: 1500, error: 2500,
} as const;

interface Entrant { heat: number; id: string; def: FighterDef; company: string }

interface Match {
  round: number;
  left: Entrant;
  right: Entrant | null; // null = solo (exhibition / last flow standing)
  hp: Record<string, number>;
  turn: "left" | "right";
  status: "fighting" | "judging" | "over";
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const secs = (ms: number | undefined) => (typeof ms === "number" && Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : null);
const durOf = (r: RunEv) => {
  const d = r.metrics?.durationMs;
  return typeof d === "number" && Number.isFinite(d) ? d : Infinity;
};

export function createChoreographer(): Choreographer {
  let seq = 0;
  let out: FightAction[] = [];

  let started: StartedEv | null = null;
  let entrants: Entrant[] = [];
  let perFlow = 3;
  let threshold = 0.5;
  let dmg = 25;

  const seen = new Set<string>(); // "heat:i"
  const buffers = new Map<number, RunEv[]>(); // unplayed runs per heat
  const played = new Map<number, number>();
  const certifiedPlayed = new Map<number, number>();
  const knownCertDur = new Map<number, number[]>(); // durations of every known certified run (played + buffered)
  const specialUsed = new Set<number>();
  const strikeCount = new Map<number, number>(); // for punch/kick alternation
  const eliminated = new Set<number>();
  const heatDone = new Map<number, HeatEv>();

  let finalStarted: FinalStartedEv | null = null;
  let finalAnnounced = false;
  let final: FinalEv | null = null;
  let done: DoneEv | null = null;
  let victoryOut = false;

  let match: Match | null = null;
  let nextIdx = 0; // next entrant index to enter the ladder
  let round = 0;
  let ladderOver = false;
  let ladderWinner: Entrant | null = null;

  const emit = (a: Omit<FightAction, "seq">) => {
    const act = { seq: ++seq, ...a } as FightAction;
    // drop undefined keys so actions stay tidy (and JSON/deepEqual friendly)
    for (const k of Object.keys(act) as (keyof FightAction)[]) if (act[k] === undefined) delete act[k];
    out.push(act);
  };

  const byHeat = (heat: number) => entrants.find((x) => x.heat === heat) ?? null;
  const byId = (id: string) => entrants.find((x) => x.id === id) ?? null;

  const totalRuns = (heat: number) => heatDone.get(heat)?.runs ?? perFlow;
  const exhausted = (heat: number, force: boolean) =>
    (buffers.get(heat)?.length ?? 0) === 0 && (force || (played.get(heat) ?? 0) >= totalRuns(heat));

  /** Does the flow advance? null = not known yet (and not forcing). */
  const advancesOf = (heat: number, force: boolean): boolean | null => {
    const h = heatDone.get(heat);
    if (h) return !!h.advances;
    if (!force) return null;
    const e = byHeat(heat);
    if (final && e) return final.ranking.some((r) => r.procedureId === e.id || r.heat === heat);
    const p = played.get(heat) ?? 0;
    const c = certifiedPlayed.get(heat) ?? 0;
    return p > 0 && c >= 1 && c / p >= threshold;
  };

  const passRateOf = (heat: number) => {
    const h = heatDone.get(heat);
    if (h) return h.passRate;
    const p = played.get(heat) ?? 0;
    return p ? (certifiedPlayed.get(heat) ?? 0) / p : 0;
  };

  const hpSnap = (m: Match) => ({ ...m.hp });

  const announceFinal = () => {
    if (finalAnnounced || !finalStarted) return;
    finalAnnounced = true;
    const n = finalStarted.finalists.length;
    emit({ kind: "announce", duration: DURATIONS.announce, label: "FINAL JUDGMENT",
      sub: `Jev weighs ${n} finalist${n === 1 ? "" : "s"}`,
      meta: { finalists: finalStarted.finalists.map((f) => f.procedureId), judgeModel: finalStarted.judgeModel } });
  };

  const startMatch = (left: Entrant, right: Entrant | null, walkover: boolean) => {
    round++;
    match = { round, left, right, hp: { [left.id]: 100, ...(right ? { [right.id]: 100 } : {}) }, turn: "left", status: "fighting" };
    emit({ kind: "match_start", duration: DURATIONS.match_start, attacker: left.id, defender: right?.id, round,
      label: `ROUND ${round}`, sub: right ? `${left.def.name} VS ${right.def.name}` : `${left.def.name} · EXHIBITION`,
      meta: { left: left.def, right: right?.def ?? null, ...(walkover ? { walkover: true } : {}) } });
  };

  /** Pick the next pairing after a match (or at the start). */
  const nextMatch = (holder: Entrant | null) => {
    match = null;
    if (holder) {
      if (nextIdx < entrants.length) startMatch(holder, entrants[nextIdx++], false);
      else { ladderOver = true; ladderWinner = holder; }
      return;
    }
    // nobody holds the belt (start, or after a double KO)
    const remaining = entrants.length - nextIdx;
    if (remaining <= 0) { ladderOver = true; ladderWinner = null; return; }
    const walkover = nextIdx > 0;
    if (remaining === 1) startMatch(entrants[nextIdx++], null, walkover);
    else { const l = entrants[nextIdx++]; startMatch(l, entrants[nextIdx++], walkover); }
  };

  const endMatch = (m: Match, winner: Entrant | null, loser: Entrant | null, decidedBy: string, gone: Entrant[]) => {
    for (const g of gone) { eliminated.add(g.heat); buffers.set(g.heat, []); }
    m.status = "over";
    emit({ kind: "match_end", duration: DURATIONS.match_end, attacker: winner?.id, defender: loser?.id, round: m.round,
      label: winner ? `${winner.def.name} WINS` : "NO CONTEST",
      meta: { decidedBy, winner: winner?.id ?? null, loser: loser?.id ?? null, eliminated: gone.map((g) => g.id) } });
    nextMatch(winner);
  };

  const playRun = (m: Match, side: "left" | "right", r: RunEv) => {
    const me = side === "left" ? m.left : m.right!;
    const foe = side === "left" ? m.right : m.left;
    played.set(me.heat, (played.get(me.heat) ?? 0) + 1);
    const company = r.examCompany ?? r.examCase ?? me.company;
    const meta = { heat: r.heat, i: r.i, runId: r.runId, examCase: r.examCase, examCompany: r.examCompany ?? null,
      student: r.student?.name ?? null, summary: r.summary, error: r.error };
    if (r.certified) {
      certifiedPlayed.set(me.heat, (certifiedPlayed.get(me.heat) ?? 0) + 1);
      const d = durOf(r);
      const known = knownCertDur.get(me.heat) ?? [];
      let move: "punch" | "kick" | "special";
      if (!specialUsed.has(me.heat) && known.every((k) => d <= k)) { move = "special"; specialUsed.add(me.heat); }
      else {
        const n = strikeCount.get(me.heat) ?? 0;
        strikeCount.set(me.heat, n + 1);
        move = n % 2 === 0 ? "punch" : "kick";
      }
      if (foe) m.hp[foe.id] = (m.hp[foe.id] ?? 100) - dmg;
      const tools = typeof r.metrics?.toolCalls === "number" ? `${r.metrics.toolCalls} tools` : null;
      emit({ kind: "attack_hit", duration: move === "special" ? DURATIONS.special : DURATIONS.hit, attacker: me.id,
        defender: foe?.id, damage: dmg, move, label: "CERTIFIED!", round: m.round,
        sub: [company, tools, secs(r.metrics?.durationMs)].filter(Boolean).join(" · "), meta: { ...meta, hp: hpSnap(m) } });
    } else {
      m.hp[me.id] = (m.hp[me.id] ?? 100) - dmg;
      const label = r.failedRules?.[0] ?? r.failedChecks?.[0] ?? "RUN CRASHED";
      emit({ kind: "attack_miss", duration: DURATIONS.miss, attacker: me.id, damage: dmg, label, round: m.round,
        sub: company, meta: { ...meta, failedRules: r.failedRules ?? [], failedChecks: r.failedChecks ?? [], hp: hpSnap(m) } });
    }
  };

  /** Try to play one buffered run in the current match. Returns true if something happened. */
  const stepAttack = (m: Match): boolean => {
    const sides: ("left" | "right")[] = m.turn === "left" ? ["left", "right"] : ["right", "left"];
    for (const side of sides) {
      const who = side === "left" ? m.left : m.right;
      if (!who) continue;
      const buf = buffers.get(who.heat);
      if (!buf?.length) continue;
      const r = buf.shift()!;
      playRun(m, side, r);
      if (side === m.turn && m.right) m.turn = m.turn === "left" ? "right" : "left";
      // KO check
      const l = m.left, rt = m.right;
      if (rt) {
        const loser = (m.hp[l.id] ?? 100) <= 0 ? l : (m.hp[rt.id] ?? 100) <= 0 ? rt : null;
        if (loser) {
          const winner = loser === l ? rt : l;
          emit({ kind: "ko", duration: DURATIONS.ko, attacker: winner.id, defender: loser.id, round: m.round,
            label: "K.O.", sub: `${winner.def.name} WINS BY KNOCKOUT`, meta: { decidedBy: "ko", hp: hpSnap(m) } });
          endMatch(m, winner, loser, "ko", [loser]);
        }
      }
      return true;
    }
    return false;
  };

  const decideByJudges = (m: Match, force: boolean): boolean => {
    const l = m.left, r = m.right!;
    let winner: Entrant | null = null;
    let rationale: string | null = null;
    if (final) {
      const place = (e: Entrant) => {
        const row = final!.ranking.find((x) => x.procedureId === e.id) ?? final!.ranking.find((x) => x.heat === e.heat);
        return row ? row.place : Infinity;
      };
      const pl = place(l), pr = place(r);
      winner = pl < pr ? l : pr < pl ? r : passRateOf(r.heat) > passRateOf(l.heat) ? r : l;
      rationale = (final.ranking.find((x) => x.procedureId === winner!.id) ?? null)?.rationale ?? null;
    } else if (force) {
      const champ = done?.champion?.procedureId;
      winner = champ === r.id ? r : champ === l.id ? l : passRateOf(r.heat) > passRateOf(l.heat) ? r : l;
    } else return false;
    const loser = winner === l ? r : l;
    const scores: Record<string, number> = {};
    for (const row of final?.ranking ?? []) if (typeof row.score === "number") scores[row.procedureId] = row.score;
    announceFinal();
    emit({ kind: "judge", duration: DURATIONS.judge, attacker: winner.id, defender: loser.id, round: m.round,
      label: `JEV: ${winner.def.name} WINS`,
      sub: rationale ?? `ranked by pass rate: ${pct(passRateOf(winner.heat))} vs ${pct(passRateOf(loser.heat))}`,
      meta: { scores, judge: final?.judge ?? null,
        ranking: (final?.ranking ?? []).map((x) => ({ place: x.place, id: x.procedureId, score: x.score, rationale: x.rationale })) } });
    endMatch(m, winner, loser, "judges", [loser]);
    return true;
  };

  /** Decide a match whose runs are all played. Returns true if progress was made. */
  const decide = (m: Match, force: boolean): boolean => {
    if (m.status === "judging") return decideByJudges(m, force);
    const l = m.left, r = m.right;
    const al = advancesOf(l.heat, force);
    if (!r) {
      if (al === null) return false;
      if (al) endMatch(m, l, null, "walkover", []);
      else {
        emit({ kind: "ko", duration: DURATIONS.ko, defender: l.id, round: m.round, label: "ELIMINATED",
          sub: `pass rate ${pct(passRateOf(l.heat))} < ${pct(threshold)}`, meta: { decidedBy: "ko" } });
        endMatch(m, null, l, "ko", [l]);
      }
      return true;
    }
    const ar = advancesOf(r.heat, force);
    if (al === null || ar === null) return false;
    if (al && ar) {
      m.status = "judging";
      emit({ kind: "time_up", duration: DURATIONS.time_up, attacker: l.id, defender: r.id, round: m.round,
        label: "TIME!", sub: "JUDGES' DECISION", meta: { hp: hpSnap(m) } });
      if (finalStarted && !finalAnnounced) announceFinal();
      decideByJudges(m, force);
      return true;
    }
    if (!al && !ar) {
      for (const e of [l, r])
        emit({ kind: "ko", duration: DURATIONS.ko, defender: e.id, round: m.round, label: "DOUBLE K.O.",
          sub: `pass rate ${pct(passRateOf(e.heat))} < ${pct(threshold)}`, meta: { decidedBy: "double_ko" } });
      endMatch(m, null, null, "double_ko", [l, r]);
      return true;
    }
    const winner = al ? l : r;
    const loser = al ? r : l;
    emit({ kind: "ko", duration: DURATIONS.ko, attacker: winner.id, defender: loser.id, round: m.round, label: "ELIMINATED",
      sub: `pass rate ${pct(passRateOf(loser.heat))} < ${pct(threshold)}`, meta: { decidedBy: "ko", hp: hpSnap(m) } });
    endMatch(m, winner, loser, "ko", [loser]);
    return true;
  };

  const pump = (force: boolean) => {
    if (!started) return;
    for (let guard = 0; guard < 10000; guard++) {
      const m: Match | null = match;
      if (!m || ladderOver) break;
      if (m.status === "fighting" && stepAttack(m)) continue;
      if (m.status === "fighting") {
        const doneL = exhausted(m.left.heat, force);
        const doneR = !m.right || exhausted(m.right.heat, force);
        if (!(doneL && doneR)) break;
      }
      if (!decide(m, force)) break;
    }
  };

  const finishTournament = () => {
    if (!done || victoryOut) return;
    victoryOut = true;
    const c = done.champion;
    if (!c) {
      emit({ kind: "announce", duration: DURATIONS.victory, label: "NO TRUSTED FLOW", sub: "every flow was eliminated",
        meta: { final: true, registry: done.registry, promoted: done.promoted, record: done.record, procedure: done.procedure } });
      return;
    }
    const champ = byId(c.procedureId) ?? byHeat(c.heat);
    const def = champ?.def ?? fighterFor({ procedureId: c.procedureId, title: c.title, source: "fixture", rank: null });
    if (!ladderWinner || ladderWinner.id !== c.procedureId) {
      emit({ kind: "announce", duration: DURATIONS.announce, label: "REFEREE OVERRULES", sub: `${def.name} TAKES THE BELT`,
        meta: { ladderWinner: ladderWinner?.id ?? null, champion: c.procedureId } });
    }
    emit({ kind: "victory", duration: DURATIONS.victory, attacker: c.procedureId, label: "TRUSTED FLOW",
      sub: [`${pct(c.passRate)} pass`, typeof c.score === "number" ? `Jev ${c.score}` : null].filter(Boolean).join(" · "),
      meta: { record: done.record, procedure: done.procedure, registry: done.registry, promoted: done.promoted, champion: c, fighter: def } });
  };

  const onStarted = (e: StartedEv) => {
    if (started) return;
    started = e;
    perFlow = Math.max(1, e.perFlow ?? e.perHeat ?? 3);
    threshold = typeof e.threshold === "number" ? e.threshold : 0.5;
    dmg = Math.round(100 / (perFlow + 1));
    const heats = Array.isArray(e.heats) ? e.heats : [];
    entrants = heats.map((h) => {
      const company = h.examCompany ?? h.examCase ?? `heat ${h.heat}`;
      const flow = h.flow ?? { procedureId: `heat-${h.heat}`, title: company, source: "fixture" as const, rank: null };
      const def = fighterFor({ procedureId: flow.procedureId, title: flow.title, source: flow.source, rank: flow.rank });
      return { heat: h.heat, id: flow.procedureId, def, company };
    });
    // Two flows can derive the same arcade name (similar titles): tag repeats with their short id.
    const seenNames = new Map<string, number>();
    for (const x of entrants) {
      const n = (seenNames.get(x.def.name) ?? 0) + 1;
      seenNames.set(x.def.name, n);
      if (n > 1 || entrants.filter((y) => y.def.name === x.def.name).length > 1)
        x.def = { ...x.def, name: `${x.def.name.slice(0, 11)} ${x.def.shortId.slice(0, 4).toUpperCase()}` };
    }
    emit({ kind: "intro", duration: DURATIONS.intro, label: "SELECT YOUR FLOW",
      sub: `${entrants.length} FLOW${entrants.length === 1 ? "" : "S"} · ${perFlow} AGENT${perFlow === 1 ? "" : "S"} EACH`,
      meta: { fighters: entrants.map((x) => x.def), dry: e.dry, perFlow, threshold, judgeModel: e.judgeModel,
        tournamentId: e.tournamentId, rejected: e.rejected ?? [] } });
    // drop buffered runs that arrived early for heats not in this tournament? keep them; they are simply never played.
    for (const x of entrants) if (eliminated.has(x.heat)) buffers.set(x.heat, []);
    if (!entrants.length) { ladderOver = true; return; }
    if (entrants.length === 1)
      emit({ kind: "announce", duration: DURATIONS.announce, label: "EXHIBITION", sub: `${entrants[0].def.name} FIGHTS THE CLOCK` });
    nextMatch(null);
  };

  const onRun = (e: RunEv) => {
    const key = `${e.heat}:${e.i}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (eliminated.has(e.heat)) return;
    const buf = buffers.get(e.heat) ?? [];
    buf.push(e);
    buffers.set(e.heat, buf);
    if (e.certified) {
      const k = knownCertDur.get(e.heat) ?? [];
      k.push(durOf(e));
      knownCertDur.set(e.heat, k);
    }
  };

  const handle = (e: ArenaEvent) => {
    switch (e.type) {
      case "tournament.started": onStarted(e); break;
      case "student.finished": onRun(e); break;
      case "heat.finished": if (!heatDone.has(e.heat)) heatDone.set(e.heat, e); break;
      case "final.started":
        if (!finalStarted) {
          finalStarted = e;
          if (match?.status === "judging" || ladderOver) announceFinal();
        }
        break;
      case "final.finished": if (!final) final = e; break;
      case "tournament.finished":
        if (!done) done = e;
        break;
      case "error":
        emit({ kind: "error", duration: DURATIONS.error, label: e.message || "error", meta: { at: e.at } });
        break;
      default: break;
    }
  };

  const take = () => { const a = out; out = []; return a; };

  return {
    push(e: ArenaEvent): FightAction[] {
      try {
        if (!e || typeof e !== "object") return take();
        handle(e);
        pump(false);
        if (done && !victoryOut && started) { pump(true); finishTournament(); }
      } catch {
        /* never throw on a malformed event */
      }
      return take();
    },
    flush(): FightAction[] {
      try {
        pump(true);
        if (done && started) finishTournament();
      } catch {
        /* ignore */
      }
      return take();
    },
  };
}
