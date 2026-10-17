import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/oauth/start/route";
import { testEnv } from "./setup";
beforeEach(testEnv);
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const req=()=>new NextRequest("https://app.example/api/oauth/start",{headers:{Authorization:`Bearer ${process.env.ADMIN_SECRET}`}});
it("starts OAuth even before ClickUp and cron variables have been configured",async()=>{
 delete process.env.CLICKUP_API_TOKEN;delete process.env.CRON_SECRET;process.env.ML_SYNC_FROM="not-configured-yet";
 const fetchMock=vi.fn().mockResolvedValue(Response.json({data:null}));vi.stubGlobal("fetch",fetchMock);
 const response=await GET(req());expect(response.status).toBe(307);
 const url=new URL(response.headers.get("location")!);expect(url.origin).toBe("https://auth.mercadolivre.com.br");
 expect(url.searchParams.get("code_challenge_method")).toBe("S256");expect(fetchMock).toHaveBeenCalledTimes(1);
 expect(JSON.parse(fetchMock.mock.calls[0][1].body).p_operation).toBe("oauth_begin");
});
it("reports missing variable names without logging or returning configured secrets",async()=>{
 delete process.env.TOKEN_ENCRYPTION_KEY;delete process.env.ML_REDIRECT_URI;
 const log=vi.spyOn(console,"error").mockImplementation(()=>{});
 const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
 const response=await GET(req());expect(response.status).toBe(503);expect(response.headers.get("cache-control")).toBe("no-store");
 const body=await response.json();expect(body).toMatchObject({error:"OAUTH_START_FAILED",cause:"CONFIG_OAUTH_INVALID"});
 expect(body.issues).toEqual(expect.arrayContaining([{variable:"TOKEN_ENCRYPTION_KEY",reason:"missing"},{variable:"ML_REDIRECT_URI",reason:"missing"}]));
 const output=JSON.stringify([body,log.mock.calls]);
 for(const value of [process.env.ADMIN_SECRET,process.env.ML_CLIENT_SECRET,process.env.SUPABASE_SECRET_KEY]) expect(output).not.toContain(value);
 expect(fetchMock).not.toHaveBeenCalled();
});
it("distinguishes malformed encryption keys from missing settings",async()=>{
 process.env.TOKEN_ENCRYPTION_KEY="invalid-sensitive-test-value";
 const log=vi.spyOn(console,"error").mockImplementation(()=>{});
 const response=await GET(req());const body=await response.json();
 expect(body.issues).toContainEqual({variable:"TOKEN_ENCRYPTION_KEY",reason:"invalid"});
 expect(JSON.stringify([body,log.mock.calls])).not.toContain("invalid-sensitive-test-value");
});
it.each([401,403,404])("identifies Supabase HTTP %s instead of hiding every failure",async status=>{
 const log=vi.spyOn(console,"error").mockImplementation(()=>{});
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("private-upstream-message",{status})));
 const response=await GET(req());const body=await response.json();
 expect(body.cause).toBe(`SUPABASE_HTTP_${status}`);expect(body.action).toContain(status===404?"install.sql":"SUPABASE_SECRET_KEY");
 expect(JSON.stringify([body,log.mock.calls])).not.toContain("private-upstream-message");
});
it("keeps unexpected exceptions private",async()=>{
 const log=vi.spyOn(console,"error").mockImplementation(()=>{});
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:()=>{throw new Error("private-token-value");}}));
 const response=await GET(req());const body=await response.json();
 expect(body.cause).toBe("SUPABASE_INVALID_JSON");expect(JSON.stringify([body,log.mock.calls])).not.toContain("private-token-value");
});
it("does not call Supabase before successful admin authentication",async()=>{
 const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
 const response=await GET(new NextRequest("https://app.example/api/oauth/start"));
 expect(response.status).toBe(401);expect(response.headers.get("www-authenticate")).toContain("Basic");expect(fetchMock).not.toHaveBeenCalled();
});
