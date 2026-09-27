import { currentJob, listJobs, startJob } from "@/app/_lib/arena-jobs";
import type { ArenaOptions } from "@/app/_lib/arena-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (message: string) => Response.json({ error: message }, { status: 400 });

export async function GET() {
  return Response.json({ current: currentJob()?.id ?? null, jobs: listJobs() });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return bad("body must be a JSON object");
    body = parsed as Record<string, unknown>;
  } catch {
    return bad("body must be JSON");
  }
  const mode = body.mode ?? "dry";
  if (mode !== "dry" && mode !== "live") return bad('mode must be "dry" or "live"');
  const int = (v: unknown, name: string): number | string => {
    if (v === undefined) return 3;
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : `${name} must be an integer 1-5`;
  };
  // `flows`/`perFlow` (flow tournament) supersede the older `heats`/`perHeat`; both are accepted.
  const flows = int(body.flows ?? body.heats, "flows");
  if (typeof flows === "string") return bad(flows);
  const perFlow = int(body.perFlow ?? body.perHeat, "perFlow");
  if (typeof perFlow === "string") return bad(perFlow);
  const strList = (v: unknown, name: string): string[] | undefined | string => {
    if (v === undefined || v === null || v === "") return undefined;
    const arr = typeof v === "string" ? v.split(",") : v;
    if (!Array.isArray(arr) || !arr.every((c) => typeof c === "string" && c.length <= 128)) return `${name} must be an array of strings`;
    const out = (arr as string[]).map((c) => c.trim()).filter(Boolean);
    if (out.length > 5) return `${name} takes at most 5 entries`;
    return out.length ? out : undefined;
  };
  const cases = strList(body.cases, "cases");
  if (typeof cases === "string") return bad(cases);
  const procedures = strList(body.procedures, "procedures");
  if (typeof procedures === "string") return bad(procedures);

  const options: ArenaOptions = {
    mode,
    flows,
    perFlow,
    ...(cases ? { cases } : {}),
    ...(procedures ? { procedures } : {}),
  };
  const { job, conflict } = startJob(options);
  if (conflict) return Response.json({ error: "a tournament is already running", running: job.id }, { status: 409 });
  return Response.json({ id: job.id });
}
