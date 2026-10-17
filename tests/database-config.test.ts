import { it, expect } from "vitest";
import { databaseConfig } from "../lib/database-config";
const session = "postgresql://postgres.example:test-password@aws-0-sa-east-1.pooler.supabase.com:5432/postgres";
it("keeps Supabase session pooling and enforces server certificate verification", () => {
  const config = databaseConfig({ DATABASE_URL: `${session}?sslmode=require` });
  expect(config.ssl).toEqual({ rejectUnauthorized: true });
  expect(new URL(config.connectionString!).searchParams.has("sslmode")).toBe(false);
});
it("rejects Supabase transaction pooling before connecting", () => {
  expect(() => databaseConfig({ DATABASE_URL: session.replace(":5432", ":6543") })).toThrow("SESSION_POOLER_REQUIRED");
});
it("loads a Supabase CA certificate with escaped newlines", () => {
  expect(databaseConfig({ DATABASE_URL: session, DATABASE_SSL_CA: "line1\\nline2" }).ssl).toEqual({ rejectUnauthorized: true, ca: "line1\nline2" });
});
it("keeps local PostgreSQL usable without TLS and rejects missing connection strings", () => {
  expect(databaseConfig({ DATABASE_URL: "postgresql://user:password@localhost:5432/test" }).ssl).toBeUndefined();
  expect(() => databaseConfig({})).toThrow("DATABASE_URL_MISSING");
});
it("rejects insecure TLS settings and conflicting certificate sources", () => {
  expect(() => databaseConfig({ DATABASE_URL: `${session}?sslmode=no-verify` })).toThrow("TLS_REQUIRED");
  expect(() => databaseConfig({ DATABASE_URL: `${session}?ssl=false` })).toThrow("TLS_REQUIRED");
  expect(() => databaseConfig({ DATABASE_URL: `${session}?sslrootcert=cert.pem`, DATABASE_SSL_CA: "pem" })).toThrow("SSL_CONFLICT");
});
