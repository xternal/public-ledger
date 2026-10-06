import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_HEADERS, adminGate } from "@ledger/server/triage";

/**
 * Next 16 proxy (formerly middleware), Node.js runtime. Guards the editors'
 * triage with interim basic auth: 404 when ADMIN_USER or ADMIN_PASSWORD is
 * unset, 401 without the right credentials. Every admin response is marked
 * noindex and no-store. Pages and routes check again themselves (defence in
 * depth). Before launch, put Cloudflare Access or Vercel Authentication in front.
 */
export function proxy(request: NextRequest) {
  const denied = adminGate(request);
  if (denied) return denied;
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(ADMIN_HEADERS)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
