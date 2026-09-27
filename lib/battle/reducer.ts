// FLOW FIGHTER reducer: FightAction -> BattleState. Pure, immutable updates.
import type { Banner, BattleMatch, BattleSpec, BattleState, FightAction, FighterDef, FighterState, Pose } from "./types.ts";

export const initialBattleState: BattleState = {
  phase: "idle",
  spec: null,
  jobId: null,
  fighters: {},
  order: [],
  matches: [],
  current: null,
  action: null,
  banner: null,
  referee: null,
  champion: null,
  championRecord: null,
  procedure: null,
  registry: null,
  feed: [],
  dry: true,
  error: null,
};

const FEED_CAP = 50;

function freshFighter(def: FighterDef): FighterState {
  return {
    def, hp: 100, pose: "idle", side: null, runs: 0, certified: 0, failed: 0, combo: 0,
    eliminated: false, score: null, rationale: null, lastRule: null,
  };
}

function name(s: BattleState, id: string | undefined): string {
  if (!id) return "???";
  return s.fighters[id]?.def.name ?? id.slice(0, 8).toUpperCase();
}

function patch(s: BattleState, id: string | undefined, p: Partial<FighterState>): BattleState {
  if (!id) return s;
  const f = s.fighters[id];
  if (!f) return s;
  return { ...s, fighters: { ...s.fighters, [id]: { ...f, ...p } } };
}

function feed(s: BattleState, a: FightAction, text: string, tone: Banner["tone"]): BattleState {
  const next = [...s.feed, { seq: a.seq, text, tone }];
  return { ...s, feed: next.length > FEED_CAP ? next.slice(next.length - FEED_CAP) : next };
}

function banner(text: string, tone: Banner["tone"], sub?: string): Banner {
  return sub ? { text, sub, tone } : { text, tone };
}

