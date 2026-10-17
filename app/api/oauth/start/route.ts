import { NextRequest, NextResponse } from "next/server";
import { oauthConfig } from "../../../../lib/config";
import { isAdmin, unauthorized } from "../../../../lib/auth";
import { database } from "../../../../lib/db";
import { beginOAuth } from "../../../../lib/oauth";
import { oauthStartDiagnostic } from "../../../../lib/diagnostics";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const c = oauthConfig();
    if (!isAdmin(req.headers, c.ADMIN_SECRET)) return unauthorized();
    const { url, browser } = await beginOAuth(database());
    const res = NextResponse.redirect(url);
    res.cookies.set("ml_oauth_browser", browser, { httpOnly: true, secure: new URL(c.ML_REDIRECT_URI).protocol === "https:", sameSite: "lax", path: "/api/oauth/callback", maxAge: 600 });
    return res;
  } catch (error) {
    const diagnostic = oauthStartDiagnostic(error);
    console.error(JSON.stringify({ event: "oauth_start_failed", ...diagnostic }));
    return Response.json({ error: "OAUTH_START_FAILED", ...diagnostic }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
