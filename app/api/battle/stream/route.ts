// GET /api/battle/stream?prompt=... — parse the prompt, run the tournament and stream it, all in
// ONE request (Server-Sent Events: `event: spec` once, then `event: arena` per ArenaEvent).
//
// One request on purpose: on serverless hosts (Vercel) the POST-a-job-then-reconnect flow breaks,
// because background work stops after the response. The run still goes through the shared job
// registry (startJob), because runArena swaps the process-global registry dir for dry runs and hides
// the layer skill for live runs: two concurrent runs corrupt each other (a dry run can leave the
// registry pointing at a temp dir, a live run can write into a dry run's temp registry). If a
// battle is already running, this request watches that one instead (like POST /api/battle's 409).
// Live runs need the local QM stack (Docker sandboxes) and are refused on Vercel.

import { startJob, isTerminal } from "@/app/_lib/arena-jobs";
import type { ArenaEvent } from "@/app/_lib/arena-jobs";
import { parsePromptSmart } from "@/lib/battle/prompt";
import type { BattleSpec } from "@/lib/battle/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export async function GET(req: Request) {
  const prompt = (new URL(req.url).searchParams.get("prompt") ?? "").trim();
  if (!prompt || prompt.length > 500) return Response.json({ error: "prompt must be 1-500 characters" }, { status: 400 });

  const spec = await parsePromptSmart(prompt);
  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 15_000);
      cleanup = () => clearInterval(ping);
      req.signal.addEventListener("abort", close);

      if (spec.options.mode === "live" && process.env.VERCEL) {
        send("spec", spec);
        const e: ArenaEvent = { type: "error", at: now(),
          message: "Live battles need the local QM stack (Docker sandboxes); this deployment runs dry battles only." };
        send("arena", e);
        close();
        return;
      }

      const { job, conflict } = startJob(spec.options);
      // Watching someone else's battle: describe THAT run, but keep this viewer's prompt so REMATCH replays it.
      const shown: BattleSpec = conflict
        ? { ...spec, options: job.options, title: `WATCHING A ${job.mode === "live" ? "LIVE" : "DRY"} BATTLE IN PROGRESS`,
            notes: [`another battle (${job.id.slice(0, 8)}) was already running: watching it`, ...spec.notes] }
        : spec;
      send("spec", shown);

      const sub = (e: ArenaEvent) => {
        send("arena", e);
        if (isTerminal(e)) close();
      };
      cleanup = () => {
        clearInterval(ping);
        job.subscribers.delete(sub);
        req.signal.removeEventListener("abort", close);
      };
      // Replay synchronously then subscribe: events are pushed on the same thread, so none are lost.
      for (const e of [...job.events]) sub(e);
      if (!closed) job.subscribers.add(sub);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
