import { it, expect } from "vitest";
import { applyMigrations } from "../lib/migrations";
import { sqlTransport } from "./setup";
import { withLock, BusyError } from "../lib/db";
import pg from "pg";
it.runIf(Boolean(process.env.TEST_DATABASE_URL))("uses real PostgreSQL RPC leases and enforces unique mappings",async()=>{
 const url=process.env.TEST_DATABASE_URL!;
 if(!new URL(url).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must point to a database ending in _test");
 const sql=new pg.Pool({connectionString:url}); const transport=sqlTransport(sql);
 try{
  const client=await sql.connect();try{await client.query("BEGIN");await applyMigrations(client);await client.query("COMMIT");expect(await applyMigrations(client)).toEqual([]);}finally{client.release();}
  await sql.query("UPDATE ml_integration.sync_lease SET expires_at='-infinity'");
  let release!:()=>void;let entered!:()=>void;const enteredPromise=new Promise<void>(r=>entered=r);const gate=new Promise<void>(r=>release=r);
  const first=withLock(async()=>{entered();await gate;},transport);await enteredPromise;
  try{await expect(withLock(async()=>{},transport)).rejects.toBeInstanceOf(BusyError);}finally{release();await first;}
  await expect(withLock(async()=>{throw new Error("deliberate failure");},transport)).rejects.toThrow("deliberate failure");
  expect(await withLock(async()=>"unlocked",transport)).toBe("unlocked");
  await sql.query("DELETE FROM ml_integration.return_tasks");
  await sql.query("INSERT INTO ml_integration.return_tasks(seller_id,list_id,return_id,claim_id) VALUES('1','2','3','4')");
  await expect(sql.query("INSERT INTO ml_integration.return_tasks(seller_id,list_id,return_id,claim_id) VALUES('1','2','3','4')")).rejects.toMatchObject({code:"23505"});
 }finally{await sql.end();}
},20000);
