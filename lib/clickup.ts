import { z } from "zod";
import { config } from "./config";
import { hash } from "./crypto";
import { request } from "./http";
import type { ReturnData } from "./mercado";
const taskSchema = z.object({ id: z.string().min(1), name: z.string(), description: z.string().nullish(), markdown_description: z.string().nullish() });
export type Task = z.infer<typeof taskSchema>;
export function marker(seller: string, returnId: string) { return `[ml-return:${seller}:${returnId}]`; }
export function taskContent(seller: string, claim: string, value: ReturnData) {
  const key = marker(seller, value.id);
  const body = { name: `Devolução #${value.id} · ${value.status} ${key}`, description: [key,
    `Devolução Mercado Livre: ${value.id}`, `Reclamação: ${claim}`, `Vendedor: ${seller}`, `Status: ${value.status}`,
    `Subtipo: ${value.subtype ?? "—"}`, `Dinheiro: ${value.status_money ?? "—"}`, `Atualizada em: ${value.last_updated ?? "—"}`,
    ...(value.orders ?? []).map(o => `Pedido: ${o.order_id} | Item: ${o.item_id ?? "—"} | Quantidade a devolver: ${o.return_quantity ?? "—"}`),
    ...(value.shipments ?? []).map(s => `Envio: ${s.shipment_id ?? "—"} | Status: ${s.status ?? "—"} | Rastreio: ${s.tracking_number ?? "—"}`),
  ].join("\n") };
  return { body, digest: hash(JSON.stringify(body)) };
}
export function clickupClient() {
  const c = config();
  const call = (path: string, method = "GET", body?: unknown) => request("CLICKUP", `https://api.clickup.com/api/v2${path}`, {
    method, headers: { Authorization: c.CLICKUP_API_TOKEN, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  return {
    async allTasks() {
      const tasks = new Map<string, Task>();
      for (const archived of [false, true]) {
        for (let page = 0; ; page++) {
          const result = z.object({ tasks: z.array(taskSchema), last_page: z.boolean().optional() }).parse(await call(`/list/${c.CLICKUP_LIST_ID}/task?include_closed=true&include_timl=true&subtasks=true&archived=${archived}&page=${page}&include_markdown_description=true`));
          let fresh = 0; for (const task of result.tasks) { if (!tasks.has(task.id)) fresh++; tasks.set(task.id, task); }
          if (result.last_page === true || (result.last_page === undefined && result.tasks.length < 100)) break;
          if (!result.tasks.length || (page > 0 && !fresh) || page >= 10000) throw new Error("CLICKUP_PAGINATION_INVALID");
        }
      }
      return [...tasks.values()];
    },
    async create(body: { name: string; description: string }) { return taskSchema.pick({id:true}).parse(await call(`/list/${c.CLICKUP_LIST_ID}/task`, "POST", body)); },
    async update(id: string, body: {name: string; description: string}) { await call(`/task/${encodeURIComponent(id)}`, "PUT", body); },
  };
}
export type Clickup = ReturnType<typeof clickupClient>;
export function findTask(tasks: Task[], key: string) {
  const matches = tasks.filter(t => t.name.includes(key) || t.description?.includes(key) || t.markdown_description?.includes(key));
  if (matches.length > 1) throw new Error("CLICKUP_DUPLICATE_MARKER");
  return matches[0];
}
