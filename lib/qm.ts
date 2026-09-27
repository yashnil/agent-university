// QM runtime client: admin sign-in, portal API calls, run polling, and sandbox inspection.
// Ported from scripts/scout_run.py and scripts/transfer_run.py. Node built-ins only.
//
// Sign-in mints a single-use admin link with `npm exec qm -- admin-login` and redeems it at
// the portal exactly as a browser would. The token and cookies stay in memory, never printed.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentIdentity, VerificationResult } from "./types.ts";
import { verifyCompany } from "./verifiers/company.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RECORD_DIR = join(ROOT, ".agent-university");
export const PORTAL = process.env.QM_PORTAL ?? "http://localhost:8081";
export const ORG = "agent-university";
export const RUN_TIMEOUT_MS = 900_000;
export const LAYER_SKILL = "scout-research-company";

export const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A contract AgentIdentity for a QM agent: one thread = one session. Same ids as scripts/au_record.py. */
export function agentIdentity(threadRef: string, name: string): AgentIdentity {
  return { id: "qm-thread-" + createHash("sha256").update(threadRef).digest("hex").slice(0, 12), name, harness: "qm" };
}

export interface ExecResult { code: number; stdout: string; stderr: string }

export function run(cmd: string, args: string[], opts: { cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

export const docker = (...args: string[]) => run("docker", args);

// ------------------------------------------------------------------ portal session

export interface Session { cookie: string }

export async function signIn(): Promise<Session> {
  const r = await run("npm", ["exec", "--silent", "qm", "--", "admin-login"], { cwd: ROOT, timeoutMs: 120_000 });
  const m = /#token=([A-Za-z0-9._~-]+)/.exec(r.stdout);
  if (r.code !== 0 || !m) throw new Error("admin-login did not print a link (is QM running, Node 24 on PATH?)");
  const res = await fetch(`${PORTAL}/auth/admin-login`, {
    method: "POST",
    redirect: "manual",
    headers: { Origin: PORTAL, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: m[1] }).toString(),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status !== 303 && !res.ok) throw new Error(`admin sign-in failed: HTTP ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) throw new Error("admin sign-in set no session cookie");
  return { cookie };
}

export async function call(s: Session, method: string, path: string, body?: unknown, signal?: AbortSignal):
    Promise<{ status: number; body: any }> {
  const timeout = AbortSignal.timeout(60_000);
  const res = await fetch(`${PORTAL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: PORTAL, Cookie: s.cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const text = await res.text();
  if (!res.ok) return { status: res.status, body: text.slice(0, 500) };
  try {
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, body: text.slice(0, 500) };
  }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
});

/** Poll GET /api/runs/<id> until done/failed. Throws on timeout or abort. */
export async function poll(s: Session, runId: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  const deadline = Date.now() + (opts.timeoutMs ?? RUN_TIMEOUT_MS);
  while (Date.now() < deadline) {
    opts.signal?.throwIfAborted();
    try {
      const { body } = await call(s, "GET", `/api/runs/${encodeURIComponent(runId)}`, undefined, opts.signal);
      if (body && typeof body === "object" && (body.status === "done" || body.status === "failed")) return body;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
    }
    await sleep(5000, opts.signal);
  }
  throw Object.assign(new Error(`run ${runId} did not finish within ${(opts.timeoutMs ?? RUN_TIMEOUT_MS) / 1000}s`),
    { name: "TimeoutError" });
}

export async function publishedSkills(s: Session): Promise<string[]> {
  const { status, body } = await call(s, "GET", "/api/skills");
  if (status !== 200) throw new Error(`GET /api/skills failed: HTTP ${status} ${body}`);
  const items: any[] = Array.isArray(body) ? body : (body?.skills ?? []);
  return [...new Set(items.filter((x) => x && typeof x === "object" && (x.status ?? "published") === "published")
    .map((x) => x.name ?? x.manifest?.name).filter(Boolean))].sort() as string[];
}

/** New QM project: its scope group:web-project-<id> has its own sandbox container and home volume. */
export async function createProject(s: Session, name: string): Promise<{ id: string; scope: string }> {
  const { status, body } = await call(s, "POST", "/api/projects", { name });
  const project = body && typeof body === "object" ? body.project : null;
  if ((status !== 200 && status !== 201) || !project?.id) throw new Error(`project create failed: HTTP ${status} ${JSON.stringify(body)}`);
  return { id: String(project.id), scope: `group:web-project-${project.id}` };
}

export async function startTurn(s: Session, turn: { text: string; threadRef?: string; scopeId?: string }): Promise<string> {
  const { status, body } = await call(s, "POST", "/api/turn", { ...turn, clientTurnId: crypto.randomUUID() });
  if (![200, 201, 202].includes(status) || !body?.runId) throw new Error(`turn rejected: HTTP ${status} ${JSON.stringify(body)}`);
  return body.runId;
}

/** Every tool call that touched the layer skill, by skill:// URL or working-copy path. */
export function skillReads(run: any, layerSkill = LAYER_SKILL): unknown[] {
  return (run?.activity ?? []).filter((a: any) => a?.type === "tool_call" && JSON.stringify(a.payload ?? null).includes(layerSkill))
    .map((a: any) => a.payload);
}

export function saveRun(runId: string, runObj: unknown) {
  const d = join(RECORD_DIR, "runs");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${runId}.json`), JSON.stringify(runObj, null, 1));
}

// ------------------------------------------------------------------ sandboxes

/** QM sandboxes of this org, stopped ones included (the home volume, and so the artifact, persists). */
export async function sandboxes(): Promise<string[]> {
  const r = await docker("ps", "-a", "--filter", "label=qm.sandbox=1", "--filter", `label=qm.org=${ORG}`, "--format", "{{.Names}}");
  return r.stdout.split(/\s+/).filter(Boolean);
}

export async function scopeOf(name: string) {
  return (await docker("inspect", "-f", '{{index .Config.Labels "qm.scope"}}', name)).stdout.trim();
}

export async function sandboxesForScope(scope: string): Promise<string[]> {
  const out: string[] = [];
  for (const n of await sandboxes()) if ((await scopeOf(n)) === scope) out.push(n);
  return out;
}

export interface Found {
  container: string; scope: string; volume: string; path: string; content: string; verification: VerificationResult;
}

/**
 * Find `$HOME/<rel>` in the first container of `names` that has it and verify it in place.
 * Uses each container's own $HOME. A parked sandbox is started for the check and parked again.
 */
export async function findAndVerify(rel: string, names: string[]): Promise<Found | null> {
  for (const name of names) {
    const parked = (await docker("inspect", "-f", "{{.State.Running}}", name)).stdout.trim() !== "true";
    if (parked && (await docker("start", name)).code !== 0) continue;
    try {
      const home = (await docker("exec", name, "sh", "-c", 'printf %s "$HOME"')).stdout.trim();
      const found = await docker("exec", name, "realpath", "-e", `${home}/${rel}`);
      if (found.code !== 0) continue;
      const path = found.stdout.trim();
      const scope = await scopeOf(name);
      const volume = (await docker("inspect", "-f", "{{range .Mounts}}{{.Name}}:{{.Destination}} {{end}}", name)).stdout.trim();
      const cat = await docker("exec", name, "cat", path);
      const content = cat.code === 0 ? cat.stdout : "";
      return { container: name, scope, volume, path, content, verification: verifyCompany(cat.code === 0 ? content : null) };
    } finally {
      if (parked) await docker("stop", "-t", "2", name);
    }
  }
  return null;
}

// ------------------------------------------------------------------ deployment facts

/** The seeded admin (owner of the source scope), from ADMIN_GRANTS in the env or the gitignored .env. */
export function adminUser(): string {
  let grants = process.env.ADMIN_GRANTS ?? "";
  if (!grants) grants = readDotEnv("ADMIN_GRANTS") ?? "";
  const admins = grants.split(",").map((e) => e.trim()).filter((e) => e.endsWith(":org_admin"))
    .map((e) => e.slice(0, e.lastIndexOf(":")).trim());
  if (admins.length !== 1) throw new Error("set exactly one <email>:org_admin in ADMIN_GRANTS (.env or environment)");
  return admins[0];
}

/** One value from the repo's gitignored .env, or null. Never logged. */
export function readDotEnv(name: string): string | null {
  try {
    const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(join(ROOT, ".env"), "utf8"));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, "") || null : null;
  } catch {
    return null;
  }
}
