/**
 * The one way "Your MP" talks to outside services: postcodes.io and UK
 * Parliament's Members, Commons Votes and Bills APIs. Only the server calls
 * them, never the reader's browser.
 *
 * Errors never quote what a reader typed: a postcode goes in a POST body, and
 * an UpstreamError names only the service and the HTTP status.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type Upstream = "postcodes.io" | "members" | "votes" | "bills";

export const MEMBERS_API = "https://members-api.parliament.uk/api";
export const VOTES_API = "https://commonsvotes-api.parliament.uk/data";
export const BILLS_API = "https://bills-api.parliament.uk/api/v1";

export const USER_AGENT = "PublicLedger/1.0 (Your MP; server-side, cached daily)";

/** A reader is waiting: give up well before a serverless function would. */
const TIMEOUT_MS = 8_000;

export class UpstreamError extends Error {
  constructor(
    readonly upstream: Upstream,
    readonly status: number | null,
    detail: string,
  ) {
    super(`${upstream}: ${detail}`);
    this.name = "UpstreamError";
  }
}

/**
 * GET or POST a JSON document. A 404 comes back as null when `allow404` is set
 * (an unknown bill, say); any other failure throws an UpstreamError.
 */
export async function requestJson<T>(
  doFetch: FetchLike,
  upstream: Upstream,
  url: string,
  opts: { method?: "GET" | "POST"; body?: unknown; allow404?: boolean } = {},
): Promise<T | null> {
  let res: Response;
  try {
    res = await doFetch(url, {
      method: opts.method ?? "GET",
      headers: { accept: "application/json", "user-agent": USER_AGENT, ...(opts.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new UpstreamError(upstream, null, timedOut ? "timed out" : "unreachable");
  }
  if (opts.allow404 && res.status === 404) {
    void res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.ok) {
    void res.body?.cancel().catch(() => undefined);
    throw new UpstreamError(upstream, res.status, `HTTP ${res.status}`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new UpstreamError(upstream, res.status, "not JSON");
  }
}

/** "2024-07-04T00:00:00" → "2024-07-04". */
export const isoDay = (s: string) => s.slice(0, 10);
