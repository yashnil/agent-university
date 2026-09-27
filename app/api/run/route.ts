// POST /api/run: a fresh Intern composes the diligence task from certified skills. Returns the
// ordered steps (each labelled live | certified-registry | fixture | gap), the plan.composed and
// gap.discovered events, the new candidate skills and the metrics. Read-only.
import { runComposite } from "../../../lib/product.ts";
import { readRequest, respond } from "../../_lib/api.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return respond(async () => runComposite((await readRequest(req, true)).mode));
}
