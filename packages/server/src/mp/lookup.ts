import { constituencyById, constituencyByName, searchConstituencies } from "./constituencies";
import { MEMBERS_API, requestJson, type FetchLike } from "./http";
import { constituencyForPostcode, queryKind } from "./postcodes";
import { searchMps } from "./parliament";
import type { Constituency } from "./names";

/**
 * One search box: a postcode, a constituency or an MP's name. The answer is
 * a constituency page (/mp/<slug>), a short list to choose from, or a plain
 * reason why not. Nothing typed here is stored, logged or put in a link:
 * callers get back only slugs and public names.
 */

export interface Choice {
  slug: string;
  constituency: string;
  /** Set when the choice came from the MP's name. */
  mp: string | null;
  party: string | null;
}

export type LookupResult =
  | { kind: "found"; slug: string }
  | { kind: "choices"; choices: Choice[] }
  | { kind: "empty" }
  | { kind: "not_found"; reason: "postcode" | "outcode" | "name" | "short" }
  | { kind: "unavailable" };

/** What the reader searched by, for aggregate counts only. */
export type LookupBy = "postcode" | "name" | "none";

/** No more than this many choices: past that, a reader should type more. */
export const MAX_CHOICES = 12;
/** Longer than any constituency or MP name. */
const MAX_QUERY = 80;

const found = (c: Constituency): LookupResult => ({ kind: "found", slug: c.slug });

/** postcodes.io names a constituency; find it in our list, or ask Parliament if the spelling differs. */
async function constituencyNamed(doFetch: FetchLike, name: string): Promise<Constituency | null> {
  const local = constituencyByName(name);
  if (local) return local;
  const q = new URLSearchParams({ searchText: name, skip: "0", take: "5" });
  const body = await requestJson<{ items?: { value?: { id?: number; endDate?: string | null } }[] }>(doFetch, "members", `${MEMBERS_API}/Location/Constituency/Search?${q}`);
  const hit = body?.items?.find((i) => i.value?.id && i.value.endDate === null)?.value?.id;
  return hit ? constituencyById(hit) : null;
}

async function byPostcode(doFetch: FetchLike, postcode: string): Promise<LookupResult> {
  try {
    const name = await constituencyForPostcode(doFetch, postcode);
    if (!name) return { kind: "not_found", reason: "postcode" };
    const c = await constituencyNamed(doFetch, name);
    return c ? found(c) : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

async function byName(doFetch: FetchLike, query: string): Promise<LookupResult> {
  if (query.length < 2) return { kind: "not_found", reason: "short" };
  const exact = constituencyByName(query);
  if (exact) return found(exact);

  const choices = new Map<string, Choice>();
  let mpsFailed = false;
  try {
    for (const hit of await searchMps(doFetch, query)) {
      const c = constituencyById(hit.constituencyId);
      if (c) choices.set(c.slug, { slug: c.slug, constituency: c.name, mp: hit.name, party: hit.party });
    }
  } catch {
    mpsFailed = true;
  }
  for (const c of searchConstituencies(query)) {
    if (!choices.has(c.slug)) choices.set(c.slug, { slug: c.slug, constituency: c.name, mp: null, party: null });
  }

  const list = [...choices.values()];
  if (list.length === 1) return { kind: "found", slug: list[0]!.slug };
  if (list.length > 1) return { kind: "choices", choices: list.slice(0, MAX_CHOICES) };
  return mpsFailed ? { kind: "unavailable" } : { kind: "not_found", reason: "name" };
}

/** Find the constituency page for what a reader typed. Never throws. */
export async function lookup(raw: string, doFetch: FetchLike): Promise<{ result: LookupResult; by: LookupBy }> {
  const query = raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  switch (queryKind(query)) {
    case "empty":
      return { result: { kind: "empty" }, by: "none" };
    case "postcode":
      return { result: await byPostcode(doFetch, query), by: "postcode" };
    // Half a postcode often spans several constituencies, and is still a place: ask for the whole one rather than send it anywhere.
    case "outcode":
      return { result: { kind: "not_found", reason: "outcode" }, by: "postcode" };
    case "partial_postcode":
      return { result: { kind: "not_found", reason: "postcode" }, by: "postcode" };
    case "text":
      return { result: await byName(doFetch, query), by: "name" };
  }
}
