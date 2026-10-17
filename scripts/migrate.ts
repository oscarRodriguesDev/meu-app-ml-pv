import type { Pool, PoolClient } from "pg";
import { pool } from "../lib/sql";
import { applyMigrations } from "../lib/migrations";
let client: PoolClient | undefined;
let connectionPool: Pool | undefined;
try {
  connectionPool = pool();
  client = await connectionPool.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(71415, 9018)");
  const applied = await applyMigrations(client);
  await client.query("COMMIT");
  console.log(applied.length ? `Migrações aplicadas: ${applied.join(", ")}.` : "Banco já atualizado.");
} catch {
  if (client) await client.query("ROLLBACK").catch(() => undefined);
  console.error("Falha na migração; verifique a conexão, o certificado e os privilégios do PostgreSQL.");
  process.exitCode = 1;
} finally { client?.release(); await connectionPool?.end(); }
