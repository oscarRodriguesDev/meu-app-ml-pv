import { claimsSearchParameters, searchSchema, type MLGet } from "./mercado";
import { errorCode } from "./sync";
import { syncFailureDiagnostic } from "./diagnostics";
export async function diagnoseClaimsSearch(get: MLGet, seller: string, from: Date, until: Date) {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime()) || from >= until) throw new Error("ML_DATE_RANGE_INVALID");
  const full = claimsSearchParameters(seller, from.getTime(), until.getTime());
  const baseline = new URLSearchParams(full); baseline.delete("range"); baseline.delete("sort"); baseline.set("limit", "1");
  const ranged = new URLSearchParams(full); ranged.delete("sort"); ranged.set("limit", "1");
  const checks = [];
  for (const [check, params] of [["seller_filter", baseline], ["date_range", ranged], ["sort_and_page", full]] as const) {
    try {
      searchSchema.parse(await get(`/post-purchase/v1/claims/search?${params}`));
      checks.push({ check, ok: true });
    } catch (error) {
      checks.push({ check, ok: false, error: errorCode(error), ...syncFailureDiagnostic(error) });
    }
  }
  return { status: checks.every(check => check.ok) ? "ok" : "failed", checks };
}
