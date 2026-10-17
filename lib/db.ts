import { randomUUID } from "node:crypto";
import { supabaseConfig } from "./config";
import { request } from "./http";

export type Operation = "lease_acquire" | "lease_renew" | "lease_release" | "account_get" | "account_save" | "refresh_begin" |
  "oauth_begin" | "oauth_consume" | "mapping_get" | "mapping_reserve" | "mapping_save" | "known_claims" |
  "run_start" | "run_finish" | "checkpoint_save" | "status_get";
export type Payload = Record<string, unknown>;
export interface DB { call<T = unknown>(operation: Operation, payload?: Payload): Promise<T>; assertLease(): Promise<void> }
export type Transport = <T>(operation: Operation, payload: Payload, token: string | null) => Promise<T>;

export const rpcTransport: Transport = async <T>(operation: Operation, payload: Payload, token: string | null) => {
  const c = supabaseConfig();
  const headers: Record<string, string> = { apikey: c.SUPABASE_SECRET_KEY, "Content-Type": "application/json" };
  // New sb_secret keys belong only in apikey; legacy service_role JWTs also need Authorization.
  if (c.SUPABASE_SECRET_KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${c.SUPABASE_SECRET_KEY}`;
  const result = await request("SUPABASE", `${c.SUPABASE_URL}/rest/v1/rpc/ml_service`, {
    method: "POST", headers, body: JSON.stringify({ p_operation: operation, p_payload: payload, p_lock_token: token }),
  }) as { data?: T; error?: string };
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("SUPABASE_INVALID_RESPONSE");
  if (result.error) {
    const code = /^(SYNC|ML|OAUTH|CLICKUP)_[A-Z0-9_]+$/.test(result.error) ? result.error : "SUPABASE_RPC_ERROR";
    throw new Error(code);
  }
  if (!("data" in result)) throw new Error("SUPABASE_INVALID_RESPONSE");
  return result.data as T;
};

export function database(transport: Transport = rpcTransport, token: string | null = null): DB {
  return {
    call: <T>(operation: Operation, payload: Payload = {}) => transport<T>(operation, payload, token),
    async assertLease() {
      if (!token || !await transport<boolean>("lease_renew", {}, token)) throw new Error("SYNC_LOCK_LOST");
    },
  };
}
export class BusyError extends Error { constructor() { super("SYNC_BUSY"); } }

/** Each RPC validates/fences the lease inside its transaction, including after a serverless process dies. */
export async function withLock<T>(fn: (db: DB) => Promise<T>, transport: Transport = rpcTransport): Promise<T> {
  const token = randomUUID();
  const db = database(transport, token);
  if (!await db.call<boolean>("lease_acquire")) throw new BusyError();
  let lost = false;
  let renewing: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (renewing || lost) return;
    renewing = db.assertLease().catch(() => { lost = true; }).finally(() => { renewing = undefined; });
  }, 20000);
  timer.unref?.();
  const guarded: DB = {
    async call<T>(operation: Operation, payload: Payload = {}) {
      if (lost) throw new Error("SYNC_LOCK_LOST");
      return db.call<T>(operation, payload);
    },
    async assertLease() {
      if (lost) throw new Error("SYNC_LOCK_LOST");
      try { await db.assertLease(); } catch (error) { lost = true; throw error; }
    },
  };
  try { return await fn(guarded); }
  finally {
    clearInterval(timer);
    await renewing;
    // Release only this owner. On network loss the lease expires automatically after 120 seconds.
    await db.call("lease_release").catch(() => undefined);
  }
}
