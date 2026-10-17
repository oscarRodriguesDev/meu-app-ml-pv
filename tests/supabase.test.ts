import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { database as runtimeDatabase, rpcTransport, withLock, type Transport } from "../lib/db";
import { database, testEnv } from "./setup";
import { supabaseConfig } from "../lib/config";
beforeEach(testEnv);
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it("uses HTTPS RPC with the secret only in apikey, without DATABASE_URL",async()=>{
 const fetchMock=vi.fn().mockResolvedValue(Response.json({data:{connected:false}}));vi.stubGlobal("fetch",fetchMock);
 expect(await rpcTransport("status_get",{list_id:"901717874275"},null)).toEqual({connected:false});
 expect(fetchMock.mock.calls[0][0]).toBe("https://test.supabase.co/rest/v1/rpc/ml_service");
 const init=fetchMock.mock.calls[0][1];expect(init.headers.apikey).toBe("sb_secret_test");expect(init.headers.Authorization).toBeUndefined();
 expect(JSON.parse(init.body)).toEqual({p_operation:"status_get",p_payload:{list_id:"901717874275"},p_lock_token:null});
 expect(process.env.DATABASE_URL).toBeUndefined();
});
it("keeps publishable/JWKS optional and does not accept publishable as the server key",()=>{
 delete process.env.SUPABASE_PUBLISHABLE_KEY;delete process.env.SUPABASE_JWKS_URL;
 expect(supabaseConfig().SUPABASE_JWKS_URL).toBe("https://test.supabase.co/auth/v1/.well-known/jwks.json");
 process.env.SUPABASE_SECRET_KEY="sb_publishable_test";expect(()=>supabaseConfig()).toThrow("CONFIG_SUPABASE_INVALID");
});
it("does not replay an ambiguous RPC POST and sanitizes server error messages",async()=>{
 const fetchMock=vi.fn().mockRejectedValue(new Error("secret-upstream"));vi.stubGlobal("fetch",fetchMock);
 await expect(rpcTransport("lease_acquire",{},randomUUID())).rejects.toThrow("SUPABASE_NETWORK_ERROR");expect(fetchMock).toHaveBeenCalledTimes(1);
 fetchMock.mockResolvedValue(Response.json({error:"sensitive content"}));
 await expect(rpcTransport("account_get",{},randomUUID())).rejects.toThrow("SUPABASE_RPC_ERROR");
});
it("fences expired owners, prevents stealing a live lease, and preserves uncertain intents",async()=>{
 const store=await database();
 try{
  const next=runtimeDatabase(store.transport,randomUUID());
  expect(await next.call("lease_acquire")).toBe(false);
  await store.db.call("mapping_reserve",{seller_id:"42",list_id:"1",return_id:"88",claim_id:"55"});
  await store.sql.query("UPDATE ml_integration.sync_lease SET expires_at=clock_timestamp()-interval '1 second'");
  await expect(store.db.assertLease()).rejects.toThrow("SYNC_LOCK_LOST");
  expect(await next.call("lease_acquire")).toBe(true);
  expect(await store.db.call("lease_release")).toBe(false);
  await expect(store.db.call("checkpoint_save",{checkpoint:new Date().toISOString()})).rejects.toThrow("SYNC_LOCK_LOST");
  await expect(next.call("mapping_reserve",{seller_id:"42",list_id:"1",return_id:"88",claim_id:"55"})).rejects.toThrow("CLICKUP_CREATE_UNCERTAIN");
  expect(await next.call("mapping_get",{seller_id:"42",list_id:"1",return_id:"88"})).toMatchObject({creation_uncertain:true,task_id:null});
 }finally{await store.engine.close();}
});
it("stops subsequent work after heartbeat failure and releases only its lease",async()=>{
 vi.useFakeTimers();const operations:string[]=[];
 const transport:Transport=async<T>(operation: import("../lib/db").Operation)=>{operations.push(operation);return (operation==="lease_acquire") as T;};
 await withLock(async db=>{
   await vi.advanceTimersByTimeAsync(20000);
   await expect(db.call("account_get")).rejects.toThrow("SYNC_LOCK_LOST");
 },transport);
 expect(operations).toEqual(["lease_acquire","lease_renew","lease_release"]);
});
