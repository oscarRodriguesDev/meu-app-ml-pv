import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { DB } from "../lib/db";
import { database, sampleReturn, testEnv } from "./setup";
import { upsertReturn, synchronize } from "../lib/sync";
import { marker, type Clickup, type Task } from "../lib/clickup";
import { saveTokens } from "../lib/oauth";
import { ApiError } from "../lib/http";
let store: Awaited<ReturnType<typeof database>>; let clickup: Clickup; let tasks: Task[];
beforeEach(async()=>{testEnv();store=await database();tasks=[];clickup={allTasks:vi.fn(async()=>tasks),create:vi.fn(async()=>({id:"task-1"})),update:vi.fn(async()=>{})};});
afterEach(async()=>{await store.engine.close();});
const syncOne=()=>upsertReturn(store.db,clickup,tasks,"42","901717874275","55",sampleReturn);
it("creates once, skips unchanged content, and updates changed returns",async()=>{
  await syncOne(); await syncOne(); expect(clickup.create).toHaveBeenCalledTimes(1);expect(clickup.update).not.toHaveBeenCalled();
  await upsertReturn(store.db,clickup,tasks,"42","901717874275","55",{...sampleReturn,status:"delivered"});
  expect(clickup.update).toHaveBeenCalledTimes(1); expect(clickup.update).toHaveBeenCalledWith("task-1",expect.objectContaining({name:expect.stringContaining("delivered")}));
});
it("recovers an orphaned remote task without creating again",async()=>{
  tasks.push({id:"orphan",name:`Existing ${marker("42","88")}`});await syncOne();
  expect(clickup.create).not.toHaveBeenCalled();expect(clickup.update).toHaveBeenCalledWith("orphan",expect.anything());
});
it("records intent before POST, stops ambiguous retries, and reconciles on a later run",async()=>{
  vi.mocked(clickup.create).mockRejectedValueOnce(new Error("CLICKUP_NETWORK_ERROR"));
  await expect(syncOne()).rejects.toThrow("NETWORK_ERROR"); await expect(syncOne()).rejects.toThrow("CREATE_UNCERTAIN");expect(clickup.create).toHaveBeenCalledTimes(1);
  tasks.push({id:"remote-created",name:marker("42","88")}); await syncOne();
  expect((await store.sql.query("SELECT task_id,creation_uncertain FROM ml_integration.return_tasks")).rows[0]).toEqual({task_id:"remote-created",creation_uncertain:false});
});
it("reconciles a task created before a failed local commit",async()=>{
  let fail=true;const db: DB={ ...store.db, async call<T>(operation: import("../lib/db").Operation, payload?: import("../lib/db").Payload) {
    if(operation==="mapping_save"&&fail){fail=false;throw new Error("DB_WRITE_FAILED");}
    return store.db.call<T>(operation,payload);
  }};
  await expect(upsertReturn(db,clickup,tasks,"42","901717874275","55",sampleReturn)).rejects.toThrow("DB_WRITE_FAILED");
  await syncOne();expect(clickup.create).toHaveBeenCalledTimes(1);
});
it("fails when multiple remote tasks have the marker",async()=>{
  tasks.push({id:"a",name:marker("42","88")},{id:"b",name:marker("42","88")});
  await expect(syncOne()).rejects.toThrow("DUPLICATE_MARKER");expect(clickup.create).not.toHaveBeenCalled();
});
it("does not replace a deleted or inaccessible mapped task",async()=>{
  await syncOne();tasks.length=0;vi.mocked(clickup.update).mockRejectedValue(new Error("CLICKUP_HTTP_404"));
  await expect(upsertReturn(store.db,clickup,tasks,"42","901717874275","55",{...sampleReturn,status:"delivered"})).rejects.toThrow("404");expect(clickup.create).toHaveBeenCalledTimes(1);
});
it("runs end-to-end, retains checkpoints on failure and refreshes known returns",async()=>{
  await saveTokens(store.db,{access_token:"test",refresh_token:"test",user_id:"42",expires_in:3600});
  const get=vi.fn(async(path:string)=>path.includes("/search?")?{paging:{offset:0,limit:50,total:1},data:[{id:55,type:"return"}]}:sampleReturn);
  expect(await synchronize(store.db,{get,clickup})).toEqual({status:"success",processed:1});
  const before=(await store.sql.query("SELECT checkpoint FROM ml_integration.ml_account")).rows[0].checkpoint;
  vi.mocked(clickup.update).mockRejectedValueOnce(new Error("CLICKUP_HTTP_500"));
  const getChanged=vi.fn(async(path:string)=>path.includes("/search?")?{paging:{offset:0,limit:50,total:0},data:[]}:{...sampleReturn,status:"delivered"});
  await expect(synchronize(store.db,{get:getChanged,clickup})).rejects.toThrow("500");
  expect((await store.sql.query("SELECT checkpoint FROM ml_integration.ml_account")).rows[0].checkpoint).toEqual(before);
  await synchronize(store.db,{get:getChanged,clickup});expect(clickup.create).toHaveBeenCalledTimes(1);
  expect(getChanged).toHaveBeenCalledWith("/post-purchase/v2/claims/55/returns");
  expect((await store.sql.query("SELECT status FROM ml_integration.sync_runs ORDER BY id")).rows.map(r=>r.status)).toEqual(["success","failed","success"]);
});

