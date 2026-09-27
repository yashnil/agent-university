// Memorable adapter: native `memorable recall` / `memorable show`, and the leak check that
// keeps the teacher's answer out of any prompt. Ported from scripts/memorable_capture.py.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "./qm.ts";

// Capitalized words that carry no company-specific answer.
const GENERIC = new Set(["It", "The", "A", "An", "In", "Its", "With", "And", "For", "Inc"]);

/** The CLI: $MEMORABLE_BIN, else ~/.memorable/bin/memorable, else `memorable` on PATH, else `npx memorable-cli`. */
export function memorableCommand(): [string, string[]] {
  if (process.env.MEMORABLE_BIN) return [process.env.MEMORABLE_BIN, []];
  const local = join(homedir(), ".memorable", "bin", "memorable");
  if (existsSync(local)) return [local, []];
  if ((process.env.PATH ?? "").split(":").some((d) => d && existsSync(join(d, "memorable")))) return ["memorable", []];
  return ["npx", ["--yes", "memorable-cli"]];
}

export async function memorable(...args: string[]): Promise<{ code: number; output: string }> {
  const [cmd, pre] = memorableCommand();
  const r = await run(cmd, [...pre, ...args], { timeoutMs: 300_000 });
  return { code: r.code, output: (r.stdout + r.stderr).trim() };
}

/** Native recall for a task: the top procedure id and the raw recall output. */
export async function recall(task: string): Promise<{ procedureId: string; output: string }> {
  const { output } = await memorable("recall", "--single", task);
  const m = /procedures\/\S+/.exec(output);
  if (!m) throw new Error(`memorable recall found no procedure:\n${output}`);
  return { procedureId: m[0], output };
}

/** Native recall WITHOUT --single: up to k distinct procedure ids in Memorable's rank order. */
export async function recallMany(task: string, k: number): Promise<{ procedureIds: string[]; output: string }> {
  const { output } = await memorable("recall", task);
  const ids: string[] = [];
  for (const m of output.matchAll(/procedures\/[A-Za-z0-9._-]+/g)) {
    const id = m[0].replace(/[.]+$/, "");
    if (!ids.includes(id)) ids.push(id);
    if (ids.length >= k) break;
  }
  if (!ids.length) throw new Error(`memorable recall found no procedure:\n${output}`);
  return { procedureIds: ids, output };
}

/** A flow's display title: its first Markdown heading, else the slug without its hash prefix. */
export function flowTitle(procedureId: string, text: string): string {
  // Memorable keeps a different way to do the same task as a revision (`--r2`) with the same
  // heading; name the revision so two flows never share a title.
  const rev = /--(r\d+)$/.exec(procedureId)?.[1];
  const h = /^\s*#+\s+(.+?)\s*$/m.exec(text);
  // Memorable's rendering prefixes the task: "A previous session solved a near-identical task: <title>".
  const heading = h?.[1].replace(/^A previous session solved (?:a|an) [^:]*task:\s*/i, "");
  if (heading) return rev ? `${heading} (${rev})` : heading;
  const slug = procedureId.replace(/^procedures\//, "").replace(/^[0-9a-f]{6,}-/, "");
  return slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Native show: the rendered procedure, which is the only procedural knowledge a student gets. */
export async function show(procedureId: string): Promise<string> {
  const { code, output } = await memorable("show", procedureId);
  if (code !== 0) throw new Error(`memorable show ${procedureId} failed:\n${output}`);
  return output;
}

export interface CompanyArtifact { company_name: string; website: string; product_summary: string; source_urls: string[] }

/** Everything in the source answer that must not reach a student. */
export function leakTerms(a: CompanyArtifact): string[] {
  const domain = new URL(a.website).host.replace(/^www\./, "");
  const terms = new Set<string>([a.company_name, domain, ...a.source_urls]);
  for (const w of a.product_summary.match(/\b[A-Z][A-Za-z]+\b/g) ?? []) if (!GENERIC.has(w)) terms.add(w);
  for (const n of a.product_summary.match(/\b\d[\d,]*\d\b/g) ?? []) terms.add(n);
  return [...terms].filter(Boolean).sort();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function leaks(text: string, terms: string[]): string[] {
  return terms.filter((t) => new RegExp(`(?<![A-Za-z0-9])${escape(t)}(?![A-Za-z0-9])`, "i").test(text));
}
