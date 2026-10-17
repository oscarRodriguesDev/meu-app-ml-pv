import { equal } from "./crypto";
export function isAdmin(headers: Headers, secret: string) {
  const value = headers.get("authorization") ?? "";
  if (value.startsWith("Bearer ")) return equal(value.slice(7), secret);
  if (!value.startsWith("Basic ")) return false;
  const decoded = Buffer.from(value.slice(6), "base64").toString();
  return equal(decoded, `admin:${secret}`);
}
export function isCron(headers: Headers, secret: string) {
  return equal(headers.get("authorization") ?? "", `Bearer ${secret}`);
}
export function unauthorized() {
  return new Response("Autenticação necessária", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="ML ClickUp", charset="UTF-8"', "Cache-Control": "no-store" } });
}
