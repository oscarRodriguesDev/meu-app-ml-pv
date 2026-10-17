import { NextRequest, NextResponse } from "next/server";
import { config } from "../../../../lib/config";
import { isAdmin, unauthorized } from "../../../../lib/auth";
import { pool } from "../../../../lib/db";
import { beginOAuth } from "../../../../lib/oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const c = config();
    if (!isAdmin(req.headers, c.ADMIN_SECRET)) return unauthorized();
    const { url, browser } = await beginOAuth(pool());
    const res = NextResponse.redirect(url);
    res.cookies.set("ml_oauth_browser", browser, { httpOnly: true, secure: new URL(c.ML_REDIRECT_URI).protocol === "https:", sameSite: "lax", path: "/api/oauth/callback", maxAge: 600 });
    return res;
  } catch { return Response.json({ error: "OAUTH_START_FAILED" }, { status: 503 }); }
}
