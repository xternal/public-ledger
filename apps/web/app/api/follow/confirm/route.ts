import { confirmEmailFollow } from "@ledger/server/follow";
import { followContext } from "@/app/follow/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function tokenFrom(req: Request): Promise<string | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const b = (await req.json()) as { t?: unknown };
      return typeof b.t === "string" ? b.t : null;
    }
    const t = (await req.formData()).get("t");
    return typeof t === "string" ? t : null;
  } catch {
    return null;
  }
}

/**
 * The confirmation page's button posts here (a plain HTML form, so it works
 * without JavaScript). There is no GET: mail scanners open links, and opening
 * a link must never confirm anything.
 */
export async function POST(req: Request) {
  const ctx = await followContext();
  const res = await confirmEmailFollow(ctx, await tokenFrom(req));
  const done = res.ok && res.kind === "addition" ? "added" : "confirmed";
  const to = res.ok ? `/follow/manage?t=${encodeURIComponent(res.manageToken)}&m=${done}` : `/follow/confirm?e=${res.reason}`;
  return new Response(null, { status: 303, headers: { location: new URL(to, req.url).toString(), "cache-control": "no-store" } });
}
