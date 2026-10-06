/**
 * Text from sources, and the exact-match check of a claimed quote against it.
 *
 * "Exact" means the same words in the same order after normalising case,
 * whitespace, curly quotes, apostrophes, diacritics and punctuation. It never
 * paraphrases or fuzzes: no match is reported as no match, and editors decide.
 */

export interface TimedSegment {
  /** Seconds from the start of the video. */
  start: number;
  /** Character offset of this segment in the joined transcript text. */
  offset: number;
}

export interface SourceText {
  source: "transcript" | "page";
  text: string;
  /** For transcripts: where each caption segment starts, in order of offset. */
  segments?: TimedSegment[];
}

export interface QuoteMatch {
  /** The matched words as they appear in the source. */
  text: string;
  source: "transcript" | "page";
  /** Character offsets of the match in the source text. */
  source_span: [number, number];
  /** For transcripts: when the matched words start, in seconds. */
  at_seconds?: number;
  /** For video with a submitted time: whether the match is within ±60 s of it. */
  near_video_time?: boolean;
}

// ---------------------------------------------------------------- normalising

const APOSTROPHES = /['‘’ʼ`´]/u;
const KEEP = /[\p{L}\p{N}£$€%]/u;

/**
 * Normalise for matching and keep, for every output character, the index of
 * the input character it came from (so a match can be mapped back to the source).
 */
export function normaliseForMatch(input: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < input.length; ) {
    const cp = input.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const width = ch.length;
    if (APOSTROPHES.test(ch)) {
      i += width;
      continue; // "we'll" and "we’ll" both become "well"
    }
    const folded = ch.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
    let wrote = false;
    for (const c of folded) {
      if (KEEP.test(c)) {
        if (pendingSpace && out.length) {
          out += " ";
          map.push(i);
        }
        pendingSpace = false;
        out += c;
        map.push(i);
        wrote = true;
      }
    }
    if (!wrote) pendingSpace = true; // whitespace and punctuation separate words
    i += width;
  }
  return { text: out, map };
}

export function wordCount(s: string): number {
  const t = normaliseForMatch(s).text;
  return t ? t.split(" ").length : 0;
}

/** Find the claimed quote in the source. With a video time, the occurrence nearest to it wins. */
export function matchQuote(quote: string, source: SourceText, videoTime: number | null): QuoteMatch | null {
  const q = normaliseForMatch(quote).text;
  if (!q) return null;
  const hay = normaliseForMatch(source.text);
  const hits: number[] = [];
  for (let at = hay.text.indexOf(q); at !== -1; at = hay.text.indexOf(q, at + 1)) {
    // Whole words only: the match must start and end on a word boundary.
    const before = at === 0 || hay.text[at - 1] === " ";
    const after = at + q.length === hay.text.length || hay.text[at + q.length] === " ";
    if (before && after) hits.push(at);
  }
  if (!hits.length) return null;
  const startOf = (hit: number) => hay.map[hit]!;
  const timeOf = (hit: number) => (source.segments ? timeAt(source.segments, startOf(hit)) : undefined);
  let best = hits[0]!;
  if (videoTime !== null && source.segments) {
    best = hits.reduce((a, b) => (Math.abs(timeOf(b)! - videoTime) < Math.abs(timeOf(a)! - videoTime) ? b : a));
  }
  const start = startOf(best);
  const end = hay.map[best + q.length - 1]! + 1;
  const endChar = source.text.codePointAt(end - 1)! > 0xffff ? end + 1 : end;
  const match: QuoteMatch = { text: source.text.slice(start, endChar), source: source.source, source_span: [start, endChar] };
  const at = timeOf(best);
  if (at !== undefined) {
    match.at_seconds = Math.round(at);
    if (videoTime !== null) match.near_video_time = Math.abs(at - videoTime) <= 60;
  }
  return match;
}

function timeAt(segments: TimedSegment[], offset: number): number {
  let t = segments[0]?.start ?? 0;
  for (const s of segments) {
    if (s.offset > offset) break;
    t = s.start;
  }
  return t;
}

