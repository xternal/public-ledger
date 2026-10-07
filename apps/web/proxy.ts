import { NextResponse, type NextRequest } from "next/server";
import { alphaGate } from "@ledger/server/alpha";
import { ADMIN_HEADERS, adminGate } from "@ledger/server/triage";

/**
 * Next 16 proxy (formerly middleware), Node.js runtime.
 * - Alpha with a password (SITE_STAGE=alpha and ALPHA_PASSWORD set): every page
 *   needs the testers' password (a cookie set at /alpha) and is marked noindex.
 *   Without a password the alpha is public, indexed like any page.
 * - The editors' triage keeps its interim basic auth: 404 when ADMIN_USER or
 *   ADMIN_PASSWORD is unset, 401 without the right credentials; noindex and
 *   no-store. Pages and routes check again themselves (defence in depth).
 *   Before launch, put Cloudflare Access or Vercel Authentication in front.
 */
const isAdmin = (path: string) => path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/");

export function proxy(request: NextRequest) {
  const gated = alphaGate(request);
  if (gated) return gated;
  const path = request.nextUrl.pathname;
  if (isAdmin(path)) {
    const denied = adminGate(request);
    if (denied) return denied;
  }
  const res = NextResponse.next();
  if (isAdmin(path)) for (const [k, v] of Object.entries(ADMIN_HEADERS)) res.headers.set(k, v);
  if (process.env.SITE_STAGE === "alpha" && process.env.ALPHA_PASSWORD) res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export const config = {
  // Everything except built assets; the alpha gate and the admin check decide per path.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
