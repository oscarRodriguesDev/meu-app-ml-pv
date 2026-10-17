import { NextRequest, NextResponse } from "next/server";
import { BusyError, withLock } from "../../../../lib/db";
import { consumeState, finishOAuth } from "../../../../lib/oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  let res: NextResponse;
  try {
    await withLock(async db => {
      const verifier = await consumeState(db, req.nextUrl.searchParams.get("state") ?? "", req.cookies.get("ml_oauth_browser")?.value ?? "");
      if (req.nextUrl.searchParams.has("error")) throw new Error("OAUTH_DENIED");
      const code = req.nextUrl.searchParams.get("code");
      if (!code || code.length > 2048) throw new Error("OAUTH_CODE_INVALID");
      await finishOAuth(db, code, verifier);
    });
    res = new NextResponse("Conta conectada. A sincronização ocorrerá na próxima execução do agendamento. Você pode fechar esta janela.", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof BusyError) return new NextResponse("Sincronização em andamento. Recarregue esta página em alguns instantes.", { status: 409, headers: { "Cache-Control": "no-store" } });
    res = NextResponse.json({ error: "OAUTH_FAILED", action: "Inicie novamente a conexão. Confira a URL de redirecionamento, o vendedor e as permissões da aplicação." }, { status: 400 });
  }
  res.cookies.set("ml_oauth_browser", "", { httpOnly: true, sameSite: "lax", path: "/api/oauth/callback", maxAge: 0 });
  return res;
}
