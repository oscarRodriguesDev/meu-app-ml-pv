import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import type { SQLDatabase as DB } from "../lib/sql";
import { applyMigrations } from "../lib/migrations";
it("moves legacy rows to the private schema, blocks Supabase API roles, and reapplies safely", async () => {
  const engine = new PGlite();
  const db: DB = { async query(text, values) {
    if (values) { const result = await engine.query(text, values); return { rows: result.rows as never[] }; }
    const result = await engine.exec(text); return { rows: (result.at(-1)?.rows ?? []) as never[] };
  } };
  try {
    await engine.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
    await engine.exec(await readFile(new URL("../db/001_init.sql", import.meta.url), "utf8"));
    await engine.exec(`INSERT INTO public.ml_account(seller_id,tokens_encrypted,expires_at) VALUES('42','encrypted-data',now());
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;`);
    expect(await applyMigrations(db)).toEqual(["002", "003"]);
    expect(await applyMigrations(db)).toEqual([]);
    expect((await engine.query("SELECT seller_id,tokens_encrypted FROM ml_integration.ml_account")).rows).toEqual([{seller_id:"42",tokens_encrypted:"encrypted-data"}]);
    expect((await engine.query("SELECT to_regclass('public.ml_account') AS legacy")).rows).toEqual([{legacy:null}]);
    const rls = await engine.query<{relrowsecurity:boolean}>("SELECT relrowsecurity FROM pg_class WHERE relnamespace='ml_integration'::regnamespace AND relkind='r'");
    expect(rls.rows).toHaveLength(6);expect(rls.rows.every(row=>row.relrowsecurity)).toBe(true);
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await engine.query(`SELECT has_schema_privilege('${role}','ml_integration','USAGE') AS allowed`)).rows).toEqual([{allowed:false}]);
      expect((await engine.query(`SELECT has_table_privilege('${role}','ml_integration.ml_account','SELECT') AS allowed`)).rows).toEqual([{allowed:false}]);
      await engine.exec(`SET ROLE ${role}`);
      try { await expect(engine.query("SELECT * FROM ml_integration.ml_account")).rejects.toThrow(/permission denied/); }
      finally { await engine.exec("RESET ROLE"); }
    }
  } finally { await engine.close(); }
},20000);
