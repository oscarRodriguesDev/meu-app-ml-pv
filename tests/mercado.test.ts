import { it, expect, vi } from "vitest";
import { discoverClaims, returnClaimIds, returnSchema } from "../lib/mercado";
const from=new Date("2026-01-01T00:00:00.000Z"),until=new Date("2026-01-02T00:00:00.000Z");
it("paginates claims and scopes searches to the seller",async()=>{
 const get=vi.fn(async(path:string)=>{const p=new URL(path,"https://example.com").searchParams;expect(p.get("players.user_id")).toBe("42");expect(p.get("players.role")).toBe("respondent");const offset=Number(p.get("offset"));return {paging:{offset,limit:50,total:51},data:Array.from({length:offset?1:50},(_,i)=>({id:offset+i+1,type:"return"}))};});
 expect(await discoverClaims(get,"42",from,until)).toHaveLength(51);expect(get).toHaveBeenCalledTimes(2);
});
it("splits a dense range without approaching the 10000 offset limit",async()=>{
 let first=true;const get=vi.fn(async()=>{if(first){first=false;return {paging:{offset:0,limit:50,total:12000},data:[]};}return {paging:{offset:0,limit:50,total:1},data:[{id:1,type:"return"}]};});
 expect(await discoverClaims(get,"42",from,until)).toHaveLength(1);expect(get).toHaveBeenCalledTimes(3);
});
it("rejects truncated pagination instead of committing an incomplete checkpoint",async()=>{
 await expect(discoverClaims(async()=>({paging:{offset:0,limit:50,total:5},data:[]}),"42",from,until)).rejects.toThrow("PAGINATION_INCOMPLETE");
});
it("discovers automatic returns and mediations with related returns",async()=>{
 const get=vi.fn(async()=>({id:3,type:"mediations",related_entities:["return"]}));
 expect(await returnClaimIds(get,[{id:"1",type:"return"},{id:"2",type:"mediations",related_entities:["return"]},{id:"3"},{id:"4",type:"mediations",related_entities:[]}])).toEqual(["1","2","3"]);
 expect(get).toHaveBeenCalledTimes(1);
});
it("rejects unsafe numeric IDs",()=>{expect(()=>returnSchema.parse({id:Number.MAX_SAFE_INTEGER+1,status:"shipped"})).toThrow();});
