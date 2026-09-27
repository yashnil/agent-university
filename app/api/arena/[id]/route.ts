import { getJob, isTerminal } from "@/app/_lib/arena-jobs";
import type { ArenaEvent } from "@/app/_lib/arena-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events: replay every past event of the job, then stream new ones live. The stream
// closes after tournament.finished or error (or when the client disconnects).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "unknown arena job" }, { status: 404 });

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
      let seq = 0;
      const send = (e: ArenaEvent) => {
        if (closed) return;
        controller.enqueue(enc.encode(`id: ${seq++}\nevent: arena\ndata: ${JSON.stringify(e)}\n\n`));
        if (isTerminal(e)) close();
      };
      // Keep proxies from timing out an idle connection while a long live run is in progress.
      const ping = setInterval(() => {
        if (!closed) controller.enqueue(enc.encode(`: ping\n\n`));
      }, 15000);
      const sub = (e: ArenaEvent) => send(e);
      cleanup = () => {
        clearInterval(ping);
        job.subscribers.delete(sub);
        req.signal.removeEventListener("abort", close);
      };
      req.signal.addEventListener("abort", close);
      controller.enqueue(enc.encode(`retry: 3000\n\n`));
      // Replay synchronously then subscribe: events are pushed on the same thread, so none are lost.
      for (const e of [...job.events]) send(e);
      if (!closed) job.subscribers.add(sub);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
