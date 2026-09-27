// FLOW FIGHTER prompt parser: free text -> BattleSpec (options go straight to runArena).
//
// parsePrompt is pure and browser-safe (no node imports). parsePromptSmart adds an optional
// Jev (OpenRouter) fallback for prompts the rules could not read at all; it is server-only at
// call time (node modules are loaded lazily with webpackIgnore so client bundles stay clean).

import type { ArenaOptions, BattleSpec } from "./types.ts";

/** Mirrors the exam cases in demo/cases.json (kept inline so this module stays browser-safe). */
const EXAM_CASES: { id: string; company: string; fixtureOnly?: boolean; aliases: string[] }[] = [
  { id: "exam-vercel", company: "Vercel", aliases: ["vercel"] },
  { id: "exam-stripe", company: "Stripe", aliases: ["stripe"] },
  { id: "exam-supabase", company: "Supabase", aliases: ["supabase"] },
  { id: "exam-northwind", company: "Northwind Labs", fixtureOnly: true, aliases: ["northwind labs", "northwind"] },
];
const DEFAULT_CASES = ["Vercel", "Stripe", "Supabase"];
const JEV_MODEL = "typesafe/jev-router";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, single: 1, pair: 2, couple: 2 };
const NUM = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|single)";
const toNum = (s: string) => (/^\d+$/.test(s) ? parseInt(s, 10) : WORDS[s.toLowerCase()] ?? NaN);
const clamp = (n: number) => Math.min(Math.max(Math.round(n), 1), 5);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Raw {
  mode: "dry" | "live" | null;
  flows: number | null;
  perFlow: number | null;
  cases: string[]; // company names, in order of appearance
  procedures: string[];
  pace: "fast" | "slow" | null;
}

function scan(prompt: string): Raw & { recognized: boolean } {
  const t = prompt.toLowerCase();
  const raw: Raw = { mode: null, flows: null, perFlow: null, cases: [], procedures: [], pace: null };

  // mode: dry words win over live words only when no live word is present
  if (/\b(live|real|qm)\b/.test(t)) raw.mode = "live";
  else if (/\b(dry|sim|simulated|simulation|demo|fake|mock)\b/.test(t)) raw.mode = "dry";

  // flows / fighters
  const flowM = new RegExp(`\\b${NUM}\\s*(?:-|\\s)?(?:memorable\\s+)?(flows?|fighters?|heats?|contenders?|competitors?|procedures?|players?)\\b`, "i").exec(t);
  if (flowM) raw.flows = toNum(flowM[1]);

  // agents per flow
  const agentM = new RegExp(`\\b${NUM}\\s*(?:-|\\s)?(agents?|students?|runs?|attempts?|runners?|bots?)\\b`, "i").exec(t)
    ?? /(?:^|\s)[x×]\s*(\d+)\b/i.exec(t)
    ?? /\b(\d+)\s*[x×](?:\s|$)/i.exec(t);
  if (agentM) raw.perFlow = toNum(agentM[1]);

  // explicit procedure ids
  for (const m of prompt.matchAll(/\bprocedures\/[A-Za-z0-9_\-.:/]+/g)) {
    const id = m[0].replace(/[.,;:)]+$/, "");
    if (!raw.procedures.includes(id)) raw.procedures.push(id);
  }

  // companies (ordered by first mention)
  const hits: { at: number; company: string }[] = [];
  for (const c of EXAM_CASES) {
    let best = -1;
    for (const a of [...c.aliases, c.id]) {
      const m = new RegExp(`\\b${escapeRe(a)}\\b`, "i").exec(t);
      if (m && (best < 0 || m.index < best)) best = m.index;
    }
    if (best >= 0) hits.push({ at: best, company: c.company });
  }
  raw.cases = hits.sort((a, b) => a.at - b.at).map((h) => h.company);

  if (/\b(quick|quickly|fast|faster|speedy|rapid|turbo)\b/.test(t)) raw.pace = "fast";
  else if (/\b(slow|slowly|dramatic|cinematic|epic)\b/.test(t)) raw.pace = "slow";

  const recognized = raw.mode !== null || raw.flows !== null || raw.perFlow !== null || raw.cases.length > 0 || raw.procedures.length > 0;
  return { ...raw, recognized };
}

