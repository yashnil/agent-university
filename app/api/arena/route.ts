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
  const heats = int(body.heats, "heats");
  if (typeof heats === "string") return bad(heats);
  const perHeat = int(body.perHeat, "perHeat");
  if (typeof perHeat === "string") return bad(perHeat);
  let cases: string[] | undefined;
  if (body.cases !== undefined) {
    if (!Array.isArray(body.cases) || body.cases.length > 5 || !body.cases.every((c) => typeof c === "string" && c.trim() && c.length <= 64))
      return bad("cases must be an array of up to 5 non-empty strings");
    cases = (body.cases as string[]).map((c) => c.trim());
  }

  const options: ArenaOptions = { mode, heats, perHeat, ...(cases ? { cases } : {}) };
  const { job, conflict } = startJob(options);
  if (conflict) return Response.json({ error: "a tournament is already running", running: job.id }, { status: 409 });
  return Response.json({ id: job.id });
}
