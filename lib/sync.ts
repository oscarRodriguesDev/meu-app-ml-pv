import type { DB } from "./db";
import { config } from "./config";
import { account, mlClient } from "./oauth";
import { discoverClaims, returnClaimIds, returnSchema, type MLGet, type ReturnData } from "./mercado";
import { clickupClient, marker, taskContent, findTask, type Clickup, type Task } from "./clickup";
import { ApiError } from "./http";
type Mapping = { task_id: string | null; content_hash: string | null; creation_uncertain: boolean };
// Called under the fenced Supabase lease. Committed intents survive a killed process.
export async function upsertReturn(db: DB, clickup: Clickup, tasks: Task[], seller: string, list: string, claim: string, value: ReturnData) {
  const key = { seller_id: seller, list_id: list, return_id: value.id, claim_id: claim };
  const existing = await db.call<Mapping | null>("mapping_get", key);
  const match = findTask(tasks, marker(seller, value.id));
  if (existing?.task_id && match && existing.task_id !== match.id) throw new Error("CLICKUP_MAPPING_CONFLICT");
  let taskId = existing?.task_id ?? match?.id;
  const { body, digest } = taskContent(seller, claim, value);
  if (!taskId) {
    if (existing?.creation_uncertain) throw new Error("CLICKUP_CREATE_UNCERTAIN");
    await db.call("mapping_reserve", key);
    await db.assertLease();
    // Never retry this POST. A timeout, malformed response, crash, or failed DB write is reconciled on the next run.
    const task = await clickup.create(body); taskId = task.id;
    tasks.push({ id: taskId, ...body });
  } else if (existing?.content_hash !== digest || !existing?.task_id) {
    // A deleted/inaccessible mapped task is an error; do not create a replacement automatically.
    await db.assertLease();
    await clickup.update(taskId, body);
  }
  await db.call("mapping_save", { ...key, task_id: taskId, content_hash: digest });
}
export function errorCode(error: unknown) {
  if (error instanceof ApiError) return error.message;
  const message = error instanceof Error ? error.message : "";
  return /^(ML|OAUTH|CLICKUP|SYNC|CONFIG|SUPABASE)_[A-Z0-9_]+$/.test(message) ? message : "SYNC_INTERNAL_ERROR";
}
export async function synchronize(db: DB, dependencies?: { get: MLGet; clickup: Clickup }) {
  const run = await db.call<string>("run_start");
  let processed = 0;
  try {
    const c = config(); const seller = await account(db); const until = new Date();
    const from = seller.checkpoint ? new Date(new Date(seller.checkpoint).getTime() - 15 * 60000) : new Date(c.ML_SYNC_FROM);
    const get = dependencies?.get ?? mlClient(db); const clickup = dependencies?.clickup ?? clickupClient();
    const claims = await discoverClaims(get, seller.seller_id, from, until);
    const candidates = new Set(await returnClaimIds(get, claims));
    // Shipment/return updates can occur without updating the claim timestamp.
    const known = await db.call<string[]>("known_claims", { seller_id: seller.seller_id, list_id: c.CLICKUP_LIST_ID });
    for (const claim of known) candidates.add(claim);
    const tasks = await clickup.allTasks(); const seen = new Set<string>(); const failures: string[] = [];
    for (const claim of candidates) {
      try {
        const value = returnSchema.parse(await get(`/post-purchase/v2/claims/${claim}/returns`));
        if (seen.has(value.id)) continue;
        await upsertReturn(db, clickup, tasks, seller.seller_id, c.CLICKUP_LIST_ID, claim, value);
        seen.add(value.id); processed++;
      } catch (error) { failures.push(errorCode(error)); }
    }
    if (failures.length) throw new Error(failures[0]);
    await db.call("checkpoint_save", { checkpoint: until.toISOString() });
    await db.call("run_finish", { id: run, status: "success", processed });
    return { status: "success", processed };
  } catch (error) {
    const code = errorCode(error);
    await db.call("run_finish", { id: run, status: "failed", processed, error_code: code });
    throw error;
  }
}
