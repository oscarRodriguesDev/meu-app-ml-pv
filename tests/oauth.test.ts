import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { beginOAuth, consumeState, finishOAuth, accessToken, account, saveTokens, mlClient } from "../lib/oauth";
import { decrypt, encrypt, hash, equal } from "../lib/crypto";
import { config } from "../lib/config";
import { database, testEnv } from "./setup";
let store: Awaited<ReturnType<typeof database>>;
beforeEach(async () => { testEnv(); store = await database(); });
afterEach(async () => { vi.unstubAllGlobals(); await store.engine.close(); });
const tokens = { access_token: "old-access", refresh_token: "old-refresh", user_id: "42", expires_in: 3600 };
it("uses S256, binds state to the browser, and consumes state once", async () => {
  const start = await beginOAuth(store.db); const url = new URL(start.url);
  expect(url.origin).toBe("https://auth.mercadolivre.com.br");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  const state = url.searchParams.get("state")!;
  await expect(consumeState(store.db, state, "wrong-browser")).rejects.toThrow("STATE_INVALID");
  const verifier = await consumeState(store.db, state, start.browser);
  expect(url.searchParams.get("code_challenge")).toBe(hash(verifier));
  expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expect(consumeState(store.db, state, start.browser)).rejects.toThrow("STATE_INVALID");
});
it("rejects expired states", async () => {
  const start = await beginOAuth(store.db);
  await store.db.query("UPDATE ml_integration.oauth_states SET expires_at=now()-interval '1 second'");
  await expect(consumeState(store.db, new URL(start.url).searchParams.get("state")!, start.browser)).rejects.toThrow("STATE_INVALID");
});
it("exchanges the code with verifier and exact redirect, encrypting tokens at rest", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(tokens)); vi.stubGlobal("fetch", fetchMock);
  await finishOAuth(store.db, "test-code", "test-verifier");
  const init = fetchMock.mock.calls[0][1]; const body = new URLSearchParams(init.body);
  expect(body.get("code_verifier")).toBe("test-verifier"); expect(body.get("redirect_uri")).toBe(config().ML_REDIRECT_URI);
  const saved = await account(store.db); expect(saved.tokens_encrypted).not.toContain("old-access");
  expect(decrypt(saved.tokens_encrypted, config().TOKEN_ENCRYPTION_KEY)).toEqual(tokens);
});
it("renews expiring tokens, persists the rotated refresh token and avoids redundant refresh", async () => {
  await saveTokens(store.db, { ...tokens, expires_in: 1 });
  const next = { ...tokens, access_token: "new-access", refresh_token: "new-refresh" };
  const fetchMock = vi.fn().mockResolvedValue(Response.json(next)); vi.stubGlobal("fetch", fetchMock);
  expect(await accessToken(store.db)).toBe("new-access"); expect(await accessToken(store.db)).toBe("new-access");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("refresh_token")).toBe("old-refresh");
  expect(decrypt((await account(store.db)).tokens_encrypted, config().TOKEN_ENCRYPTION_KEY)).toEqual(next);
});
it("does not reuse a single-use refresh token after an ambiguous timeout", async () => {
  await saveTokens(store.db, {...tokens, expires_in:1});
  const fetchMock = vi.fn().mockRejectedValue(new Error("sensitive-upstream-message")); vi.stubGlobal("fetch", fetchMock);
  await expect(accessToken(store.db)).rejects.toThrow("ML_TOKEN_NETWORK_ERROR");
  await expect(accessToken(store.db)).rejects.toThrow("ML_REAUTH_REQUIRED"); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("refreshes once after a 401", async () => {
  await saveTokens(store.db, tokens);
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null,{status:401})).mockResolvedValueOnce(Response.json({...tokens,access_token:"new"})).mockResolvedValueOnce(Response.json({id:88}));
  vi.stubGlobal("fetch", fetchMock);
  expect(await mlClient(store.db)("/post-purchase/v2/claims/55/returns")).toEqual({id:88});
  expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer new");
});
it("pins the existing account and optional seller restriction", async () => {
  await saveTokens(store.db,tokens);
  await expect(saveTokens(store.db,{...tokens,user_id:"43"})).rejects.toThrow("SELLER_MISMATCH");
  process.env.ML_SELLER_ID="43";
  await expect(saveTokens(store.db,tokens)).rejects.toThrow("SELLER_MISMATCH");
});
it("detects ciphertext tampering and compares secrets exactly", () => {
  const key=config().TOKEN_ENCRYPTION_KEY; const cipher=encrypt({secret:"x"},key);
  const parts=cipher.split(".");parts[1]=Buffer.alloc(16).toString("base64url");
  expect(()=>decrypt(parts.join("."),key)).toThrow(); expect(equal("a","a")).toBe(true);expect(equal("a","ab")).toBe(false);
});
