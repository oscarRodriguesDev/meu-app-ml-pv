// Direct PostgreSQL is used only for optional CLI migrations and integration tests.
import pg from "pg";
import type { QueryResultRow } from "pg";
import { databaseConfig } from "./database-config";
export interface SQLDatabase { query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }> }
let instance: pg.Pool | undefined;
export function pool() { return instance ??= new pg.Pool(databaseConfig()); }
