import { config } from "../../../lib/config";
import { database } from "../../../lib/db";
import { isAdmin, unauthorized } from "../../../lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const c = config();
    if (!isAdmin(req.headers, c.ADMIN_SECRET)) return unauthorized();
    return Response.json(await database().call("status_get", { list_id: c.CLICKUP_LIST_ID }));
  } catch { return Response.json({ error: "STATUS_UNAVAILABLE" }, { status: 503 }); }
}
