import { afterEach, expect, it, vi } from "vitest";
import { ApiError, request } from "../lib/http";
import { claimsSearchParameters } from "../lib/mercado";
import { diagnoseClaimsSearch } from "../lib/ml-diagnostics";
import { syncFailureDiagnostic } from "../lib/diagnostics";
afterEach(()=>vi.unstubAllGlobals());
it("sends milliseconds and an explicit UTC offset while preserving the complete window",()=>{
 const from=new Date("2000-01-01T00:00:00.000Z"),until=new Date("2026-10-17T20:28:36.780Z");
 const params=claimsSearchParameters("42",from.getTime(),until.getTime(),"opened");
 expect(params.get("range")).toBe("last_updated:after:2000-01-01T00:00:00.000+00:00,before:2026-10-17T20:28:36.780+00:00");
 expect(params.toString()).toContain("%2B00%3A00");expect(params.get("players.user_id")).toBe("42");expect(params.get("players.role")).toBe("respondent");
});
it("logs fixed categories without upstream text, tokens, query values or resource IDs",async()=>{
 const token="APP_USR_PRIVATE_TOKEN",email="private@example.com";
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({error:"bad_request",message:`Invalid date range for ${email}; ${token}`},{status:400})));
 let failure:unknown;try{await request("ML","https://api.mercadolibre.com/post-purchase/v1/claims/search?players.user_id=987654321&range=private-value",{headers:{Authorization:`Bearer ${token}`}});}catch(error){failure=error;}
 expect(failure).toBeInstanceOf(ApiError);expect(syncFailureDiagnostic(failure)).toMatchObject({operation:"claims_search",reason:"date_range",upstreamCode:"bad_request"});
 const safe=JSON.stringify([failure,syncFailureDiagnostic(failure)]);
 for(const value of [token,email,"987654321","private-value","Invalid date"]) expect(safe).not.toContain(value);
});
it("identifies a return lookup without revealing the claim ID",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({error:"bad_request",message:"No return found"},{status:400})));
 let failure:unknown;try{await request("ML","https://api.mercadolibre.com/post-purchase/v2/claims/999999/returns");}catch(error){failure=error;}
 expect(syncFailureDiagnostic(failure)).toMatchObject({operation:"claim_returns",reason:"return_not_available"});expect(JSON.stringify(failure)).not.toContain("999999");
});
it("discards oversized error bodies and never replays a rejected 400",async()=>{
 const fetchMock=vi.fn().mockResolvedValue(Response.json({error:"bad_request",message:"x".repeat(9000)},{status:400}));vi.stubGlobal("fetch",fetchMock);
 let failure:unknown;try{await request("ML","https://api.mercadolibre.com/post-purchase/v1/claims/search");}catch(error){failure=error;}
 expect(failure).toMatchObject({message:"ML_HTTP_400",details:{operation:"claims_search"}});expect((failure as ApiError).details?.upstreamCode).toBeUndefined();expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("isolates seller filtering, ranges and ordering without returning buyer data",async()=>{
 const get=vi.fn(async(path:string)=>{
  if(path==="/users/me") return {id:42};
  const params=new URL(path,"https://example.com").searchParams;
  if(params.has("range")) throw new ApiError("ML",400,{operation:"claims_search",reason:"date_range"});
  return {paging:{offset:0,limit:1,total:1},data:[{id:123,type:"return",privateBuyerData:"not-returned"}]};
 });
 const result=await diagnoseClaimsSearch(get,"42",new Date("2000-01-01T00:00:00.000Z"),new Date("2026-10-17T20:28:36.780Z"));
 expect(result.status).toBe("failed");expect(result.checks.map(check=>[check.check,check.ok])).toEqual([["account_identity",true],["seller_opened",true],["date_range_opened",false],["sort_and_page_opened",false],["seller_closed",true],["date_range_closed",false],["sort_and_page_closed",false]]);
 expect(get).toHaveBeenCalledTimes(7);expect(JSON.stringify(result)).not.toContain("not-returned");
});

it("returns redacted validation only to an explicitly requested diagnostic",async()=>{
 const token="private-token";
 vi.stubGlobal("fetch",vi.fn().mockImplementation(()=>Promise.resolve(Response.json({error:"invalid_params",message:`Invalid parameters: players.user_id=987654321; ${token}; admin@example.com; APP_USR-123-secret; https://private.example/token`},{status:400}))));
 let failure:unknown;
 try {await request("ML","https://api.mercadolibre.com/post-purchase/v1/claims/search?players.user_id=987654321",{headers:{Authorization:`Bearer ${token}`}},true);}catch(error){failure=error;}
 const error=failure as ApiError;
 expect(error.validationMessage).toContain("Invalid parameters");
 for(const secret of [token,"987654321","admin@example.com","APP_USR-123-secret","private.example"]) expect(error.validationMessage).not.toContain(secret);
 expect(error.details?.upstreamCode).toBe("invalid_params");
 expect(JSON.stringify(error)).not.toContain("Invalid parameters");expect(JSON.stringify(syncFailureDiagnostic(error))).not.toContain("Invalid parameters");
 try {await request("ML","https://api.mercadolibre.com/post-purchase/v1/claims/search");}catch(error){expect((error as ApiError).validationMessage).toBeUndefined();}
});
it("stops diagnostics if the token belongs to a different account",async()=>{
 const get=vi.fn(async()=>({id:99,email:"private@example.com"}));
 const result=await diagnoseClaimsSearch(get,"42",new Date("2026-01-01"),new Date("2026-01-02"));
 expect(result.checks).toEqual([{check:"account_identity",ok:false,error:"ML_SELLER_MISMATCH"}]);
 expect(get).toHaveBeenCalledTimes(1);expect(JSON.stringify(result)).not.toContain("private@example.com");
});

it("diagnoses the production queries with an explicit state on every search",async()=>{
 const result=await diagnoseClaimsSearch(async(path)=>{
  if(path==="/users/me") return {id:42};
  const params=new URL(path,"https://example.com").searchParams;
  if(!params.has("status")) throw new ApiError("ML",400,{operation:"claims_search",reason:"query_parameters"});
  expect(["opened","closed"]).toContain(params.get("status"));
  return {paging:{offset:0,limit:Number(params.get("limit")),total:0},data:[]};
 },"42",new Date("2026-01-01"),new Date("2026-01-02"));
 expect(result.status).toBe("ok");expect(result.checks).toHaveLength(7);
});
