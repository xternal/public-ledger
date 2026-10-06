import {
  acceptSubmission,
  ADMIN_HEADERS,
  adminGate,
  isRejectReason,
  isSameOrigin,
  markDuplicate,
  rejectSubmission,
  type TriageContext,
  type TriageResult,
} from "@ledger/server/triage";
import { getSeed } from "@/lib/data";
import { errorText } from "@ledger/server/alerts";
import { getServer } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REF = /^S-\d{4}-\d{2}-\d{4}$/;

function back(path: string, params: Record<string, string>): Response {
  const q = new URLSearchParams(params).toString();
  // A relative Location keeps the editor on whatever host they used.
  return new Response(null, { status: 303, headers: { ...ADMIN_HEADERS, location: `${path}${q ? `?${q}` : ""}` } });
}

/**
 * Triage actions from the forms on /admin (plain HTML forms, no JavaScript).
 * Fields: id (S-…), action (accept | reject | duplicate), reason, of.
 */
export async function POST(request: Request) {
  const denied = adminGate(request); // the proxy checks too; this keeps the route safe if its matcher ever changes
  if (denied) return denied;
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403, headers: ADMIN_HEADERS });

  const form = await request.formData().catch(() => null);
  const id = String(form?.get("id") ?? "");
  const action = String(form?.get("action") ?? "");
  if (!REF.test(id)) return back("/admin", {});

  try {
    const { db, config, mail } = await getServer();
    const ctx: TriageContext = { db, config, mailer: mail, existingIds: new Set(getSeed().cards.map((c) => c.id)) };
    let result: TriageResult<{ emailed: boolean }>;
    if (action === "accept") result = await acceptSubmission(ctx, id);
    else if (action === "reject") {
      const reason = form?.get("reason");
      result = isRejectReason(reason) ? await rejectSubmission(ctx, id, reason) : { ok: false, error: "no_reason" };
    } else if (action === "duplicate") result = await markDuplicate(ctx, id, String(form?.get("of") ?? ""));
    else return back(`/admin/${id}`, {});
    return back(`/admin/${id}`, result.ok ? { done: action, emailed: result.emailed ? "1" : "0" } : { error: result.error });
  } catch (e) {
    console.error("triage action failed:", errorText(e));
    return new Response("Something went wrong. Nothing was sent; try again.", { status: 500, headers: ADMIN_HEADERS });
  }
}
