import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
export class ApiError extends Error {
  constructor(public service: string, public status: number) { super(`${service}_HTTP_${status}`); }
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Only GET/PUT are retryable. OAuth and task creation must never be blindly replayed.
export async function request(service: string, url: string, init: RequestInit = {}) {
  const retryable = !init.method || ["GET", "PUT"].includes(init.method);
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
    } catch {
      if (retryable && attempt < 2) { await delay(300 * 2 ** attempt); continue; }
      throw new Error(`${service}_NETWORK_ERROR`);
    }
    if (retryable && attempt < 2 && (response.status === 429 || response.status >= 500)) {
      const retry = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      await delay(Math.min(5000, Math.max(300 * 2 ** attempt, Number.isFinite(retry) ? retry * 1000 : 0)));
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new ApiError(service, response.status); }
    try { return await response.json() as unknown; }
    catch { throw new Error(`${service}_INVALID_JSON`); }
  }
}
