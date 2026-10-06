import { clientKeyFrom, rateLimit } from "@ledger/server";
import { deleteSubmitterEmail } from "@ledger/server/intake";
import { getServer } from "@/lib/server";
import { readBody } from "../intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Delete my email (PRD F8 acceptance). The page at /submission/delete posts
 * here from a plain HTML form, so it works without JavaScript. There is no
 * GET: mail scanners open links, and opening a link must never delete anything.
 * A form post is redirected (303) to the page with the outcome and without the
 * token; a JSON post gets JSON.
 */
export async function POST(req: Request) {
  const json = (req.headers.get("content-type") ?? "").includes("application/json");
  const body = await readBody(req, 2_000);
  const token = typeof body?.t === "string" ? body.t : null;

  let outcome: "deleted" | "invalid" | "limit" | "error";
  let credit: "removed" | "kept" | "none" = "none";
  let reference: string | null = null;
  try {
    const { db } = await getServer();
    if (!(await rateLimit(db, clientKeyFrom(req.headers), "submission_delete", 30))) outcome = "limit";
    else {
      const res = await deleteSubmitterEmail(db, token);
      outcome = res ? "deleted" : "invalid";
      if (res) ({ credit, reference } = res);
    }
  } catch (e) {
    console.error("delete-my-email failed:", (e as Error).message);
    outcome = "error";
  }

  if (json) {
    const status = { deleted: 200, invalid: 404, limit: 429, error: 500 }[outcome];
    return Response.json(outcome === "deleted" ? { deleted: true, reference, credit } : { deleted: false, error: outcome }, {
      status,
      headers: { "cache-control": "no-store" },
    });
  }
  const to = outcome === "deleted" ? `/submission/delete?done=${credit}&ref=${reference}` : `/submission/delete?e=${outcome}`;
  return new Response(null, { status: 303, headers: { location: new URL(to, req.url).toString(), "cache-control": "no-store" } });
}
