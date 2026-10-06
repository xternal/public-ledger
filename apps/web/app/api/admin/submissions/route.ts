import { ADMIN_HEADERS, adminGate, isStatusFilter, listSubmissions } from "@ledger/server/triage";
import { errorText } from "@ledger/server/alerts";
import { getServer } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The triage queue as JSON for editors' tools: ?status=open|all|<status>. Never includes contact addresses. */
export async function GET(request: Request) {
  const denied = adminGate(request);
  if (denied) return denied;
  const status = new URL(request.url).searchParams.get("status");
  try {
    const { db } = await getServer();
    const submissions = await listSubmissions(db, isStatusFilter(status) ? status : "open");
    return Response.json({ submissions }, { headers: ADMIN_HEADERS });
  } catch (e) {
    console.error("triage list failed:", errorText(e));
    return Response.json({ error: "unavailable" }, { status: 503, headers: ADMIN_HEADERS });
  }
}
