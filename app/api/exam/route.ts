// POST /api/exam: certify a transferred skill with the production engine in strict mode.
//   {}  or  {"case": "vercel"}                   the real sanitized Linear -> Vercel transfer
//   {"skill": ..., "transfer": ..., "events": [...]}   any TransferResult (artifact under demo/fixtures/)
// Returns the checklist, the resulting status and the CertificationRecord. It never promotes.
import { runExam } from "../../../lib/product.ts";
import { readRequest, respond } from "../../_lib/api.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return respond(async () => {
    const { mode, body } = await readRequest(req, true);
    return runExam(mode, body);
  });
}
