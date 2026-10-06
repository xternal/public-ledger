/**
 * URL normalisation for submissions: one canonical form per source, so that
 * the same link sent twice is recognised (dedupe) and fetched once.
 *
 * - lowercase scheme and host, default ports dropped (the URL parser does this);
 * - fragment dropped; tracking parameters dropped; trailing slash dropped;
 * - every YouTube form becomes https://www.youtube.com/watch?v=ID, and a start
 *   time in the link (t=, start=, #t=) is returned as seconds.
 */

const TRACKING_PARAMS = new Set(["fbclid", "gclid", "si", "msclkid", "igshid", "mc_cid", "mc_eid"]);

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export interface NormalisedUrl {
  /** Canonical URL, used for dedupe and for every fetch. */
  url: string;
  /** YouTube video id, when the link is a YouTube video. */
  youtubeId: string | null;
  /** Start time carried in the link itself (YouTube t= or start=), in seconds. */
  linkTime: number | null;
}

/** Parse "90", "90s", "1m30s", "1h2m3s", "01:30", "1:02:03" into whole seconds; null if not a time. */
export function parseVideoTime(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^\d{1,6}s?$/.test(s)) return Number.parseInt(s, 10);
  const hms = /^(?:(\d{1,2})h)?(?:(\d{1,3})m)?(?:(\d{1,5})s)?$/.exec(s);
  if (hms && (hms[1] || hms[2] || hms[3])) return Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0);
  const clock = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/.exec(s);
  if (clock) {
    const [, h, m, sec] = clock;
    if (h !== undefined && Number(m) > 59) return null; // h:mm:ss needs minutes below 60
    return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(sec);
  }
  return null;
}

/** 754 → "12:34"; 3723 → "1:02:03". */
export function formatVideoTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function youtubeIdOf(u: URL): string | null {
  const host = u.hostname;
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "youtu.be") return parts[0] && YOUTUBE_ID.test(parts[0]) ? parts[0] : null;
  if (!YOUTUBE_HOSTS.has(host)) return null;
  if (parts[0] === "watch") {
    const v = u.searchParams.get("v");
    return v && YOUTUBE_ID.test(v) ? v : null;
  }
  if (parts[0] && ["shorts", "live", "embed", "v", "e"].includes(parts[0]) && parts[1] && YOUTUBE_ID.test(parts[1])) return parts[1];
  return null;
}

function youtubeTime(u: URL): number | null {
  const fromHash = new URLSearchParams(u.hash.replace(/^#/, "")).get("t");
  for (const raw of [u.searchParams.get("t"), u.searchParams.get("start"), fromHash]) {
    const t = parseVideoTime(raw);
    if (t !== null) return t;
  }
  return null;
}

/** Throws if the input is not an absolute http(s) URL. */
export function normaliseUrl(input: string): NormalisedUrl {
  const u = new URL(input.trim());
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http and https links are accepted");

  const youtubeId = youtubeIdOf(u);
  if (youtubeId) return { url: `https://www.youtube.com/watch?v=${youtubeId}`, youtubeId, linkTime: youtubeTime(u) };

  // Keep the remaining parameters exactly as written (no re-encoding), in order.
  const kept = u.search
    .replace(/^\?/, "")
    .split("&")
    .filter((pair) => {
      if (!pair) return false;
      const key = safeDecode(pair.split("=")[0]!).toLowerCase();
      return !key.startsWith("utm_") && !TRACKING_PARAMS.has(key);
    });
  const search = kept.length ? `?${kept.join("&")}` : "";
  const path = u.pathname.replace(/\/+$/, "");
  // Credentials in a link are refused by validation; never carried into the canonical form.
  return { url: `${u.protocol}//${u.host}${path}${search}`, youtubeId: null, linkTime: null };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}
