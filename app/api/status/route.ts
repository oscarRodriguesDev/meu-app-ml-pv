import { config } from "../../../lib/config";
import { pool } from "../../../lib/db";
import { isAdmin, unauthorized } from "../../../lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const c = config();
    if (!isAdmin(req.headers, c.ADMIN_SECRET)) return unauthorized();
    const db = pool();
    const [account, runs, pending] = await Promise.all([
      db.query("SELECT seller_id,expires_at,refresh_pending,checkpoint FROM ml_integration.ml_account WHERE singleton=true"),
      db.query("SELECT * FROM ml_integration.sync_runs ORDER BY id DESC LIMIT 20"),
      db.query("SELECT return_id,claim_id,updated_at FROM ml_integration.return_tasks WHERE seller_id=(SELECT seller_id FROM ml_integration.ml_account WHERE singleton=true) AND list_id=$1 AND creation_uncertain=true ORDER BY updated_at", [c.CLICKUP_LIST_ID]),
    ]);
    return Response.json({ connected: account.rows.length > 0, account: account.rows[0] ?? null, listId: c.CLICKUP_LIST_ID, runs: runs.rows, uncertain: pending.rows });
  } catch { return Response.json({ error: "STATUS_UNAVAILABLE" }, { status: 503 }); }
}
