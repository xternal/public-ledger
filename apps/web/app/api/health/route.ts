import { errorText } from "@ledger/server";
import { getServer } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness for uptime checks: the database answers. Reveals no counts or settings. */
export async function GET() {
  try {
    const { db } = await getServer();
    await db.query("SELECT 1");
    return Response.json({ ok: true });
  } catch (e) {
    console.error("health check failed:", errorText(e));
    return Response.json({ ok: false }, { status: 503 });
  }
}
