// Shared request handling for the product API routes. Relative .ts imports (not "@/") so the
// routes run under `node --test` as well as Next.
import { ApiError, parseMode } from "../../lib/product.ts";
import type { ApiMode } from "../../lib/product.ts";

/** `?mode=demo|live` on the URL, or `mode` in a JSON body; live by default. */
export async function readRequest(req: Request, withBody: boolean): Promise<{ mode: ApiMode; body: Record<string, unknown> }> {
  let body: Record<string, unknown> = {};
  if (withBody) {
    const text = await req.text();
    if (text.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new ApiError(400, "body must be JSON");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ApiError(400, "body must be a JSON object");
      body = parsed as Record<string, unknown>;
    }
  }
  const mode = parseMode(new URL(req.url).searchParams.get("mode") ?? body.mode);
  return { mode, body };
}

export async function respond(fn: () => Promise<unknown> | unknown): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
