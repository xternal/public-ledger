import { clientKeyFrom, rateLimit } from "@ledger/server";
import { countFormOpened } from "@ledger/server/intake";
import { getServer } from "@/lib/server";
import { readBody } from "../intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side count of the contribute form being opened (the reader first
 * moves into it). Pages with forms run no client analytics (rule 4); this
 * stores one daily aggregate and nothing about the reader: no id, no card.
 */
export async function POST(req: Request) {
  const body = await readBody(req, 200);
  const kind = body?.kind === "evidence" ? "evidence" : body?.kind === "new" ? "new" : null;
  if (!kind) return new Response(null, { status: 400 });
  try {
    const { db } = await getServer();
    // A cap per client per day keeps the funnel honest; nothing is stored about the client.
    if (await rateLimit(db, clientKeyFrom(req.headers), "submit_form_opened", 20)) await countFormOpened(db, kind);
  } catch (e) {
    console.error("form-opened count failed:", (e as Error).message);
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
