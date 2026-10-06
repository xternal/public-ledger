import type { Fetch, Lookup } from "../src/intake/ssrf";
import type { IntakeContent } from "../src/intake/content";

/**
 * Test doubles for every external call: no test touches the network.
 * `fakeFetch` answers only the URLs it is given and fails on anything else.
 */

export type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

export function fakeFetch(routes: Record<string, Route | Response | string>): Fetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string, init?: RequestInit) => {
    calls.push(input);
    const key = Object.keys(routes).find((k) => (k.endsWith("*") ? input.startsWith(k.slice(0, -1)) : input === k));
    if (!key) throw new Error(`unexpected fetch in test: ${input}`);
    const r = routes[key]!;
    if (typeof r === "string") return new Response(r, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    if (r instanceof Response) return r.clone();
    return r(input, init);
  }) as Fetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}

export function fakeLookup(table: Record<string, string[]>): Lookup {
  return async (host) => {
    const hit = table[host];
    if (!hit) throw new Error(`ENOTFOUND ${host}`);
    return hit;
  };
}

export const PUBLIC_DNS: Record<string, string[]> = {
  "www.youtube.com": ["142.250.187.206", "2a00:1450:4009:81f::200e"],
  "www.gov.uk": ["151.101.64.144"],
  "hansard.parliament.uk": ["20.49.212.30"],
  "news.example.org": ["93.184.215.14"],
};

export const CONTENT: IntakeContent = {
  cards: [
    { id: "bus-fare-cap", actor_id: "keir-starmer", text: "We will keep the bus fare cap at £2." },
    { id: "nhs-waiting-lists", actor_id: "labour", text: "We will cut NHS waiting lists." },
  ],
  actors: [
    { id: "keir-starmer", name: "Keir Starmer" },
    { id: "labour", name: "Labour Party" },
    { id: "reform-uk", name: "Reform UK" },
  ],
  policyAreas: ["taxes", "health", "economic_affairs", "housing_env"],
  venues: ["manifesto", "speech", "tv", "interview", "parliament"],
};

export const RULES = {
  promiseIds: new Set(CONTENT.cards.map((c) => c.id)),
  evidenceTypes: ["reworded", "in_plan", "funded", "delivering", "delivered", "failed"],
};

/** A YouTube watch page carrying a player response with two caption tracks. */
export function watchPage(videoId: string): string {
  const player = {
    videoDetails: { videoId, title: "PM speech" },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&kind=asr`, languageCode: "en", kind: "asr" },
          { baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-GB&name=manual`, languageCode: "en-GB" },
        ],
      },
    },
  };
  return `<!doctype html><html><head><script>var ytcfg = {"a":"}{"};</script></head><body>
<script nonce="x">var ytInitialPlayerResponse = ${JSON.stringify(player)};var meta = {};</script>
<div id="player"></div></body></html>`;
}

/** json3 captions: manual track, one segment per event; the promise is said at 12:31–12:40. */
export const JSON3 = {
  wireMagic: "pb3",
  events: [
    { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: "Good morning, everyone." }] },
    { tStartMs: 748_000, dDurationMs: 3000, segs: [{ utf8: "And let me be clear:" }] },
    { tStartMs: 751_200, dDurationMs: 4100, segs: [{ utf8: "we will build one and a half" }] },
    { tStartMs: 755_300, dDurationMs: 3900, segs: [{ utf8: "million homes\nin this Parliament." }] },
    { tStartMs: 759_200, dDurationMs: 100, segs: [{ utf8: "\n" }] },
    { tStartMs: 760_000, dDurationMs: 3000, segs: [{ utf8: "Thank" }, { utf8: " you", tOffsetMs: 400 }] },
  ],
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
