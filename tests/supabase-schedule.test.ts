import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
it("schedules once, resolves Vault secrets at runtime and validates the HTTPS origin", async () => {
  const engine = new PGlite();
  try {
    // Stub only the managed Supabase extensions. PostgreSQL executes the real scheduling script.
    await engine.exec(`
      CREATE SCHEMA cron; CREATE SCHEMA vault; CREATE SCHEMA net;
      CREATE TABLE vault.decrypted_secrets(name text UNIQUE, decrypted_secret text);
      CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY, jobname text UNIQUE, schedule text, command text);
      CREATE TABLE net.requests(id bigint GENERATED ALWAYS AS IDENTITY, url text, headers jsonb, timeout_ms int);
      CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3)
        ON CONFLICT(jobname) DO UPDATE SET schedule=excluded.schedule,command=excluded.command RETURNING jobid;
      $$;
      CREATE FUNCTION net.http_get(url text,params jsonb DEFAULT '{}',headers jsonb DEFAULT '{}',timeout_milliseconds int DEFAULT 2000)
      RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO net.requests(url,headers,timeout_ms) VALUES($1,$3,$4) RETURNING id;
      $$;
    `);
    await engine.query("INSERT INTO vault.decrypted_secrets VALUES($1,$2),($3,$4)", ["ml_clickup_app_url","https://app.example/","ml_clickup_cron_secret","x".repeat(32)]);
    const sql = await readFile(new URL("../supabase/schedule.sql", import.meta.url), "utf8");
    await engine.exec(sql); await engine.exec(sql);
    const {rows} = await engine.query<{schedule:string;command:string}>("SELECT schedule,command FROM cron.job");
    expect(rows).toHaveLength(1);expect(rows[0].schedule).toBe("*/15 * * * *");
    expect(rows[0].command).not.toContain("x".repeat(32));
    await engine.exec(rows[0].command);
    expect((await engine.query("SELECT url,headers,timeout_ms FROM net.requests")).rows).toEqual([{url:"https://app.example/api/cron/sync",headers:{Authorization:`Bearer ${"x".repeat(32)}`},timeout_ms:300000}]);
    await engine.query("UPDATE vault.decrypted_secrets SET decrypted_secret=$1 WHERE name=$2", ["https://app.example/?leak=1","ml_clickup_app_url"]);
    await expect(engine.exec(sql)).rejects.toThrow("HTTPS origin");await engine.exec("ROLLBACK");
    expect((await engine.query("SELECT jobname FROM cron.job")).rows).toHaveLength(1);
  } finally { await engine.close(); }
},20000);
