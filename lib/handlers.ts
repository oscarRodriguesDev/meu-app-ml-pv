import { config } from "./config";
import { isAdmin, isCron } from "./auth";
import { BusyError, withLock } from "./db";
import { errorCode, synchronize } from "./sync";
import { syncFailureDiagnostic } from "./diagnostics";
export async function syncHandler(req: Request, cron: boolean) {
  try {
    const c = config();
    if (!(cron ? isCron(req.headers, c.CRON_SECRET) : isAdmin(req.headers, c.ADMIN_SECRET))) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    return Response.json(await withLock(db => synchronize(db)));
  } catch (error) {
    if (error instanceof BusyError) return Response.json({ status: "skipped", reason: "SYNC_BUSY" });
    const code = errorCode(error);
    // No upstream body, authorization headers, OAuth codes, or tokens in logs.
    const diagnostic = syncFailureDiagnostic(error);
    console.error(JSON.stringify({ event: "sync_failed", code, ...diagnostic }));
    return Response.json({ error: code, ...diagnostic }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
