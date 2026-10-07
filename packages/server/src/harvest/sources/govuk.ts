import type { SourceDoc } from "../types";
import { cleanPersonName, errorMessage, getJson, prose, squash, ukDate, type FetchLike } from "./util";

/**
 * GOV.UK press releases published on one UK day. We keep releases that name a
 * minister or official in their metadata, or that quote someone in the body;
 * the rest (inspection reports, notices) rarely carry a promise.
 */

export const GOVUK = "https://www.gov.uk";
export const DEFAULT_GOVUK_LIMIT = 40;

interface SearchResult {
  title?: string | null;
  link?: string | null;
  public_timestamp?: string | null;
  organisations?: ({ title?: string | null } | string)[] | null;
  people?: ({ title?: string | null } | string)[] | null;
}

interface ContentItem {
  title?: string | null;
  details?: { body?: string | { content_type?: string; content?: string }[] | null } | null;
}

type Errors = { sourceId: string; message: string }[];

export function govukSearchUrl(date: string): string {
  return (
    `${GOVUK}/api/search.json?filter_content_store_document_type=press_release` +
    `&filter_public_timestamp=from:${date},to:${date}&order=-public_timestamp&count=100` +
    `&fields=title,link,public_timestamp,organisations,people,description`
  );
}

export function govukId(link: string): string {
  const last = link.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? "";
  return `govuk-${last.slice(0, 60)}`;
}

function titleOf(x: { title?: string | null } | string): string {
  return squash(typeof x === "string" ? x : x?.title);
}

/** Plain names from GOV.UK `people` ("The Rt Hon Yvette Cooper MP" → "Yvette Cooper"). */
export function peopleNames(people: SearchResult["people"]): string[] {
  const out: string[] = [];
  for (const p of people ?? []) {
    const name = cleanPersonName(titleOf(p));
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function bodyHtml(item: ContentItem): string {
  const body = item.details?.body;
  if (typeof body === "string") return body;
  if (Array.isArray(body)) return body.find((b) => b.content_type === "text/html")?.content ?? body[0]?.content ?? "";
  return "";
}

const QUOTE_MARK = /["“”]/;

/**
 * True when the body quotes someone: "said"/"says" within a short distance of
 * a quotation mark, or "said:" introducing a block quote or a new paragraph.
 */
export function quotesSomeone(html: string, text: string): boolean {
  if (/\b(?:said|says)\s*:?\s*(?:<\/p>\s*)?<blockquote/i.test(html)) return true;
  if (/\b(?:said|says):\s*\n/i.test(text)) return true;
  const near = 80;
  for (let m = /\b(?:said|says)\b/gi, hit = m.exec(text); hit; hit = m.exec(text)) {
    const around = text.slice(Math.max(0, hit.index - near), hit.index + hit[0].length + near);
    if (QUOTE_MARK.test(around)) return true;
  }
  return false;
}

export async function fetchGovukDay(date: string, doFetch: FetchLike, limit = DEFAULT_GOVUK_LIMIT): Promise<{ docs: SourceDoc[]; errors: Errors }> {
  const errors: Errors = [];
  const search = await getJson<{ results?: SearchResult[] }>(doFetch, govukSearchUrl(date));
  if (!search || !Array.isArray(search.results)) throw new Error("GOV.UK search: unexpected answer");
  const onDay = search.results
    .filter((r): r is SearchResult & { link: string; public_timestamp: string } => typeof r.link === "string" && r.link.startsWith("/") && typeof r.public_timestamp === "string")
    .filter((r) => !Number.isNaN(Date.parse(r.public_timestamp)) && ukDate(r.public_timestamp) === date)
    .sort((a, b) => Date.parse(b.public_timestamp) - Date.parse(a.public_timestamp));

  const docs: SourceDoc[] = [];
  const seen = new Set<string>();
  for (const r of onDay) {
    if (docs.length >= limit) break;
    const id = govukId(r.link);
    if (seen.has(id)) continue;
    seen.add(id);
    let item: ContentItem;
    try {
      item = await getJson<ContentItem>(doFetch, `${GOVUK}/api/content${r.link}`);
    } catch (e) {
      errors.push({ sourceId: id, message: errorMessage(e) });
      continue;
    }
    const html = bodyHtml(item);
    const body = prose(html);
    const people = peopleNames(r.people);
    if (!body || (!people.length && !quotesSomeone(html, body))) continue;
    const title = squash(r.title) || squash(item.title) || id;
    const org = (r.organisations ?? []).map(titleOf).find(Boolean);
    docs.push({
      id,
      kind: "govuk_press_release",
      url: `${GOVUK}${r.link}`,
      title,
      date,
      venue: "press_release",
      venueLabel: org ? `Press release (${org})` : "Press release",
      text: `${title}\n${body}`,
      segments: [],
      people,
    });
  }
  return { docs, errors };
}
