import { createSpamChallenge } from "@ledger/server";
import { getServer } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A fresh proof-of-work challenge for the ALTCHA widget on our forms. */
export async function GET() {
  const { config } = await getServer();
  return Response.json(await createSpamChallenge(config), { headers: { "cache-control": "no-store" } });
}
