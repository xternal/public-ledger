import { ALPHA_COOKIE, ALPHA_COOKIE_MAX_AGE, alphaPasswordMatches, alphaToken, clientKeyFrom, errorText, rateLimit, safeNext } from "@ledger/server";
import { getServer } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sign in to the alpha preview: the shared password sets a 30-day cookie. Attempts are rate-limited without storing IPs. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const next = safeNext(form?.get("next"));
  const back = (path: string) => new Response(null, { status: 303, headers: { location: path, "cache-control": "no-store" } });
  try {
    const { config, db } = await getServer();
    if (config.stage !== "alpha" || !config.alphaPassword) return back(next);
    if (!(await rateLimit(db, clientKeyFrom(req.headers), "alpha_sign_in", 30))) return back(`/alpha?e=busy&next=${encodeURIComponent(next)}`);
    if (!alphaPasswordMatches(form?.get("password"), config.alphaPassword)) return back(`/alpha?e=wrong&next=${encodeURIComponent(next)}`);
    const secure = config.production ? "; Secure" : "";
    return new Response(null, {
      status: 303,
      headers: {
        location: next,
        "cache-control": "no-store",
        "set-cookie": `${ALPHA_COOKIE}=${alphaToken(config.alphaPassword)}; Path=/; Max-Age=${ALPHA_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`,
      },
    });
  } catch (e) {
    console.error("alpha sign-in failed:", errorText(e));
    return back(`/alpha?e=error&next=${encodeURIComponent(next)}`);
  }
}
