import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../lib/migrations";
import type { DB } from "../lib/db";
export function testEnv() {
  Object.assign(process.env, { DATABASE_URL: "postgresql://test:test@localhost/test", CLICKUP_API_TOKEN: "test-clickup", CLICKUP_LIST_ID: "901717874275", ML_CLIENT_ID: "test-client", ML_CLIENT_SECRET: "test-secret", ML_REDIRECT_URI: "https://app.example/api/oauth/callback", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), ADMIN_SECRET: "a".repeat(32), CRON_SECRET: "b".repeat(32), ML_SYNC_FROM: "2000-01-01T00:00:00.000Z" });
  delete process.env.ML_SELLER_ID;
}
export async function database() {
  const engine = new PGlite();
  const db: DB = { async query(text, values) { if (!values) { const result = await engine.exec(text); return { rows: (result.at(-1)?.rows ?? []) as never[] }; } const result = await engine.query(text, values); return { rows: result.rows as never[] }; } };
  await applyMigrations(db);
  return { db, engine };
}
export const sampleReturn = { id: "88", claim_id: "55", status: "shipped", subtype: "return_total", status_money: "retained", last_updated: "2026-01-01T00:00:00.000Z", orders: [{order_id:"123",item_id:"MLB123",return_quantity:"1.0"}], shipments: [{shipment_id:"987",status:"shipped",tracking_number:"ABC"}] };
