import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../lib/migrations";
import { database as runtimeDatabase, type Transport } from "../lib/db";
import type { SQLDatabase } from "../lib/sql";
export function testEnv() {
  Object.assign(process.env, { SUPABASE_URL: "https://test.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_JWKS_URL: "https://test.supabase.co/auth/v1/.well-known/jwks.json", CLICKUP_API_TOKEN: "test-clickup", CLICKUP_LIST_ID: "901717874275", ML_CLIENT_ID: "test-client", ML_CLIENT_SECRET: "test-secret", ML_REDIRECT_URI: "https://app.example/api/oauth/callback", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), ADMIN_SECRET: "a".repeat(32), CRON_SECRET: "b".repeat(32), ML_SYNC_FROM: "2000-01-01T00:00:00.000Z" });
  delete process.env.DATABASE_URL; delete process.env.ML_SELLER_ID;
}
export function sqlTransport(sql: SQLDatabase): Transport {
  return async <T>(operation: string, payload: Record<string, unknown>, token: string | null) => {
    const row = (await sql.query<{response:{data:T;error?:string}}>("SELECT public.ml_service($1,$2::jsonb,$3::uuid) AS response", [operation,JSON.stringify(payload),token])).rows[0];
    if (row.response.error) throw new Error(row.response.error);
    return row.response.data;
  };
}
export async function database() {
  const engine = new PGlite();
  const sql: SQLDatabase = { async query(text, values) { if (!values) { const result = await engine.exec(text); return { rows: (result.at(-1)?.rows ?? []) as never[] }; } const result = await engine.query(text, values); return { rows: result.rows as never[] }; } };
  await applyMigrations(sql);
  const transport = sqlTransport(sql); const token = randomUUID();
  const db = runtimeDatabase(transport, token);
  await db.call("lease_acquire");
  return { db, sql, engine, token, transport };
}
export const sampleReturn = { id: "88", claim_id: "55", status: "shipped", subtype: "return_total", status_money: "retained", last_updated: "2026-01-01T00:00:00.000Z", orders: [{order_id:"123",item_id:"MLB123",return_quantity:"1.0"}], shipments: [{shipment_id:"987",status:"shipped",tracking_number:"ABC"}] };
