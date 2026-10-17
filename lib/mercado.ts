import { z } from "zod";
export const idSchema = z.union([z.string().regex(/^\d+$/), z.number().int().safe().nonnegative().transform(String)]);
export const claimSchema = z.object({ id: idSchema, type: z.string().optional(), related_entities: z.array(z.string()).optional() });
export const returnSchema = z.object({
  id: idSchema, claim_id: idSchema.optional(), status: z.string(), subtype: z.string().nullish(),
  status_money: z.string().nullish(), last_updated: z.string().optional(), resource_id: idSchema.optional(),
  orders: z.array(z.object({ order_id: idSchema, item_id: z.string().optional(), return_quantity: z.union([z.string(), z.number()]).optional() })).optional(),
  shipments: z.array(z.object({ shipment_id: idSchema.optional(), status: z.string().optional(), tracking_number: z.union([z.string(), z.number()]).nullish() })).optional(),
});
export type ReturnData = z.infer<typeof returnSchema>;
export const searchSchema = z.object({ paging: z.object({ total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), limit: z.number().int().positive().max(50) }), data: z.array(claimSchema) });
export type MLGet = (path: string) => Promise<unknown>;
// Match the documented timestamp shape: milliseconds and explicit UTC offset.
export const claimStatuses = ["opened", "closed"] as const;
export type ClaimStatus = typeof claimStatuses[number];
export function claimsSearchParameters(seller: string, start: number, end: number, status: ClaimStatus) {
  const timestamp = (value: number) => new Date(value).toISOString().replace(/Z$/, "+00:00");
  return new URLSearchParams({ "players.user_id": seller, "players.role": "respondent", status, limit: "50", offset: "0", sort: "last_updated:asc",
    range: `last_updated:after:${timestamp(start)},before:${timestamp(end)}` });
}
// Split large time windows instead of exceeding ML's offset + limit < 10000 rule.
export async function discoverClaims(get: MLGet, seller: string, from: Date, until: Date) {
  const found = new Map<string, z.infer<typeof claimSchema>>();
  async function window(start: number, end: number, status: ClaimStatus, depth = 0): Promise<void> {
    const params = claimsSearchParameters(seller, start, end, status);
    const page = async (offset: number) => { params.set("offset", String(offset)); const result = searchSchema.parse(await get(`/post-purchase/v1/claims/search?${params}`)); if (result.paging.offset !== offset) throw new Error("ML_PAGINATION_INVALID"); return result; };
    const first = await page(0);
    if (first.paging.total >= 9900) {
      if (end - start < 4 || depth >= 48) throw new Error("ML_WINDOW_TOO_DENSE");
      const mid = Math.floor((start + end) / 2);
      await window(start, mid + 1, status, depth + 1); await window(mid - 1, end, status, depth + 1); return;
    }
    let current = first; let offset = 0;
    while (true) {
      for (const claim of current.data) found.set(claim.id, claim);
      offset += current.data.length;
      if (offset >= current.paging.total) break;
      if (!current.data.length || offset + 50 >= 10000) throw new Error("ML_PAGINATION_INCOMPLETE");
      current = await page(offset);
    }
  }
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime()) || from >= until) throw new Error("ML_DATE_RANGE_INVALID");
  // The live API does not count the player pair or range as the required filter.
  // Query both states, including closed returns, and deduplicate across states/windows.
  for (const status of claimStatuses) await window(from.getTime(), until.getTime(), status);
  return [...found.values()];
}
export async function returnClaimIds(get: MLGet, claims: z.infer<typeof claimSchema>[]) {
  const result: string[] = [];
  for (let claim of claims) {
    if (!claim.related_entities && claim.type !== "return") claim = claimSchema.parse(await get(`/post-purchase/v1/claims/${claim.id}`));
    if (claim.type === "return" || claim.related_entities?.includes("return")) result.push(claim.id);
  }
  return result;
}
