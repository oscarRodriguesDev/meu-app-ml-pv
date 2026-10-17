import pg from "pg";
import { databaseConfig } from "./database-config";
import type { PoolClient, QueryResultRow } from "pg";
export interface DB { query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }> }
const globalDb = globalThis as typeof globalThis & { mlPool?: pg.Pool };
export function pool() {
  return globalDb.mlPool ??= new pg.Pool(databaseConfig());
}
export class BusyError extends Error { constructor() { super("SYNC_BUSY"); } }
// Session advisory lock: use a direct PostgreSQL connection or a SESSION pooler.
// HTTP calls deliberately run outside a database transaction.
export async function withLock<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  let locked = false;
  let broken = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(71415, 9017) AS locked")).rows[0].locked;
    if (!locked) throw new BusyError();
    return await fn(client);
  } finally {
    if (locked) {
      try { await client.query("SELECT pg_advisory_unlock(71415, 9017)"); }
      catch { broken = true; }
    }
    client.release(broken);
  }
}
