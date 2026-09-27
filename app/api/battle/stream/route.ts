// GET /api/battle/stream?prompt=... — parse the prompt, run the tournament and stream it, all in
// ONE request (Server-Sent Events: `event: spec` once, then `event: arena` per ArenaEvent).
//
// Stateless on purpose: on serverless hosts (Vercel) the POST-a-job-then-reconnect flow breaks,
// because the job lives in one instance's memory and background work stops after the response.
// Live runs need the local QM stack (Docker sandboxes) and are refused on Vercel.

import { runArena } from "@/lib/arena";
import type { ArenaEvent } from "@/lib/arena";
import { parsePromptSmart } from "@/lib/battle/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export async function GET(req: Request) {
  const prompt = (new URL(req.url).searchParams.get("prompt") ?? "").trim();
  if (!prompt || prompt.length > 500) return Response.json({ error: "prompt must be 1-500 characters" }, { status: 400 });

  const spec = await parsePromptSmart(prompt);
  const enc = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const ping = setInterval(() => {
        if (!closed) controller.enqueue(enc.encode(": ping\n\n"));
      }, 15_000);

      send("spec", spec);
      if (spec.options.mode === "live" && process.env.VERCEL) {
        const e: ArenaEvent = { type: "error", at: now(),
          message: "Live battles need the local QM stack (Docker sandboxes); this deployment runs dry battles only." };
        send("arena", e);
      } else {
        await runArena(spec.options, (e) => send("arena", e));
      }
      clearInterval(ping);
      closed = true;
      controller.close();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
