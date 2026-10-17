import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { request } from "../lib/http";
import { isAdmin, isCron } from "../lib/auth";
import { config } from "../lib/config";
import { GET as start } from "../app/api/oauth/start/route";
import { GET as cron } from "../app/api/cron/sync/route";
import { POST as manual } from "../app/api/sync/route";
import { GET as mlDiagnostics } from "../app/api/diagnostics/ml/route";
import { GET as status } from "../app/api/status/route";
import { NextRequest } from "next/server";
import { testEnv } from "./setup";
beforeEach(testEnv);afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it("separates admin authentication from cron authentication",()=>{
 const c=config();expect(isAdmin(new Headers({authorization:`Basic ${Buffer.from(`admin:${c.ADMIN_SECRET}`).toString("base64")}`}),c.ADMIN_SECRET)).toBe(true);
 expect(isAdmin(new Headers({authorization:`Bearer ${c.ADMIN_SECRET}`}),c.ADMIN_SECRET)).toBe(true);
 expect(isCron(new Headers({authorization:`Bearer ${c.ADMIN_SECRET}`}),c.CRON_SECRET)).toBe(false);
 expect(isCron(new Headers({authorization:`Bearer ${c.CRON_SECRET}`}),c.CRON_SECRET)).toBe(true);
});
it("protects all administrative and scheduled routes before touching the database",async()=>{
 expect((await start(new NextRequest("https://app.example/api/oauth/start"))).status).toBe(401);
 expect((await cron(new Request("https://app.example/api/cron/sync"))).status).toBe(401);
 expect((await manual(new Request("https://app.example/api/sync",{method:"POST"}))).status).toBe(401);
 expect((await status(new Request("https://app.example/api/status"))).status).toBe(401);
 expect((await mlDiagnostics(new Request("https://app.example/api/diagnostics/ml"))).status).toBe(401);
});
it("never replays creation or OAuth POST requests",async()=>{
 const fetchMock=vi.fn().mockResolvedValue(new Response("secret upstream error",{status:503}));vi.stubGlobal("fetch",fetchMock);
 await expect(request("CLICKUP","https://api.clickup.com/api/v2/list/1/task",{method:"POST"})).rejects.toThrow("CLICKUP_HTTP_503");expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("retries rate-limited idempotent requests",async()=>{
 vi.useFakeTimers(); const fetchMock=vi.fn().mockResolvedValueOnce(new Response(null,{status:429,headers:{"Retry-After":"1"}})).mockResolvedValueOnce(Response.json({ok:true}));vi.stubGlobal("fetch",fetchMock);
 const result=request("ML","https://api.mercadolibre.com/users/me");await vi.runAllTimersAsync();expect(await result).toEqual({ok:true});expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("rejects invalid production redirects and shared secrets",()=>{
 process.env.ML_REDIRECT_URI="https://app.example/wrong";expect(()=>config()).toThrow("REDIRECT_URI_INVALID");
 process.env.ML_REDIRECT_URI="https://app.example/api/oauth/callback";process.env.CRON_SECRET=process.env.ADMIN_SECRET;expect(()=>config()).toThrow("SECRETS_MUST_DIFFER");
});
