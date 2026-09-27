// FLOW FIGHTER — flows as fighters. Pure and deterministic from procedureId (FNV-1a 32-bit seed).
import type { FighterDef, FighterStyle, Palette } from "./types.ts";

type FlowIn = { procedureId: string; title: string; source: FighterDef["source"]; rank: number | null };

/** FNV-1a 32-bit hash, unsigned. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Derive an independent sub-seed (so style/palette/name picks are not correlated). */
function mix(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function pick<T>(list: readonly T[], seed: number, salt: number): T {
  return list[mix(seed, salt) % list.length];
}

// ------------------------------------------------------------------ styles

export const STYLES: readonly FighterStyle[] = ["karate", "boxer", "ninja", "sumo", "monk", "robot"];

// ------------------------------------------------------------------ palettes (hand-curated, neon-on-night friendly)

export const PALETTES: readonly Palette[] = [
  // 0 CRIMSON DRAGON — red gi, gold trim, hot pink aura
  { skin: "#f1c29a", hair: "#1b1022", gi: "#d7263d", trim: "#ffd23f", accent: "#ffffff", aura: "#ff3d7f" },
  // 1 ICE BLADE — deep blue gi, cyan accents
  { skin: "#e8b48c", hair: "#e9f6ff", gi: "#1f3fbf", trim: "#2de2ff", accent: "#9af3ff", aura: "#2de2ff" },
  // 2 JADE MONK — green robes, saffron trim
  { skin: "#c98e62", hair: "#2a1a0f", gi: "#1f9e6e", trim: "#ffb238", accent: "#3ddc97", aura: "#3ddc97" },
  // 3 SOLAR — orange gi, black belt, gold aura
  { skin: "#f5d0a9", hair: "#8a2b0e", gi: "#ff7a1a", trim: "#161018", accent: "#ffd23f", aura: "#ffd23f" },
  // 4 VIOLET SHADOW — purple ninja, magenta accents
  { skin: "#d9a57b", hair: "#0d0a16", gi: "#4b1f8f", trim: "#c03cff", accent: "#ff3d7f", aura: "#b36bff" },
  // 5 CHROME — steel robot, cyan visor
  { skin: "#b9c4d6", hair: "#3a4458", gi: "#5b6b86", trim: "#e3ecf7", accent: "#2de2ff", aura: "#7df9ff" },
  // 6 SAKURA — white gi, pink trim
  { skin: "#f7d7bd", hair: "#ff8fc0", gi: "#f4eef8", trim: "#ff3d7f", accent: "#ff8fc0", aura: "#ff6fb0" },
  // 7 THUNDER — black gi, electric yellow
  { skin: "#a8693f", hair: "#f7f2e8", gi: "#16141f", trim: "#ffe13f", accent: "#ffe13f", aura: "#fff27a" },
  // 8 TIDE — teal gi, coral accents
  { skin: "#8c5a3c", hair: "#101418", gi: "#0f8b8d", trim: "#ff6b57", accent: "#ffcf9e", aura: "#4ff0d8" },
  // 9 EMBER — maroon gi, flame accents
  { skin: "#e0a77f", hair: "#ff5a1f", gi: "#6e1a2d", trim: "#ff9f1c", accent: "#ff5a5a", aura: "#ff7b3d" },
];

/** Palette index for a seed; `avoid` (an index) is skipped when given, so opponents never match. */
export function paletteIndexFor(seed: number, avoid?: number): number {
  let i = mix(seed, 2) % PALETTES.length;
  if (avoid !== undefined && i === avoid) i = (i + 1 + (mix(seed, 3) % (PALETTES.length - 1))) % PALETTES.length;
  return i;
}

export function paletteFor(seed: number, avoid?: number): Palette {
  return PALETTES[paletteIndexFor(seed, avoid)];
}

/** Index of a def's palette in PALETTES (-1 if custom). */
export function paletteIndexOf(def: FighterDef): number {
  return PALETTES.indexOf(def.palette);
}

/** Returns `def` recoloured if it shares a palette with `opponent` (use when placing two fighters on stage). */
export function avoidPaletteClash(def: FighterDef, opponent: FighterDef | null | undefined): FighterDef {
  if (!opponent) return def;
  const theirs = paletteIndexOf(opponent);
  if (theirs < 0 || paletteIndexOf(def) !== theirs) return def;
  return { ...def, palette: paletteFor(def.seed, theirs) };
}

/** Assign palettes across a roster so they are distinct where possible (<= PALETTES.length fighters). */
export function distinctRoster(defs: FighterDef[]): FighterDef[] {
  const used: number[] = [];
  return defs.map((d) => {
    let i = paletteIndexFor(d.seed);
    if (used.length < PALETTES.length) {
      let tries = 0;
      while (used.indexOf(i) >= 0 && tries < PALETTES.length) {
        i = (i + 1) % PALETTES.length;
        tries++;
      }
    }
    used.push(i);
    return PALETTES[i] === d.palette ? d : { ...d, palette: PALETTES[i] };
  });
}

// ------------------------------------------------------------------ names

const STOP = new Set(
  "a an the to of for and or in on at by with from into about via as is are be it its this that your my our their new all any each every file files json md txt using use step steps quickly exhaustively fast".split(
    " ",
  ),
);

/** Verb → role noun ("research a company" → "... SCOUT"). */
const ROLES: Record<string, string> = {
  research: "SCOUT", find: "SEEKER", search: "SEEKER", look: "SEEKER", discover: "SEEKER",
  add: "HUNTER", collect: "HUNTER", gather: "HUNTER", fetch: "HUNTER", get: "HUNTER", pull: "HUNTER",
  scrape: "REAPER", crawl: "CRAWLER", extract: "REAPER", mine: "MINER",
  write: "SCRIBE", draft: "SCRIBE", summarize: "SAGE", summarise: "SAGE", report: "HERALD",
  verify: "JUDGE", validate: "WARDEN", check: "WARDEN", audit: "AUDITOR", review: "CRITIC", test: "TESTER",
  build: "SMITH", create: "SMITH", make: "SMITH", generate: "FORGE", deploy: "LAUNCHER", ship: "LAUNCHER",
  fix: "MENDER", repair: "MENDER", clean: "SWEEPER", compare: "DUELIST", analyze: "ORACLE", analyse: "ORACLE",
  monitor: "SENTRY", track: "TRACKER", watch: "SENTRY", update: "SHIFTER", sync: "LINKER", enrich: "ALCHEMIST",
  map: "CARTOGRAPHER", plan: "TACTICIAN", rank: "RANKER", sort: "SORTER", send: "COURIER", email: "COURIER",
};

/** Subject words that make better names than generic nouns like "company". */
const POWER = new Set(
  "data price prices pricing news code lead leads market funding revenue docs api stock deal deals intel profile product people contact contacts talent source sources fact facts".split(
    " ",
  ),
);

const EPITHETS = [
  "IRON", "SWIFT", "SHADOW", "NEON", "THUNDER", "CRIMSON", "SILENT", "COSMIC", "STEEL", "TURBO",
  "MIGHTY", "PHANTOM", "BLAZE", "ROGUE", "ATOMIC", "HYPER", "GOLDEN", "STORM",
] as const;

const FIXTURE_NAMES: Record<string, string> = {
  solid: "SOLID", sloppy: "SLOPPY", slow: "SLOWPOKE", exhaustive: "EXHAUSTIVE", fast: "SPEEDY", quick: "QUICKSILVER",
};

function words(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0);
}

