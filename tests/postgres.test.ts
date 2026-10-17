import { it, expect, vi } from "vitest";
import { applyMigrations } from "../lib/migrations";
import pg from "pg";
// Uses only a dedicated test database; default tests need no external service.
it.runIf(Boolean(process.env.TEST_DATABASE_URL))("uses real PostgreSQL session locks, releases on errors, and enforces unique mappings",async()=>{
 const url=process.env.TEST_DATABASE_URL!;
 if(!new URL(url).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must point to a database ending in _test");
 process.env.DATABASE_URL=url;
 const {pool,withLock,BusyError}=await import("../lib/db");
 const db=pool();
 try{
  await db.query("BEGIN");await applyMigrations(db);await db.query("COMMIT");expect(await applyMigrations(db)).toEqual([]);
  let release!:()=>void;let entered!:()=>void;const enteredPromise=new Promise<void>(r=>entered=r);const gate=new Promise<void>(r=>release=r);
  const first=withLock(async()=>{entered();await gate;});await enteredPromise;
  try{await expect(withLock(async()=>{})).rejects.toBeInstanceOf(BusyError);}finally{release();await first;}
  await expect(withLock(async()=>{throw new Error("deliberate failure");})).rejects.toThrow("deliberate failure");
  expect(await withLock(async()=>"unlocked")).toBe("unlocked");
  await db.query("DELETE FROM ml_integration.return_tasks");
  await db.query("INSERT INTO ml_integration.return_tasks(seller_id,list_id,return_id,claim_id) VALUES('1','2','3','4')");
  await expect(db.query("INSERT INTO ml_integration.return_tasks(seller_id,list_id,return_id,claim_id) VALUES('1','2','3','4')")).rejects.toMatchObject({code:"23505"});
 }finally{await db.end();delete (globalThis as typeof globalThis & {mlPool?:pg.Pool}).mlPool;}
},20000);
