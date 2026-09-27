import { startJob } from "@/app/_lib/arena-jobs";
import { parsePromptSmart } from "@/lib/battle/prompt.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string) => Response.json({ error }, { status: 400 });

/** POST {prompt} -> 200 {id, spec} | 409 {error, running} | 400 {error}. Events: GET /api/arena/<id> (SSE). */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("body must be JSON: {\"prompt\": \"...\"}");
  }
  const prompt = body && typeof body === "object" && !Array.isArray(body) ? (body as { prompt?: unknown }).prompt : undefined;
  if (typeof prompt !== "string" || !prompt.trim()) return bad("prompt is required");
  if (prompt.length > 500) return bad("prompt must be at most 500 characters");

  const spec = await parsePromptSmart(prompt);
  const { job, conflict } = startJob(spec.options);
  if (conflict) return Response.json({ error: "a tournament is already running", running: job.id }, { status: 409 });
  return Response.json({ id: job.id, spec });
}
