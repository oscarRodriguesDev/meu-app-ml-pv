import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
it("installs the single SQL Editor script twice and grants only service_role RPC access",async()=>{
 const engine=new PGlite();
 try{
  await engine.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;");
  const sql=await readFile(new URL("../supabase/install.sql",import.meta.url),"utf8");
  await engine.exec(sql);await engine.exec(sql);
  expect((await engine.query("SELECT version FROM ml_integration.schema_migrations ORDER BY version")).rows).toEqual([{version:"001"},{version:"002"},{version:"003"}]);
  for(const role of ["anon","authenticated"]){
   await engine.exec(`SET ROLE ${role}`);
   try{await expect(engine.query("SELECT public.ml_service('status_get')")).rejects.toThrow(/permission denied/);}finally{await engine.exec("RESET ROLE");}
  }
  await engine.exec("SET ROLE service_role");
  try{
   expect((await engine.query<{result:{data:{connected:boolean;account:null}}}>("SELECT public.ml_service('status_get') AS result")).rows[0].result.data).toMatchObject({connected:false,account:null});
   await expect(engine.query("SELECT * FROM ml_integration.ml_account")).rejects.toThrow(/permission denied/);
  }finally{await engine.exec("RESET ROLE");}
 }finally{await engine.close();}
},20000);