function metaObj(a: FightAction): Record<string, unknown> {
  return a.meta ?? {};
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function clampHp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

/** Merge judge scores/rationales from meta into fighters. Accepts {scores:{id:n}}, {rationales:{id:s}}. */
function applyScores(s: BattleState, a: FightAction): BattleState {
  const m = metaObj(a);
  let out = s;
  const scores = m.scores;
  if (scores && typeof scores === "object") {
    for (const [id, v] of Object.entries(scores as Record<string, unknown>)) {
      if (typeof v === "number" && out.fighters[id]) out = patch(out, id, { score: v });
    }
  }
  const rats = m.rationales;
  if (rats && typeof rats === "object") {
    for (const [id, v] of Object.entries(rats as Record<string, unknown>)) {
      if (typeof v === "string" && out.fighters[id]) out = patch(out, id, { rationale: v });
    }
  }
  return out;
}

/** Apply common top-level meta that any action may carry (spec, jobId, dry, referee). */
function applyCommonMeta(s: BattleState, a: FightAction): BattleState {
  const m = a.meta;
  if (!m) return s;
  let out = s;
  if (m.spec && typeof m.spec === "object") out = { ...out, spec: m.spec as BattleSpec };
  if (typeof m.jobId === "string") out = { ...out, jobId: m.jobId };
  if (typeof m.dry === "boolean") out = { ...out, dry: m.dry };
  const model = str(m.model) ?? str(m.refereeModel);
  const status = str(m.status) ?? str(m.refereeStatus);
  if (model || status) {
    const r = out.referee ?? { model: null, status: null, line: null };
    out = { ...out, referee: { model: model ?? r.model, status: status ?? r.status, line: r.line } };
  }
  return out;
}

function upsertMatch(matches: BattleMatch[], m: BattleMatch): BattleMatch[] {
  const i = matches.findIndex((x) => x.round === m.round && x.left === m.left && x.right === m.right);
  if (i < 0) return [...matches, m];
  const next = matches.slice();
  next[i] = m;
  return next;
}

export function reduce(state: BattleState, action: FightAction): BattleState {
  let s: BattleState = applyCommonMeta({ ...state, action }, action);
  const a = action;
  const atk = a.attacker;
  const def = a.defender;

  switch (a.kind) {
    case "intro": {
      const defs = Array.isArray(a.meta?.fighters) ? (a.meta!.fighters as FighterDef[]) : [];
      const fighters: Record<string, FighterState> = {};
      const order: string[] = [];
      for (const d of defs) {
        if (!d || typeof d.id !== "string" || fighters[d.id]) continue;
        fighters[d.id] = freshFighter(d);
        order.push(d.id);
      }
      s = {
        ...s, phase: "select", fighters, order, matches: [], current: null, champion: null,
        championRecord: null, procedure: null, registry: null, error: null,
        banner: banner(a.label ?? "SELECT YOUR FLOW", "neutral", a.sub ?? `${order.length} FIGHTERS ENTER`),
      };
      return feed(s, a, `${order.length} flows enter the arena: ${order.map((id) => name(s, id)).join(", ")}`, "neutral");
    }

    case "match_start": {
      const round = a.round ?? s.matches.length + 1;
      const current: BattleMatch = { round, left: atk ?? "", right: def ?? "", winner: null, decidedBy: null };
      const fighters: Record<string, FighterState> = {};
      for (const [id, f] of Object.entries(s.fighters)) {
        if (id === atk) fighters[id] = { ...f, hp: 100, pose: "walk", side: "left", combo: 0 };
        else if (id === def) fighters[id] = { ...f, hp: 100, pose: "walk", side: "right", combo: 0 };
        else fighters[id] = f.side ? { ...f, side: null, pose: "idle" } : f;
      }
      const sub = `${name(s, atk)} VS ${name(s, def)}`;
      s = {
        ...s, phase: "fighting", fighters, current, matches: upsertMatch(s.matches, current),
        banner: banner(a.label ?? `ROUND ${round}`, "neutral", a.sub ?? sub),
      };
      return feed(s, a, `ROUND ${round}: ${sub}`, "neutral");
    }

    case "attack_hit": {
      const dmg = a.damage ?? 0;
      const move: Pose = a.move ?? "punch";
      const A = atk ? s.fighters[atk] : undefined;
      const D = def ? s.fighters[def] : undefined;
      if (A) s = patch(s, atk, { pose: move, runs: A.runs + 1, certified: A.certified + 1, combo: A.combo + 1 });
      if (D) s = patch(s, def, { pose: "hurt", hp: clampHp(D.hp - dmg) });
      const label = a.label ?? (move === "special" ? "SPECIAL!" : "CERTIFIED!");
      s = { ...s, banner: banner(label, "hit", a.sub) };
      const combo = A ? A.combo + 1 : 1;
      return feed(s, a, `${name(s, atk)} lands a ${move}${dmg ? ` (-${dmg})` : ""} on ${name(s, def)}${combo > 1 ? ` · ${combo} HIT COMBO` : ""}${a.sub ? ` · ${a.sub}` : ""}`, "hit");
    }

    case "attack_miss": {
      const dmg = a.damage ?? 0;
      const A = atk ? s.fighters[atk] : undefined;
      const rule = a.label ?? null;
      if (A) s = patch(s, atk, { pose: "stumble", hp: clampHp(A.hp - dmg), runs: A.runs + 1, failed: A.failed + 1, combo: 0, lastRule: rule ?? A.lastRule });
      s = { ...s, banner: banner(rule ?? "MISS!", "miss", a.sub) };
      return feed(s, a, `${name(s, atk)} whiffs${rule ? `: ${rule}` : ""}${dmg ? ` (-${dmg})` : ""}`, "miss");
    }

    case "time_up": {
      s = { ...s, phase: "judging", banner: banner(a.label ?? "TIME!", "judge", a.sub ?? "JUDGES' DECISION") };
      return feed(s, a, "TIME! The judges will decide.", "judge");
    }

    case "judge": {
      s = applyScores(s, a);
      const line = a.label ?? null;
      const r = s.referee ?? { model: null, status: null, line: null };
      s = { ...s, referee: { ...r, line: line ?? r.line }, banner: banner(line ?? "JUDGES' DECISION", "judge", a.sub) };
      return feed(s, a, `JEV: ${line ?? "the judges confer"}${a.sub ? ` · ${a.sub}` : ""}`, "judge");
    }

    case "ko": {
      const eliminated = a.label === "ELIMINATED" || a.meta?.eliminated === true;
      const D = def ? s.fighters[def] : undefined;
      if (D) s = patch(s, def, { pose: "ko", hp: eliminated ? 0 : D.hp, eliminated: D.eliminated || eliminated });
      if (atk && s.fighters[atk]) s = patch(s, atk, { pose: "victory" });
      s = { ...s, banner: banner(a.label ?? "K.O.", "ko", a.sub ?? (atk ? `${name(s, atk)} WINS` : undefined)) };
      return feed(s, a, `K.O.! ${name(s, def)} goes down${atk ? `, ${name(s, atk)} wins` : ""}`, "ko");
    }

    case "match_end": {
      const winner = atk ?? null;
      const loser = def ?? (s.current && winner ? (s.current.left === winner ? s.current.right : s.current.left) : undefined);
      if (winner && s.fighters[winner]) s = patch(s, winner, { pose: "taunt" });
      if (loser && s.fighters[loser]) s = patch(s, loser, { side: null });
      // choreo lists the flows knocked out of the tournament in meta.eliminated (string[])
      const gone = a.meta?.eliminated;
      if (Array.isArray(gone))
        for (const id of gone)
          if (typeof id === "string" && s.fighters[id] && id !== winner) s = patch(s, id, { eliminated: true, hp: 0, side: null });
      const rawDecided = a.meta?.decidedBy;
      const decidedBy: BattleMatch["decidedBy"] =
        rawDecided === "ko" || rawDecided === "judges" || rawDecided === "walkover" ? rawDecided : s.phase === "judging" ? "judges" : "ko";
      if (s.current) {
        const done: BattleMatch = { ...s.current, winner, decidedBy };
        s = { ...s, current: done, matches: upsertMatch(s.matches, done) };
      }
      s = { ...s, phase: s.phase === "judging" ? "fighting" : s.phase };
      if (a.label) s = { ...s, banner: banner(a.label, "win", a.sub) };
      return feed(s, a, `${name(s, winner ?? undefined)} advances${decidedBy === "judges" ? " by judges' decision" : ""}`, "win");
    }

    case "victory": {
      const m = metaObj(a);
      s = applyScores(s, a);
      const champ = atk ?? null;
      if (champ && s.fighters[champ]) s = patch(s, champ, { pose: "victory", side: "left", eliminated: false });
      s = {
        ...s, phase: "victory", champion: champ,
        championRecord: m.record ?? m.championRecord ?? s.championRecord,
        procedure: m.procedure ?? s.procedure,
        registry: str(m.registry) ?? s.registry,
        banner: banner(a.label ?? "TRUSTED FLOW", "win", a.sub ?? (champ ? name(s, champ) : undefined)),
      };
      return feed(s, a, `${name(s, champ ?? undefined)} is the TRUSTED FLOW`, "win");
    }

    case "announce": {
      const text = a.label ?? "";
      const tone: Banner["tone"] = text === "ELIMINATED" ? "ko" : "neutral";
      if (text === "ELIMINATED" && def && s.fighters[def]) s = patch(s, def, { eliminated: true, side: null });
      s = { ...s, banner: text ? banner(text, tone, a.sub) : s.banner };
      return text || a.sub ? feed(s, a, [text, a.sub].filter(Boolean).join(" · "), tone) : s;
    }

    case "error": {
      const msg = a.label ?? a.sub ?? "error";
      s = { ...s, phase: "error", error: a.sub ?? msg, banner: banner(a.label ?? "ERROR", "error", a.sub) };
      return feed(s, a, `ERROR: ${msg}`, "error");
    }

    default:
      return s;
  }
}

/** Fold a list of actions from the initial state (for tests). */
export function reduceAll(actions: FightAction[], from: BattleState = initialBattleState): BattleState {
  let s = from;
  for (const a of actions) s = reduce(s, a);
  return s;
}
