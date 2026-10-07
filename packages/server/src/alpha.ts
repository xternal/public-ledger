import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * An optional gate for an alpha: one shared password (ALPHA_PASSWORD) for
 * testers. Off unless ALPHA_PASSWORD is set; the default alpha is public.
 * Signing in sets a cookie holding an HMAC of the password, so changing the
 * password signs everyone out. A cookie, not HTTP basic auth, because the
 * editors' /admin already uses basic auth and a browser sends one login per site.
 */

export const ALPHA_COOKIE = "ledger_alpha";
export const ALPHA_COOKIE_MAX_AGE = 30 * 24 * 3600;

/** Reachable without the alpha password: the gate itself, health checks, webhooks and one-click unsubscribe from mail clients. */
const OPEN = [/^\/alpha$/, /^\/api\/alpha$/, /^\/api\/health$/, /^\/api\/telegram$/, /^\/api\/follow\/unsubscribe$/, /^\/robots\.txt$/, /^\/icon\.svg$/, /^\/favicon\.ico$/, /^\/_next\//];

export function alphaOpenPath(pathname: string): boolean {
  return OPEN.some((r) => r.test(pathname));
}

export function alphaToken(password: string): string {
  return createHmac("sha256", password).update("public-ledger-alpha-v1").digest("base64url");
}

export function alphaCookieValid(cookie: string | undefined, password: string): boolean {
  if (!cookie) return false;
  const a = Buffer.from(cookie);
  const b = Buffer.from(alphaToken(password));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function alphaPasswordMatches(given: unknown, password: string): boolean {
  if (typeof given !== "string" || given.length > 200) return false;
  const a = createHmac("sha256", "compare").update(given).digest();
  const b = createHmac("sha256", "compare").update(password).digest();
  return timingSafeEqual(a, b);
}

/** Only same-site paths, so the gate can never redirect a tester elsewhere. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?!\/)[^\s\\]*$/.test(next) && !next.startsWith("/alpha") ? next : "/";
}

/**
 * Decide a request in alpha: null lets it through; otherwise a redirect to the
 * sign-in page (pages) or a 401 (API and files).
 */
export function alphaGate(request: Request, env: Record<string, string | undefined> = process.env): Response | null {
  const password = env.ALPHA_PASSWORD;
  if (env.SITE_STAGE !== "alpha" || !password) return null;
  const url = new URL(request.url);
  if (alphaOpenPath(url.pathname)) return null;
  const cookie = (request.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find((c) => c.startsWith(`${ALPHA_COOKIE}=`))
    ?.slice(ALPHA_COOKIE.length + 1);
  if (alphaCookieValid(cookie, password)) return null;
  const wantsPage = (request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/");
  const noindex = { "X-Robots-Tag": "noindex, nofollow", "cache-control": "no-store" };
  if (wantsPage) {
    const to = new URL("/alpha", url);
    to.searchParams.set("next", safeNext(url.pathname + url.search));
    return new Response(null, { status: 307, headers: { location: to.pathname + to.search, ...noindex } });
  }
  return new Response(JSON.stringify({ error: "alpha", message: "This is a private alpha. Sign in first." }), {
    status: 401,
    headers: { "content-type": "application/json", ...noindex },
  });
}