/** Validates/clamps raw values into a BattleSpec. Shared by the rules and the Jev path. */
function build(prompt: string, raw: Raw, parser: BattleSpec["parser"], extraNotes: string[] = []): BattleSpec {
  const notes: string[] = [...extraNotes];
  const mode = raw.mode ?? "dry";
  notes.push(raw.mode ? `mode: ${mode}` : "mode: dry (no 'live' / 'real' / 'qm' in prompt)");

  let flows = 3;
  if (raw.flows !== null && Number.isFinite(raw.flows)) {
    flows = clamp(raw.flows);
    notes.push(flows !== raw.flows ? `flows: ${raw.flows} clamped to ${flows} (1-5)` : `flows: ${flows}`);
  } else notes.push("flows: 3 (default)");

  let perFlow = 3;
  if (raw.perFlow !== null && Number.isFinite(raw.perFlow)) {
    perFlow = clamp(raw.perFlow);
    notes.push(perFlow !== raw.perFlow ? `agents per flow: ${raw.perFlow} clamped to ${perFlow} (1-5)` : `agents per flow: ${perFlow}`);
  } else notes.push("agents per flow: 3 (default)");

  const cases: string[] = [];
  for (const name of raw.cases) {
    const c = EXAM_CASES.find((x) => x.company.toLowerCase() === name.toLowerCase() || x.id === name.toLowerCase());
    if (!c) { notes.push(`case '${name}' ignored (not an exam case)`); continue; }
    if (c.fixtureOnly && mode !== "dry") { notes.push(`case ${c.company} ignored (fixture-only, dry runs only)`); continue; }
    if (!cases.includes(c.company)) cases.push(c.company);
  }
  if (cases.length > 5) { notes.push("cases: capped at 5"); cases.length = 5; }
  notes.push(cases.length ? `cases: ${cases.join(", ")}` : `cases: ${DEFAULT_CASES.join(", ")} (default)`);

  const options: ArenaOptions = { mode, flows, perFlow };
  if (cases.length) options.cases = cases;

  const procedures = raw.procedures.slice(0, 5);
  if (procedures.length) {
    options.procedures = procedures;
    notes.push(`procedures: ${procedures.join(", ")}${raw.procedures.length > 5 ? " (capped at 5)" : ""}`);
  }

  if (raw.pace) {
    if (mode === "dry") {
      options.paceMs = raw.pace === "fast" ? 800 : 2500;
      notes.push(`pace: ${raw.pace} (${options.paceMs}ms per simulated minute)`);
    } else notes.push(`pace '${raw.pace}' ignored (live runs go at real speed)`);
  }

  const shown = (cases.length ? cases : DEFAULT_CASES).map((c) => c.toUpperCase()).join(" / ");
  const title = [
    `${flows} FLOW${flows === 1 ? "" : "S"}`,
    `${perFlow} AGENT${perFlow === 1 ? "" : "S"}`,
    shown,
    mode === "live" ? "LIVE" : "DRY RUN",
  ].join(" · ");

  return { prompt, options, title, notes, parser };
}

export function parsePrompt(prompt: string): BattleSpec {
  const text = String(prompt ?? "").trim();
  return build(text, scan(text), "rules");
}

async function openrouterKey(): Promise<string | null> {
  const env = typeof process !== "undefined" ? process.env?.OPENROUTER_API_KEY?.trim() : undefined;
  if (env) return env;
  if (typeof window !== "undefined") return null;
  try {
    const fs: typeof import("node:fs") = await import(/* webpackIgnore: true */ "node:fs");
    const path: typeof import("node:path") = await import(/* webpackIgnore: true */ "node:path");
    const text = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
    const m = /^OPENROUTER_API_KEY=(.*)$/m.exec(text);
    return m ? m[1].trim().replace(/^['"]|['"]$/g, "") || null : null;
  } catch {
    return null;
  }
}

async function askJev(prompt: string, key: string): Promise<Raw | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: ctl.signal,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: JEV_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You configure a tournament between AI agent workflows ('flows'). Read the user's request and reply with ONLY a JSON object: " +
              '{"mode": "dry" | "live", "flows": integer 1-5, "perFlow": integer 1-5, "cases": string[]}. ' +
              "mode is live only if the user clearly wants real/live agents, else dry. flows = number of competing flows/fighters. " +
              "perFlow = agents/students per flow. cases = company names to research, chosen only from: Vercel, Stripe, Supabase. " +
              "Use null for anything the user did not express.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return null;
    const j = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? parseInt(v, 10) : null);
    return {
      mode: j.mode === "live" ? "live" : j.mode === "dry" ? "dry" : null,
      flows: n(j.flows),
      perFlow: n(j.perFlow),
      cases: Array.isArray(j.cases) ? j.cases.filter((c): c is string => typeof c === "string").slice(0, 5) : [],
      procedures: [],
      pace: null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Rules first; Jev only when the rules recognized nothing and an OpenRouter key exists. Never throws. */
export async function parsePromptSmart(prompt: string): Promise<BattleSpec> {
  const text = String(prompt ?? "").trim();
  const raw = scan(text);
  const rules = build(text, raw, "rules");
  if (raw.recognized || !text) return rules;
  try {
    const key = await openrouterKey();
    if (!key) return rules;
    const jev = await askJev(text, key);
    if (!jev) return { ...rules, notes: [...rules.notes, "jev: no usable answer, used rules defaults"] };
    // keep pace words from the rules scan; Jev only fills mode/flows/perFlow/cases
    // Safety: the rules found no live/real/qm word, so Jev may never escalate to a live run.
    const notes = [`interpreted by Jev (${JEV_MODEL})`];
    if (jev.mode === "live") notes.push("jev suggested live; kept dry (say 'live' explicitly to run real agents)");
    return build(text, { ...jev, mode: "dry", pace: raw.pace }, "jev", notes);
  } catch {
    return rules;
  }
}
