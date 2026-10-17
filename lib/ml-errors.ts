export type MLFailureDetails = {
  operation: "claims_search" | "claim_detail" | "claim_returns" | "mercado_api";
  upstreamCode?: "bad_request" | "invalid_request" | "validation_error" | "invalid_parameter" | "invalid_query" | "forbidden" | "not_found" | "unauthorized";
  reason?: "date_range" | "seller_filter" | "sort" | "pagination" | "permissions" | "query_parameters" | "return_not_available";
};

/** Never retain an upstream message, query, resource ID, token or response body. */
export async function mlFailureDetails(url: string, response: Response): Promise<MLFailureDetails> {
  const path = new URL(url).pathname;
  const result: MLFailureDetails = { operation: path === "/post-purchase/v1/claims/search" ? "claims_search"
    : /^\/post-purchase\/v2\/claims\/\d+\/returns$/.test(path) ? "claim_returns"
      : /^\/post-purchase\/v1\/claims\/\d+$/.test(path) ? "claim_detail" : "mercado_api" };
  const reader = response.body?.getReader();
  if (!reader) return result;
  try {
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 8192) return result;
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length); let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) return result;
    const root = body as Record<string, unknown>;
    const entries = [root, ...(Array.isArray(root.cause) ? root.cause.slice(0, 10) : [])];
    const messages: string[] = [];
    const known = new Set(["bad_request", "invalid_request", "validation_error", "invalid_parameter", "invalid_query", "forbidden", "not_found", "unauthorized"]);
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const value = entry as Record<string, unknown>;
      for (const key of ["error", "code"]) {
        if (typeof value[key] === "string" && known.has(value[key])) result.upstreamCode ??= value[key] as MLFailureDetails["upstreamCode"];
      }
      if (typeof value.message === "string") messages.push(value.message);
    }
    const text = messages.join(" ");
    // Classify into fixed labels only. Unrecognized text is deliberately discarded.
    if (/\b(date|dates|timestamp|timezone|range|fecha|milliseconds|milissegundos)\b/i.test(text)) result.reason = "date_range";
    else if (/players\.(user_id|role)|\b(seller|respondent|complainant)\b/i.test(text)) result.reason = "seller_filter";
    else if (/\b(sort|order_by|ordering)\b/i.test(text)) result.reason = "sort";
    else if (/\b(offset|limit|page|paging|pagination|10000)\b/i.test(text)) result.reason = "pagination";
    else if (/\b(permission|permissions|scope|scopes|authorized|denied)\b/i.test(text)) result.reason = "permissions";
    else if (/\bno returns? (found|available)|return not found/i.test(text)) result.reason = "return_not_available";
    else if (/\b(filter|filters|parameter|parameters|query)\b/i.test(text)) result.reason = "query_parameters";
  } catch { /* Malformed/private bodies do not replace the HTTP status or enter logs. */ }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return result;
}
