import { createHash, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
export const random = () => randomBytes(32).toString("base64url");
export const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
export function equal(a: string, b: string) { return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b))); }
export function encrypt(value: unknown, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(x => x.toString("base64url")).join(".");
}
export function decrypt<T>(value: string, key: string): T {
  const [iv, tag, body] = value.split(".").map(x => Buffer.from(x, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(body), cipher.final()]).toString());
}
