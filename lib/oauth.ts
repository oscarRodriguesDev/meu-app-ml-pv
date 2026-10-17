import { z } from "zod";
import { config } from "./config";
import { decrypt, encrypt, hash, random } from "./crypto";
import type { DB } from "./db";
import { ApiError, request } from "./http";
const id = z.union([z.string().regex(/^\d+$/), z.number().int().safe().nonnegative().transform(String)]);
export const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().positive(), user_id: id });
export type Tokens = z.infer<typeof tokenSchema>;
type Account = { seller_id: string; tokens_encrypted: string; expires_at: Date; refresh_pending: boolean; checkpoint: Date | null };
export async function account(db: DB): Promise<Account> { const row = (await db.query<Account>("SELECT * FROM ml_integration.ml_account WHERE singleton = true")).rows[0]; if (!row) throw new Error("ML_NOT_CONNECTED"); return row; }
export async function beginOAuth(db: DB) {
  const c = config(); const state = random(); const browser = random(); const verifier = random();
  await db.query("DELETE FROM ml_integration.oauth_states WHERE expires_at < now()");
  await db.query("INSERT INTO ml_integration.oauth_states(state_hash, browser_hash, verifier_encrypted, expires_at) VALUES ($1,$2,$3,now()+interval '10 minutes')", [hash(state), hash(browser), encrypt(verifier, c.TOKEN_ENCRYPTION_KEY)]);
  const url = new URL("https://auth.mercadolivre.com.br/authorization");
  url.search = new URLSearchParams({ response_type: "code", client_id: c.ML_CLIENT_ID, redirect_uri: c.ML_REDIRECT_URI,
    state, code_challenge: hash(verifier), code_challenge_method: "S256" }).toString();
  return { url: url.toString(), browser };
}
export async function consumeState(db: DB, state: string, browser: string) {
  if (!state || !browser || state.length > 200 || browser.length > 200) throw new Error("OAUTH_STATE_INVALID");
  const row = (await db.query<{ verifier_encrypted: string }>("DELETE FROM ml_integration.oauth_states WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING verifier_encrypted", [hash(state), hash(browser)])).rows[0];
  if (!row) throw new Error("OAUTH_STATE_INVALID");
  return decrypt<string>(row.verifier_encrypted, config().TOKEN_ENCRYPTION_KEY);
}
async function tokenRequest(fields: Record<string, string>) {
  const c = config();
  return tokenSchema.parse(await request("ML_TOKEN", "https://api.mercadolibre.com/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.ML_CLIENT_ID, client_secret: c.ML_CLIENT_SECRET, ...fields }),
  }));
}
export async function saveTokens(db: DB, tokens: Tokens) {
  const c = config();
  const old = (await db.query<{seller_id: string}>("SELECT seller_id FROM ml_integration.ml_account WHERE singleton=true")).rows[0];
  if ((c.ML_SELLER_ID && tokens.user_id !== c.ML_SELLER_ID) || (old && old.seller_id !== tokens.user_id)) throw new Error("ML_SELLER_MISMATCH");
  await db.query(`INSERT INTO ml_integration.ml_account(singleton,seller_id,tokens_encrypted,expires_at) VALUES(true,$1,$2,$3)
    ON CONFLICT(singleton) DO UPDATE SET tokens_encrypted=excluded.tokens_encrypted,expires_at=excluded.expires_at,refresh_pending=false,updated_at=now()`,
  [tokens.user_id, encrypt(tokens, c.TOKEN_ENCRYPTION_KEY), new Date(Date.now() + tokens.expires_in * 1000)]);
}
export async function finishOAuth(db: DB, code: string, verifier: string) {
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config().ML_REDIRECT_URI });
  await saveTokens(db, tokens);
}
// All callers must hold withLock, including the callback. Rotating refresh tokens are single-use.
export async function accessToken(db: DB, force = false) {
  const row = await account(db); const c = config();
  if (row.refresh_pending) throw new Error("ML_REAUTH_REQUIRED");
  const tokens = decrypt<Tokens>(row.tokens_encrypted, c.TOKEN_ENCRYPTION_KEY);
  if (!force && new Date(row.expires_at).getTime() > Date.now() + 120000) return tokens.access_token;
  await db.query("UPDATE ml_integration.ml_account SET refresh_pending=true WHERE singleton=true");
  const next = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  await saveTokens(db, next);
  return next.access_token;
}
export function mlClient(db: DB) {
  return async (path: string) => {
    let token = await accessToken(db);
    try { return await request("ML", `https://api.mercadolibre.com${path}`, { headers: { Authorization: `Bearer ${token}` } }); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      token = await accessToken(db, true);
      return request("ML", `https://api.mercadolibre.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
    }
  };
}
