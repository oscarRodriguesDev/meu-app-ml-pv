import { claimsSearchParameters, claimStatuses, idSchema, searchSchema, type MLGet } from "./mercado";
import { ApiError } from "./http";
import { errorCode } from "./sync";
import { syncFailureDiagnostic } from "./diagnostics";
export async function diagnoseClaimsSearch(get: MLGet, seller: string, from: Date, until: Date) {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime()) || from >= until) throw new Error("ML_DATE_RANGE_INVALID");
  const checks = [];
  try {
    const identity = await get("/users/me") as { id?: unknown };
    if (idSchema.parse(identity.id) !== seller) throw new Error("ML_SELLER_MISMATCH");
    checks.push({ check: "account_identity", ok: true });
  } catch (error) {
    checks.push({ check: "account_identity", ok: false, error: errorCode(error), ...syncFailureDiagnostic(error), ...(error instanceof ApiError && error.validationMessage ? { validationMessage: error.validationMessage } : {}) });
    return { status: "failed", checks };
  }
  const probes: [string, URLSearchParams][] = [];
  for (const status of claimStatuses) {
    const full = claimsSearchParameters(seller, from.getTime(), until.getTime(), status);
    const baseline = new URLSearchParams(full); baseline.delete("range"); baseline.delete("sort"); baseline.set("limit", "1");
    const ranged = new URLSearchParams(full); ranged.delete("sort"); ranged.set("limit", "1");
    probes.push([`seller_${status}`, baseline], [`date_range_${status}`, ranged], [`sort_and_page_${status}`, full]);
  }
  for (const [check, params] of probes) {
    try {
      searchSchema.parse(await get(`/post-purchase/v1/claims/search?${params}`));
      checks.push({ check, ok: true });
    } catch (error) {
      checks.push({ check, ok: false, error: errorCode(error), ...syncFailureDiagnostic(error), ...(error instanceof ApiError && error.validationMessage ? { validationMessage: error.validationMessage } : {}) });
    }
  }
  return { status: checks.every(check => check.ok) ? "ok" : "failed", checks };
}
