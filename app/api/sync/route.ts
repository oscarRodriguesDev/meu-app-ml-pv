import { syncHandler } from "../../../lib/handlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(req: Request) { return syncHandler(req, false); }
