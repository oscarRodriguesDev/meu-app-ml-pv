import { z } from "zod";

export type ConfigurationIssue = { variable: string; reason: "missing" | "invalid" };
export class ConfigurationError extends Error {
  constructor(public code: string, public issues: ConfigurationIssue[]) { super(code); }
}

function environment() {
  return Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ""));
}
function parseEnvironment<S extends z.ZodType>(schema: S, code: string): z.output<S> {
  const result = schema.safeParse(environment());
  if (result.success) return result.data;
  const issues = new Map<string, ConfigurationIssue>();
  for (const issue of result.error.issues) {
    const variable = String(issue.path[0]);
    issues.set(variable, { variable, reason: process.env[variable] ? "invalid" : "missing" });
  }
  throw new ConfigurationError(code, [...issues.values()]);
}
const oauthSchema = z.object({
  ML_CLIENT_ID: z.string().min(1), ML_CLIENT_SECRET: z.string().min(1),
  ML_REDIRECT_URI: z.url(),
  TOKEN_ENCRYPTION_KEY: z.string().refine(value => Buffer.from(value, "base64").length === 32),
  ADMIN_SECRET: z.string().min(32),
  ML_SELLER_ID: z.string().regex(/^\d+$/).optional(),
});

/** OAuth must not depend on the ClickUp token or the scheduler being configured already. */
export function oauthConfig() {
  const c = { ...parseEnvironment(oauthSchema, "CONFIG_OAUTH_INVALID"), ...supabaseConfig() };
  const uri = new URL(c.ML_REDIRECT_URI);
  if (uri.username || uri.password || uri.search || uri.hash || uri.pathname !== "/api/oauth/callback" ||
    (uri.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && uri.protocol === "http:" && uri.hostname === "localhost"))) {
    throw new ConfigurationError("CONFIG_REDIRECT_URI_INVALID", [{ variable: "ML_REDIRECT_URI", reason: "invalid" }]);
  }
  return c;
}

const syncSchema = z.object({
  CLICKUP_API_TOKEN: z.string().min(1),
  CLICKUP_LIST_ID: z.string().regex(/^\d+$/).default("901717874275"),
  CRON_SECRET: z.string().min(32),
  ML_SYNC_FROM: z.iso.datetime({ offset: true }).default("2000-01-01T00:00:00.000Z"),
});
export function config() {
  const c = { ...oauthConfig(), ...parseEnvironment(syncSchema, "CONFIG_SYNC_INVALID") };
  if (c.ADMIN_SECRET === c.CRON_SECRET) {
    throw new ConfigurationError("CONFIG_SECRETS_MUST_DIFFER", [{ variable: "CRON_SECRET", reason: "invalid" }]);
  }
  return c;
}

export function supabaseConfig() {
  const c = parseEnvironment(z.object({
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(1).refine(value => !value.startsWith("sb_publishable_")),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    SUPABASE_JWKS_URL: z.url().optional(),
  }), "CONFIG_SUPABASE_INVALID");
  const url = new URL(c.SUPABASE_URL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new ConfigurationError("CONFIG_SUPABASE_URL_INVALID", [{ variable: "SUPABASE_URL", reason: "invalid" }]);
  }
  if (c.SUPABASE_SECRET_KEY === c.SUPABASE_PUBLISHABLE_KEY) {
    throw new ConfigurationError("CONFIG_SUPABASE_SECRET_REQUIRED", [{ variable: "SUPABASE_SECRET_KEY", reason: "invalid" }]);
  }
  return { ...c, SUPABASE_URL: url.origin, SUPABASE_JWKS_URL: c.SUPABASE_JWKS_URL ?? `${url.origin}/auth/v1/.well-known/jwks.json` };
}
