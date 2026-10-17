import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { clickupClient } from "../lib/clickup";
import { testEnv } from "./setup";
beforeEach(testEnv);afterEach(()=>vi.unstubAllGlobals());
it("includes closed and archived tasks and traverses every page",async()=>{
 const fetchMock=vi.fn(async(input:string)=>{const url=new URL(input);expect(url.searchParams.get("include_closed")).toBe("true");expect(url.searchParams.get("include_timl")).toBe("true");const page=Number(url.searchParams.get("page"));const archived=url.searchParams.get("archived");return Response.json({tasks:[{id:`${archived}-${page}`,name:"task"}],last_page:page===1});});
 vi.stubGlobal("fetch",fetchMock);
 expect(await clickupClient().allTasks()).toHaveLength(4);expect(fetchMock).toHaveBeenCalledTimes(4);
});
it("does not send ClickUp status names or user fields in task updates",async()=>{
 const fetchMock=vi.fn().mockResolvedValue(Response.json({id:"x"}));vi.stubGlobal("fetch",fetchMock);
 await clickupClient().update("x",{name:"Devolução",description:"Managed description"});
 expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({name:"Devolução",description:"Managed description"});
 expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
});
