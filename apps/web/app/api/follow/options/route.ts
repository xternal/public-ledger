import { followOptions } from "@/app/follow/targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the follow panel needs on pages rendered without it: the consent text and the Telegram bot's username (or null). */
export function GET() {
  return Response.json(followOptions(), { headers: { "cache-control": "public, max-age=3600" } });
}
