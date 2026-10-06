import { followerCount, parseTarget } from "@ledger/server/follow";
import { getServer } from "@/lib/server";
import { isKnownTarget } from "@/app/follow/targets";
import { errorText } from "@ledger/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/follow/count?kind=&id= → { count: number | null }. Confirmed
 * followers only; null below the threshold (50), so small counts reveal nobody.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const target = parseTarget({ kind: q.get("kind"), id: q.get("id") });
  if (!target) return Response.json({ count: null }, { status: 400 });
  let count: number | null = null;
  if (isKnownTarget(target)) {
    try {
      const { db, config } = await getServer();
      count = await followerCount(db, target.kind, target.id, config.followerCountThreshold);
    } catch (e) {
      console.error("follower count failed:", errorText(e));
    }
  }
  return Response.json({ count }, { headers: { "cache-control": "public, max-age=300" } });
}