/** Up to `max` characters of the source around a span (or around a time, or from the start). */
export function excerpt(source: SourceText, max: number, span?: [number, number], videoTime?: number | null): string {
  const text = source.text;
  if (text.length <= max) return text;
  let centre = 0;
  if (span) centre = Math.floor((span[0] + span[1]) / 2);
  else if (videoTime != null && source.segments?.length) {
    centre = source.segments.reduce((a, b) => (Math.abs(b.start - videoTime) < Math.abs(a.start - videoTime) ? b : a)).offset;
  } else return text.slice(0, max);
  const from = Math.max(0, Math.min(text.length - max, centre - Math.floor(max / 2)));
  return text.slice(from, from + max);
}

// ---------------------------------------------------------------- pages

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", pound: "£", euro: "€", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", shy: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const DROP_ELEMENTS = ["script", "style", "noscript", "template", "svg", "head", "iframe", "object", "nav", "footer", "form", "button", "select"];
const BLOCK = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|blockquote|section|article|header|main|aside|dd|dt|figcaption|hr)\b[^>]*>/gi;

/** Remove elements whose content is never prose. Linear: indexOf scans, no backtracking regexes. */
function dropElements(html: string): string {
  let s = html;
  // Comments first.
  let out = "";
  for (let i = 0; ; ) {
    const open = s.indexOf("<!--", i);
    if (open === -1) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, open) + " ";
    const close = s.indexOf("-->", open + 4);
    if (close === -1) break;
    i = close + 3;
  }
  s = out;
  const lower = s.toLowerCase();
  out = "";
  let i = 0;
  const openRe = new RegExp(`<(${DROP_ELEMENTS.join("|")})\\b`, "g");
  for (let m = openRe.exec(lower); m; m = openRe.exec(lower)) {
    if (m.index < i) continue;
    out += s.slice(i, m.index) + " ";
    const close = lower.indexOf(`</${m[1]}`, m.index + m[0].length);
    if (close === -1) {
      i = s.length;
      break;
    }
    const gt = lower.indexOf(">", close);
    i = gt === -1 ? s.length : gt + 1;
    openRe.lastIndex = i;
  }
  return out + s.slice(i);
}

/** Visible prose of an HTML page: no scripts, styles, navigation or markup; entities decoded. */
export function htmlToText(html: string): string {
  return decodeEntities(dropElements(html).replace(BLOCK, "\n").replace(/<[^>]*>/g, " "))
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n[\s]*/g, "\n")
    .trim();
}

// ---------------------------------------------------------------- YouTube

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

/** Read `var ytInitialPlayerResponse = {...};` from a watch page without evaluating anything. */
export function playerResponseFrom(html: string): Record<string, unknown> | null {
  const m = /ytInitialPlayerResponse\s*=\s*\{/.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function captionTracksFrom(player: Record<string, unknown>): CaptionTrack[] {
  const tracks = (player as { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] } } }).captions
    ?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks)) return [];
  return tracks.filter((t): t is CaptionTrack => !!t && typeof (t as CaptionTrack).baseUrl === "string" && typeof (t as CaptionTrack).languageCode === "string");
}

/** English written by people first, then English auto-generated, then anything written by people, then anything. */
export function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const en = (t: CaptionTrack) => t.languageCode.toLowerCase().startsWith("en");
  const manual = (t: CaptionTrack) => t.kind !== "asr";
  return tracks.find((t) => en(t) && manual(t)) ?? tracks.find(en) ?? tracks.find(manual) ?? tracks[0] ?? null;
}

interface Json3 {
  events?: { tStartMs?: number; segs?: { utf8?: string; tOffsetMs?: number }[] }[];
}

/** Build timed text from a YouTube json3 caption file. */
export function transcriptFromJson3(json: unknown): SourceText {
  const segments: TimedSegment[] = [];
  let text = "";
  for (const e of (json as Json3)?.events ?? []) {
    if (!Array.isArray(e.segs)) continue;
    let first = true;
    for (const s of e.segs) {
      const piece = (s.utf8 ?? "").replace(/\s+/g, " ");
      if (!piece.trim()) continue;
      if (first && text && !text.endsWith(" ") && !piece.startsWith(" ")) text += " ";
      first = false;
      segments.push({ start: ((e.tStartMs ?? 0) + (s.tOffsetMs ?? 0)) / 1000, offset: text.length });
      text += piece;
    }
  }
  return { source: "transcript", text, segments };
}