it("preserves the ML operation and safe reason when a per-return lookup fails",async()=>{
  await saveTokens(store.db,{access_token:"test",refresh_token:"test",user_id:"42",expires_in:3600});
  const failure=new ApiError("ML",400,{operation:"claim_returns",reason:"return_not_available"});
  const get=vi.fn(async(path:string)=>{if(path.includes("/search?"))return {paging:{offset:0,limit:50,total:1},data:[{id:55,type:"return"}]};throw failure;});
  await expect(synchronize(store.db,{get,clickup})).rejects.toBe(failure);
  expect((await store.sql.query("SELECT checkpoint FROM ml_integration.ml_account")).rows[0].checkpoint).toBeNull();
  expect(clickup.create).not.toHaveBeenCalled();
});

it("syncs a return directly when its claim detail is unavailable",async()=>{
 await saveTokens(store.db,{access_token:"test",refresh_token:"test",user_id:"42",expires_in:3600});
 const get=vi.fn(async(path:string)=>{
  if(path.includes("/search?")) return {paging:{offset:0,limit:50,total:1},data:[{id:55,type:"mediations"}]};
  if(path==="/post-purchase/v1/claims/55") throw new ApiError("ML",404,{operation:"claim_detail"});
  if(path==="/post-purchase/v2/claims/55/returns") return sampleReturn;
  throw new Error("Unexpected request");
 });
 expect(await synchronize(store.db,{get,clickup})).toEqual({status:"success",processed:1});
 expect(clickup.create).toHaveBeenCalledTimes(1);
 expect((await store.sql.query("SELECT checkpoint FROM ml_integration.ml_account")).rows[0].checkpoint).not.toBeNull();
});
it("retains the checkpoint if both claim detail and return are unavailable",async()=>{
 await saveTokens(store.db,{access_token:"test",refresh_token:"test",user_id:"42",expires_in:3600});
 const failure=new ApiError("ML",404,{operation:"claim_returns"});
 const get=vi.fn(async(path:string)=>{
  if(path.includes("/search?")) return {paging:{offset:0,limit:50,total:1},data:[{id:55,type:"mediations"}]};
  if(path==="/post-purchase/v1/claims/55") throw new ApiError("ML",404,{operation:"claim_detail"});
  throw failure;
 });
 await expect(synchronize(store.db,{get,clickup})).rejects.toBe(failure);
 expect(clickup.create).not.toHaveBeenCalled();
 expect((await store.sql.query("SELECT checkpoint FROM ml_integration.ml_account")).rows[0].checkpoint).toBeNull();
});
