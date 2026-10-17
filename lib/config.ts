import { z } from "zod";
const schema = z.object({
  CLICKUP_API_TOKEN: z.string().min(1),
  CLICKUP_LIST_ID: z.string().regex(/^\d+$/).default("901717874275"),
  ML_CLIENT_ID: z.string().min(1), ML_CLIENT_SECRET: z.string().min(1),
  ML_REDIRECT_URI: z.url(),
  TOKEN_ENCRYPTION_KEY: z.string().refine(v => Buffer.from(v, "base64").length === 32),
  ADMIN_SECRET: z.string().min(32), CRON_SECRET: z.string().min(32),
  ML_SELLER_ID: z.string().regex(/^\d+$/).optional(),
  ML_SYNC_FROM: z.iso.datetime({ offset: true }).default("2000-01-01T00:00:00.000Z"),
});
export function config() {
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([,v]) => v !== "")));
  if (!parsed.success) throw new Error("CONFIG_INVALID: " + parsed.error.issues.map(x => x.path.join(".")).join(", "));
  const c = { ...parsed.data, ...supabaseConfig() };
  const uri = new URL(c.ML_REDIRECT_URI);
  if (uri.username || uri.password || uri.search || uri.hash || uri.pathname !== "/api/oauth/callback" ||
    (uri.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && uri.protocol === "http:" && uri.hostname === "localhost"))) {
    throw new Error("CONFIG_REDIRECT_URI_INVALID");
  }
  if (c.ADMIN_SECRET === c.CRON_SECRET) throw new Error("CONFIG_SECRETS_MUST_DIFFER");
  return c;
}

export function supabaseConfig() {
  const result = z.object({
    SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: z.string().min(1).refine(v => !v.startsWith("sb_publishable_")),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    SUPABASE_JWKS_URL: z.url().optional(),
  }).safeParse(Object.fromEntries(Object.entries(process.env).filter(([,v]) => v !== "")));
  if (!result.success) throw new Error("CONFIG_SUPABASE_INVALID");
  const c = result.data;
  const url = new URL(c.SUPABASE_URL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("CONFIG_SUPABASE_URL_INVALID");
  }
  if (c.SUPABASE_SECRET_KEY === c.SUPABASE_PUBLISHABLE_KEY) throw new Error("CONFIG_SUPABASE_SECRET_REQUIRED");
  return { ...c, SUPABASE_URL: url.origin, SUPABASE_JWKS_URL: c.SUPABASE_JWKS_URL ?? `${url.origin}/auth/v1/.well-known/jwks.json` };
}
