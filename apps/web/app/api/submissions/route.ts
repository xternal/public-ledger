import { after } from "next/server";
import { clientKeyFrom, errorText } from "@ledger/server";
import { receiveSubmission, runAutoChecks } from "@ledger/server/intake";
import { getServer } from "@/lib/server";
import { intake, readBody } from "./intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The automatic checks run after the response: fetch, archive (slow), transcript, pre-fill. */
export const maxDuration = 120;

const NO_STORE = { "cache-control": "no-store" };

/**
 * A reader's submission (PRD F8). It goes to the editors' queue, never onto a
 * card (invariant 8). Responds 201 { reference, receipt_sent } at once; the
 * automatic checks run after the response has been sent.
 */
export async function POST(req: Request) {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return Response.json({ error: "invalid", message: "Send the form as JSON." }, { status: 415, headers: NO_STORE });
  }
  const body = await readBody(req);
  if (!body) return Response.json({ error: "invalid", message: "The form could not be read." }, { status: 400, headers: NO_STORE });

  try {
    const { config, db, mail } = await getServer();
    const { content, rules } = intake();
    const result = await receiveSubmission(body, { db, config, mail, rules, clientKey: clientKeyFrom(req.headers) });
    if (!result.ok) {
      return Response.json({ error: result.error, fields: result.fields }, { status: result.httpStatus, headers: NO_STORE });
    }
    after(async () => {
      try {
        await runAutoChecks(db, config, result.reference, { content });
      } catch (e) {
        console.error("submission auto-checks failed:", errorText(e));
      }
    });
    return Response.json({ reference: result.reference, receipt_sent: result.receiptSent }, { status: 201, headers: NO_STORE });
  } catch (e) {
    console.error("submission failed:", errorText(e)); // never the body: it is the reader's text
    return Response.json({ error: "server" }, { status: 500, headers: NO_STORE });
  }
}
