import { createHash, timingSafeEqual } from "node:crypto";
import type { Db } from "../db";
import { clientKeyFrom, rateCount, rateLimit } from "../spam";

/**
 * Interim access control for the editors' triage (/admin, /api/admin): HTTP
 * basic auth against ADMIN_USER and ADMIN_PASSWORD. With either unset the
 * pages do not exist (404), in every environment. Put Cloudflare Access or
 * Vercel Authentication in front before launch (docs/OPERATIONS.md §6).
 */

export interface AdminCredentials {
  user: string | null;
  password: string | null;
}

export function adminCredentials(env: Record<string, string | undefined> = process.env): AdminCredentials {
  return { user: env.ADMIN_USER || null, password: env.ADMIN_PASSWORD || null };
}

export type AdminAuth = "disabled" | "denied" | "ok";

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Compare in constant time: both sides are hashed first, so neither length nor content leaks through timing. */
export function checkAdminAuth(authorization: string | null | undefined, creds: AdminCredentials): AdminAuth {
  if (!creds.user || !creds.password) return "disabled";
  const m = /^Basic +([A-Za-z0-9+/=]+) *$/i.exec(authorization ?? "");
  const given = m ? Buffer.from(m[1]!, "base64").toString("utf8") : "";
  const same = timingSafeEqual(digest(given), digest(`${creds.user}:${creds.password}`));
  return same && m ? "ok" : "denied";
}

/** Headers on every admin response: never indexed, never cached. */
export const ADMIN_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
};

const TEXT = { ...ADMIN_HEADERS, "content-type": "text/plain; charset=utf-8" };
const notFound = () => new Response("Not found", { status: 404, headers: TEXT });
const signIn = () =>
  new Response("Editors only. Sign in with the editors' user name and password.", {
    status: 401,
    headers: { ...TEXT, "WWW-Authenticate": 'Basic realm="Public Ledger editors", charset="UTF-8"' },
  });

/**
 * The gate the proxy runs before /admin and /api/admin. Returns the response
 * to send (404 when disabled, 401 asking for credentials) or null to let the
 * request through.
 */
export function adminGate(request: Request, env: Record<string, string | undefined> = process.env): Response | null {
  const result = checkAdminAuth(request.headers.get("authorization"), adminCredentials(env));
  if (result === "ok") return null;
  return result === "disabled" ? notFound() : signIn();
}

/** Failed sign-ins allowed per connection per UTC day before /admin stops answering it. */
export const ADMIN_FAILED_SIGNIN_LIMIT = 10;
const FAILED_SIGNIN = "admin_signin_failed";

/**
 * adminGate with a small limit on failed sign-ins (DPIA risk R7, measure
 * M4b). Each wrong user name or password is counted in the spam module's
 * IP-free buckets: an HMAC of the client's IP with the day's random salt,
 * deleted after the day. After ADMIN_FAILED_SIGNIN_LIMIT failures, that
 * connection gets 429 until the next UTC day, even with the right password,
 * so a guesser cannot tell when they hit it. A request with no credentials
 * (the browser's first visit, before it asks) is not a failure.
 */
export async function adminGateLimited(
  request: Request,
  db: () => Promise<Db>,
  env: Record<string, string | undefined> = process.env,
  now = new Date(),
): Promise<Response | null> {
  const authorization = request.headers.get("authorization");
  const result = checkAdminAuth(authorization, adminCredentials(env));
  if (result === "disabled") return notFound();
  if (!authorization) return signIn();
  const store = await db();
  const client = clientKeyFrom(request.headers);
  if ((await rateCount(store, client, FAILED_SIGNIN, now)) >= ADMIN_FAILED_SIGNIN_LIMIT) return tooManyFailures(now);
  if (result === "ok") return null;
  return (await rateLimit(store, client, FAILED_SIGNIN, ADMIN_FAILED_SIGNIN_LIMIT, now)) ? signIn() : tooManyFailures(now);
}

function tooManyFailures(now: Date): Response {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return new Response("Too many failed sign-ins from this connection today. Try again tomorrow.", {
    status: 429,
    headers: { ...TEXT, "Retry-After": String(Math.ceil((midnight - now.getTime()) / 1000)) },
  });
}

/**
 * Browsers resend cached basic-auth credentials on cross-site form posts, so
 * triage actions accept same-origin requests only (requests with no Origin,
 * such as curl, are allowed: they carry no ambient credentials).
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
