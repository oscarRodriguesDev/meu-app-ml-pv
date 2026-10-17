import type { DB } from "./db";
import { config } from "./config";
import { account, mlClient } from "./oauth";
import { discoverClaims, returnClaimIds, returnSchema, type MLGet, type ReturnData } from "./mercado";
import { clickupClient, marker, taskContent, findTask, type Clickup, type Task } from "./clickup";
import { ApiError } from "./http";
type Mapping = { task_id: string | null; content_hash: string | null; creation_uncertain: boolean };
// Called under the global PostgreSQL lock. Autocommit intents survive a killed process.
export async function upsertReturn(db: DB, clickup: Clickup, tasks: Task[], seller: string, list: string, claim: string, value: ReturnData) {
  const key = [seller, list, value.id];
  const existing = (await db.query<Mapping>("SELECT task_id,content_hash,creation_uncertain FROM ml_integration.return_tasks WHERE seller_id=$1 AND list_id=$2 AND return_id=$3", key)).rows[0];
  const match = findTask(tasks, marker(seller, value.id));
  if (existing?.task_id && match && existing.task_id !== match.id) throw new Error("CLICKUP_MAPPING_CONFLICT");
  let taskId = existing?.task_id ?? match?.id;
  const { body, digest } = taskContent(seller, claim, value);
  if (!taskId) {
    if (existing?.creation_uncertain) throw new Error("CLICKUP_CREATE_UNCERTAIN");
    await db.query(`INSERT INTO ml_integration.return_tasks(seller_id,list_id,return_id,claim_id,creation_uncertain) VALUES($1,$2,$3,$4,true)`, [...key, claim]);
    // Never retry this POST. A timeout, malformed response, crash, or failed DB write is reconciled on the next run.
    const task = await clickup.create(body); taskId = task.id;
    tasks.push({ id: taskId, ...body });
  } else if (existing?.content_hash !== digest || !existing?.task_id) {
    // A deleted/inaccessible mapped task is an error; do not create a replacement automatically.
    await clickup.update(taskId, body);
  }
  await db.query(`INSERT INTO ml_integration.return_tasks(seller_id,list_id,return_id,claim_id,task_id,content_hash,creation_uncertain)
    VALUES($1,$2,$3,$4,$5,$6,false) ON CONFLICT(seller_id,list_id,return_id) DO UPDATE
    SET claim_id=excluded.claim_id,task_id=excluded.task_id,content_hash=excluded.content_hash,creation_uncertain=false,updated_at=now()`, [...key, claim, taskId, digest]);
}
export function errorCode(error: unknown) {
  if (error instanceof ApiError) return error.message;
  const message = error instanceof Error ? error.message : "";
  return /^(ML|OAUTH|CLICKUP|SYNC|CONFIG)_[A-Z0-9_]+$/.test(message) ? message : "SYNC_INTERNAL_ERROR";
}
export async function synchronize(db: DB, dependencies?: { get: MLGet; clickup: Clickup }) {
  const run = (await db.query<{id: string}>("INSERT INTO ml_integration.sync_runs DEFAULT VALUES RETURNING id")).rows[0].id;
  let processed = 0;
  try {
    const c = config(); const seller = await account(db); const until = new Date();
    const from = seller.checkpoint ? new Date(new Date(seller.checkpoint).getTime() - 15 * 60000) : new Date(c.ML_SYNC_FROM);
    const get = dependencies?.get ?? mlClient(db); const clickup = dependencies?.clickup ?? clickupClient();
    const claims = await discoverClaims(get, seller.seller_id, from, until);
    const candidates = new Set(await returnClaimIds(get, claims));
    // Shipment/return updates can occur without updating the claim timestamp.
    const known = await db.query<{claim_id: string}>("SELECT DISTINCT claim_id FROM ml_integration.return_tasks WHERE seller_id=$1 AND list_id=$2", [seller.seller_id, c.CLICKUP_LIST_ID]);
    for (const row of known.rows) candidates.add(row.claim_id);
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
    await db.query("UPDATE ml_integration.ml_account SET checkpoint=$1 WHERE singleton=true", [until]);
    await db.query("UPDATE ml_integration.sync_runs SET status='success',finished_at=now(),processed=$2 WHERE id=$1", [run, processed]);
    return { status: "success", processed };
  } catch (error) {
    const code = errorCode(error);
    await db.query("UPDATE ml_integration.sync_runs SET status='failed',finished_at=now(),processed=$2,error_code=$3 WHERE id=$1", [run, processed, code]);
    throw error;
  }
}
