/**
 * Small helpers shared by the source fetchers. The public APIs we read
 * (Hansard, written statements, GOV.UK) are fixed, trusted hosts, so they use
 * plain fetch; anything a person supplies goes through safeFetch instead.
 */

import { htmlToText } from "../../intake/text";

export type FetchLike = typeof fetch;

export const USER_AGENT = "PublicLedgerBot/1.0 (promise intake)";
const TIMEOUT_MS = 30_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    const u = new URL(url);
    super(`HTTP ${status} from ${u.host}${u.pathname}`);
    this.name = "HttpError";
  }
}

/** GET a JSON document. Throws HttpError on a non-2xx answer and a plain Error on a body that is not JSON. */
export async function getJson<T>(doFetch: FetchLike, url: string): Promise<T> {
  const res = await doFetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    void res.body?.cancel().catch(() => undefined);
    throw new HttpError(res.status, url);
  }
  const body = await res.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    const u = new URL(url);
    throw new Error(`not JSON from ${u.host}${u.pathname}`);
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.name === "TimeoutError" ? "timed out" : e.message;
  return String(e);
}

const UK_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

/** The UK calendar date (Europe/London) of an instant, as YYYY-MM-DD. */
export function ukDate(instant: string | Date): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return UK_DAY.format(d);
}

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Trim and collapse runs of whitespace to one space. */
export function squash(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

const LEADING_TITLES = /^(?:the|rt\.?|right|hon\.?|honourable|mr\.?|ms\.?|mrs\.?|miss|mx\.?|dr\.?|sir|dame|professor|prof\.?)\s+/i;
const POST_NOMINALS = new Set([
  "MP", "MSP", "MS", "MLA", "KC", "QC", "PC", "JP", "DL", "FRS", "FRSE", "FREng", "FMedSci", "FBA", "PhD",
  "KG", "KT", "GCB", "KCB", "CB", "GCMG", "KCMG", "CMG", "GCVO", "KCVO", "CVO", "LVO", "MVO", "GBE", "KBE", "DBE", "CBE", "OBE", "MBE", "BEM", "CH", "OM", "QSO",
]);

/**
 * A person's plain name: honorifics ("The Rt Hon", "Mr", "Ms", "Mrs", "Dr",
 * "Sir", "Dame"…) and post-nominals ("MP", "KC", "OBE"…) removed.
 * Peerage titles ("Lord Hendy of Richmond Hill", "Baroness Smith") are names and stay.
 */
export function cleanPersonName(raw: string): string {
  let s = squash(raw).replace(/,/g, " ").replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(LEADING_TITLES, "");
  }
  const words = s.split(" ");
  while (words.length > 1 && POST_NOMINALS.has(words[words.length - 1]!.replace(/\.$/, ""))) words.pop();
  return words.join(" ");
}

const INLINE_TAGS = /<\/?(?:a|abbr|acronym|b|strong|i|em|span|sup|sub|small|u|mark|cite|q|time)\b[^>]*>/gi;

/**
 * Prose of an HTML fragment (htmlToText), with inline tags removed first so
 * that a link or abbreviation does not leave a stray space: "<a>report</a>."
 * reads "report." and "(<abbr>WRN</abbr>)" reads "(WRN)", as on the page.
 */
export function prose(html: string): string {
  // Repeat until stable, so removing one tag cannot leave another behind ("<<a>b>").
  let out = html;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(INLINE_TAGS, "");
  }
  return htmlToText(out);
}
