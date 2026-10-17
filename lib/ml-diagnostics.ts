import { claimsSearchParameters, idSchema, searchSchema, type MLGet } from "./mercado";
import { ApiError } from "./http";
import { errorCode } from "./sync";
import { syncFailureDiagnostic } from "./diagnostics";
export async function diagnoseClaimsSearch(get: MLGet, seller: string, from: Date, until: Date) {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime()) || from >= until) throw new Error("ML_DATE_RANGE_INVALID");
  const full = claimsSearchParameters(seller, from.getTime(), until.getTime());
  const baseline = new URLSearchParams(full); baseline.delete("range"); baseline.delete("sort"); baseline.set("limit", "1");
  const ranged = new URLSearchParams(full); ranged.delete("sort"); ranged.set("limit", "1");
  const checks = [];
  try {
    const identity = await get("/users/me") as { id?: unknown };
    if (idSchema.parse(identity.id) !== seller) throw new Error("ML_SELLER_MISMATCH");
    checks.push({ check: "account_identity", ok: true });
  } catch (error) {
    checks.push({ check: "account_identity", ok: false, error: errorCode(error), ...syncFailureDiagnostic(error) });
    return { status: "failed", checks };
  }
  const opened = new URLSearchParams(baseline); opened.set("status", "opened");
  const closed = new URLSearchParams(baseline); closed.set("status", "closed");
  for (const [check, params] of [["seller_filter", baseline], ["seller_opened", opened], ["seller_closed", closed], ["date_range", ranged], ["sort_and_page", full]] as const) {
    try {
      searchSchema.parse(await get(`/post-purchase/v1/claims/search?${params}`));
      checks.push({ check, ok: true });
    } catch (error) {
      checks.push({ check, ok: false, error: errorCode(error), ...syncFailureDiagnostic(error), ...(error instanceof ApiError && error.validationMessage ? { validationMessage: error.validationMessage } : {}) });
    }
  }
  return { status: checks.every(check => check.ok) ? "ok" : "failed", checks };
}
