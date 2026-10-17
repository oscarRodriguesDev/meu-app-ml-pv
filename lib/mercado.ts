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
const searchSchema = z.object({ paging: z.object({ total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), limit: z.number().int().positive().max(50) }), data: z.array(claimSchema) });
export type MLGet = (path: string) => Promise<unknown>;
// Split large time windows instead of exceeding ML's offset + limit < 10000 rule.
export async function discoverClaims(get: MLGet, seller: string, from: Date, until: Date) {
  const found = new Map<string, z.infer<typeof claimSchema>>();
  async function window(start: number, end: number, depth = 0): Promise<void> {
    const params = new URLSearchParams({ "players.user_id": seller, "players.role": "respondent", limit: "50", offset: "0", sort: "last_updated:asc",
      range: `last_updated:after:${new Date(start).toISOString()},before:${new Date(end).toISOString()}` });
    const page = async (offset: number) => { params.set("offset", String(offset)); const result = searchSchema.parse(await get(`/post-purchase/v1/claims/search?${params}`)); if (result.paging.offset !== offset) throw new Error("ML_PAGINATION_INVALID"); return result; };
    const first = await page(0);
    if (first.paging.total >= 9900) {
      if (end - start < 4 || depth >= 48) throw new Error("ML_WINDOW_TOO_DENSE");
      const mid = Math.floor((start + end) / 2);
      await window(start, mid + 1, depth + 1); await window(mid - 1, end, depth + 1); return;
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
  if (!Number.isFinite(from.getTime()) || from >= until) throw new Error("ML_DATE_RANGE_INVALID");
  await window(from.getTime(), until.getTime());
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
