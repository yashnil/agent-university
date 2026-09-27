// GET /api/skills?mode=live|demo: the certified skills in the company registry, with provenance.
import { getSkills } from "../../../lib/product.ts";
import { readRequest, respond } from "../../_lib/api.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return respond(async () => getSkills((await readRequest(req, false)).mode));
}