function fit(name: string, max = 16): string {
  const n = name.replace(/\s+/g, " ").trim();
  if (n.length <= max) return n;
  // drop trailing words first, then hard-truncate
  const parts = n.split(" ");
  while (parts.length > 1 && parts.join(" ").length > max) parts.pop();
  return parts.join(" ").slice(0, max);
}

/** Punchy uppercase arcade name, <= 16 chars, deterministic. */
export function nameFor(title: string, seed: number): string {
  // fixtures: "(fixture, solid)" → "SOLID"
  const fx = /\(\s*fixture\s*,\s*([a-z]+)\s*\)/i.exec(title);
  if (fx) {
    const tag = fx[1].toLowerCase();
    return fit(FIXTURE_NAMES[tag] || tag.toUpperCase());
  }
  const ws = words(title);
  let role: string | null = null;
  for (const w of ws) {
    if (ROLES[w]) {
      role = ROLES[w];
      break;
    }
  }
  const nouns = ws.filter((w) => !STOP.has(w) && !ROLES[w] && w.length > 2 && !/^\d+$/.test(w));
  let subject = "";
  for (const w of nouns) if (POWER.has(w)) { subject = w; break; }
  if (!subject && nouns.length > 0) subject = nouns[0];
  subject = subject.toUpperCase();
  const epithet = pick(EPITHETS, seed, 5);

  let name: string;
  if (subject && role) name = `${subject} ${role}`;
  else if (role) name = `${epithet} ${role}`;
  else if (subject) name = `${epithet} ${subject}`;
  else name = `${epithet} ${pick(["FIST", "FLOW", "BLADE", "SPIRIT"], seed, 6)}`;
  if (name.length > 16 && subject && role) name = subject.length + 1 + role.length <= 16 ? name : `${epithet} ${role}`;
  return fit(name);
}

