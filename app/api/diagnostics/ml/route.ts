import { config } from "../../../../lib/config";
import { isAdmin, unauthorized } from "../../../../lib/auth";
import { BusyError, withLock } from "../../../../lib/db";
import { account, mlClient } from "../../../../lib/oauth";
import { diagnoseClaimsSearch } from "../../../../lib/ml-diagnostics";
import { errorCode } from "../../../../lib/sync";
import { syncFailureDiagnostic } from "../../../../lib/diagnostics";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request) {
  try {
    const c = config();
    if (!isAdmin(req.headers, c.ADMIN_SECRET)) return unauthorized();
    const result = await withLock(async db => {
      const seller = await account(db);
      const from = seller.checkpoint ? new Date(new Date(seller.checkpoint).getTime() - 15 * 60000) : new Date(c.ML_SYNC_FROM);
      return diagnoseClaimsSearch(mlClient(db, true), seller.seller_id, from, new Date());
    });
    // Validation text is available only in the authenticated response, never logs.
    const checks = result.checks.map(({ check, ok, ...details }) => {
      const { validationMessage: _private, ...safe } = details as typeof details & { validationMessage?: string };
      return { check, ok, ...safe };
    });
    console.info(JSON.stringify({ event: "ml_diagnostics", status: result.status, checks }));
    return Response.json(result, { status: result.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof BusyError) return Response.json({ status: "skipped", reason: "SYNC_BUSY" });
    const result = { error: errorCode(error), ...syncFailureDiagnostic(error) };
    console.error(JSON.stringify({ event: "ml_diagnostics_failed", ...result }));
    return Response.json(result, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
