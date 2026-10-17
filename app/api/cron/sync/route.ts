import { syncHandler } from "../../../../lib/handlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request) { return syncHandler(req, true); }
