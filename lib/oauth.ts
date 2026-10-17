import { z } from "zod";
import { oauthConfig as config } from "./config";
import { decrypt, encrypt, hash, random } from "./crypto";
import type { DB } from "./db";
import { ApiError, request } from "./http";
const id = z.union([z.string().regex(/^\d+$/), z.number().int().safe().nonnegative().transform(String)]);
export const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().positive(), user_id: id });
export type Tokens = z.infer<typeof tokenSchema>;
type Account = { seller_id: string; tokens_encrypted: string; expires_at: string; refresh_pending: boolean; checkpoint: string | null };
export async function account(db: DB): Promise<Account> { const row = await db.call<Account | null>("account_get"); if (!row) throw new Error("ML_NOT_CONNECTED"); return row; }
export async function beginOAuth(db: DB) {
  const c = config(); const state = random(); const browser = random(); const verifier = random();
  await db.call("oauth_begin", { state_hash: hash(state), browser_hash: hash(browser), verifier_encrypted: encrypt(verifier, c.TOKEN_ENCRYPTION_KEY) });
  const url = new URL("https://auth.mercadolivre.com.br/authorization");
  url.search = new URLSearchParams({ response_type: "code", client_id: c.ML_CLIENT_ID, redirect_uri: c.ML_REDIRECT_URI,
    state, code_challenge: hash(verifier), code_challenge_method: "S256" }).toString();
  return { url: url.toString(), browser };
}
export async function consumeState(db: DB, state: string, browser: string) {
  if (!state || !browser || state.length > 200 || browser.length > 200) throw new Error("OAUTH_STATE_INVALID");
  const value = await db.call<string | null>("oauth_consume", { state_hash: hash(state), browser_hash: hash(browser) });
  if (!value) throw new Error("OAUTH_STATE_INVALID");
  return decrypt<string>(value, config().TOKEN_ENCRYPTION_KEY);
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
  const old = await db.call<Account | null>("account_get");
  if ((c.ML_SELLER_ID && tokens.user_id !== c.ML_SELLER_ID) || (old && old.seller_id !== tokens.user_id)) throw new Error("ML_SELLER_MISMATCH");
  await db.call("account_save", { seller_id: tokens.user_id, tokens_encrypted: encrypt(tokens, c.TOKEN_ENCRYPTION_KEY), expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString() });
}
export async function finishOAuth(db: DB, code: string, verifier: string) {
  await db.assertLease();
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config().ML_REDIRECT_URI });
  await saveTokens(db, tokens);
}
// All callers must hold withLock, including the callback. Rotating refresh tokens are single-use.
export async function accessToken(db: DB, force = false) {
  const row = await account(db); const c = config();
  if (row.refresh_pending) throw new Error("ML_REAUTH_REQUIRED");
  const tokens = decrypt<Tokens>(row.tokens_encrypted, c.TOKEN_ENCRYPTION_KEY);
  if (!force && new Date(row.expires_at).getTime() > Date.now() + 120000) return tokens.access_token;
  await db.call("refresh_begin");
  await db.assertLease();
  const next = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  await saveTokens(db, next);
  return next.access_token;
}
export function mlClient(db: DB, diagnostic = false) {
  return async (path: string) => {
    let token = await accessToken(db);
    try { return await request("ML", `https://api.mercadolibre.com${path}`, { headers: { Authorization: `Bearer ${token}` } }, diagnostic); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      token = await accessToken(db, true);
      return request("ML", `https://api.mercadolibre.com${path}`, { headers: { Authorization: `Bearer ${token}` } }, diagnostic);
    }
  };
}
