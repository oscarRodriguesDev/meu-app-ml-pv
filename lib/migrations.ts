import { readFile, readdir } from "node:fs/promises";
import type { DB } from "./db";

async function registry(db: DB) {
  const { rows } = await db.query<{ private_registry: string | null; public_registry: string | null }>(
    "SELECT to_regclass('ml_integration.schema_migrations')::text AS private_registry, to_regclass('public.schema_migrations')::text AS public_registry",
  );
  if (rows[0].private_registry) return "ml_integration.schema_migrations";
  if (rows[0].public_registry) return "public.schema_migrations";
  return null;
}

/** Caller owns the transaction. The first migration is kept compatible with existing installations. */
export async function applyMigrations(db: DB) {
  const directory = new URL("../db/", import.meta.url);
  const files = (await readdir(directory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const applied: string[] = [];
  for (const file of files) {
    const version = file.slice(0, 3);
    const table = await registry(db);
    if (table && (await db.query(`SELECT version FROM ${table} WHERE version=$1`, [version])).rows.length) continue;
    await db.query(await readFile(new URL(file, directory), "utf8"));
    const nextTable = await registry(db);
    if (!nextTable) throw new Error("MIGRATION_REGISTRY_MISSING");
    await db.query(`INSERT INTO ${nextTable}(version) VALUES($1) ON CONFLICT DO NOTHING`, [version]);
    applied.push(version);
  }
  return applied;
}