// ------------------------------------------------------------------ catchphrases

export const CATCHPHRASES = [
  "Two sources or bust.",
  "I verify, therefore I am.",
  "Cite it or it didn't happen.",
  "Your JSON is invalid. Mine never is.",
  "Every URL I fetch, I keep.",
  "I read the docs. All of them.",
  "Trust, but validate.",
  "No hallucinations in this dojo.",
  "My schema is my shield.",
  "Fetched. Parsed. Certified.",
  "The footnotes fear me.",
  "One curl to rule them all.",
  "I fight with primary sources.",
  "Speed is nothing without proof.",
  "Evidence is my martial art.",
  "Check the file. Then check it again.",
  "A claim without a link is a whiff.",
  "I don't guess. I grep.",
  "Deterministic. Relentless. Correct.",
  "My exit code is always zero.",
];

// ------------------------------------------------------------------ main

export function shortIdFor(procedureId: string): string {
  const m = /procedures\/([0-9a-f]{1,8})/i.exec(procedureId);
  if (m) return m[1].toLowerCase();
  const hex = procedureId.replace(/^procedures\//, "").replace(/[^0-9a-f]/gi, "");
  return (hex || fnv1a(procedureId).toString(16).padStart(8, "0")).slice(0, 8).toLowerCase();
}

export function fighterFor(flow: FlowIn): FighterDef {
  const seed = fnv1a(flow.procedureId);
  return {
    id: flow.procedureId,
    name: nameFor(flow.title, seed),
    title: flow.title,
    shortId: shortIdFor(flow.procedureId),
    source: flow.source,
    rank: flow.rank,
    style: pick(STYLES, seed, 1),
    palette: paletteFor(seed),
    seed,
    catchphrase: pick(CATCHPHRASES, seed, 4),
  };
}

/** Demo roster: the three fixture flows in demo/fixtures/flows/*.md (palettes made distinct). */
export function fixtureFighters(): FighterDef[] {
  return distinctRoster([
    fighterFor({ procedureId: "procedures/0000aaaa-research-a-company-fixture", title: "Research a company (fixture, solid)", source: "fixture", rank: null }),
    fighterFor({ procedureId: "procedures/0000bbbb-research-a-company-quick-fixture", title: "Research a company quickly (fixture, sloppy)", source: "fixture", rank: null }),
    fighterFor({ procedureId: "procedures/0000cccc-research-a-company-exhaustive-fixture", title: "Research a company exhaustively (fixture, slow)", source: "fixture", rank: null }),
  ]);
}
