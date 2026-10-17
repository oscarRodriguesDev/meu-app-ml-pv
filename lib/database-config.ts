import type { PoolConfig } from "pg";

/** Keep server-side credentials here; neither Supabase anon nor service-role keys are needed. */
export function databaseConfig(env: Record<string, string | undefined> = process.env): PoolConfig {
  if (!env.DATABASE_URL) throw new Error("CONFIG_DATABASE_URL_MISSING");
  let url: URL;
  try { url = new URL(env.DATABASE_URL); }
  catch { throw new Error("CONFIG_DATABASE_URL_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("CONFIG_DATABASE_URL_INVALID");

  const supabase = /\.(?:pooler\.supabase\.com|supabase\.co)$/.test(url.hostname);
  // Supavisor transaction pooling loses the session advisory lock between statements.
  if (supabase && url.port && url.port !== "5432") throw new Error("CONFIG_DATABASE_SESSION_POOLER_REQUIRED");
  const ca = env.DATABASE_SSL_CA?.replace(/\\n/g, "\n");
  if (ca && ["sslrootcert", "sslcert", "sslkey"].some(key => url.searchParams.has(key))) {
    throw new Error("CONFIG_DATABASE_SSL_CONFLICT");
  }
  if (supabase || ca) {
    if (["disable", "no-verify", "allow", "prefer"].includes(url.searchParams.get("sslmode") ?? "") || url.searchParams.get("ssl") === "false") {
      throw new Error("CONFIG_DATABASE_TLS_REQUIRED");
    }
    // pg-connection-string would overwrite an explicit ssl object if sslmode is left in the URL.
    // Keep path-based certificates when configured; otherwise always verify the server identity.
    if (!["sslrootcert", "sslcert", "sslkey"].some(key => url.searchParams.has(key))) {
      url.searchParams.delete("sslmode");
      url.searchParams.delete("ssl");
      return {
        connectionString: url.toString(),
        ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
        max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, application_name: "ml-clickup",
      };
    }
    if (url.searchParams.get("sslmode") !== "verify-full") throw new Error("CONFIG_DATABASE_TLS_VERIFY_FULL_REQUIRED");
  }
  return {
    connectionString: url.toString(), max: 5,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, application_name: "ml-clickup",
  };
}
