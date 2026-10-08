import { z } from "zod";
import { MEMBERS_API, requestJson, type FetchLike } from "./http";
import { slugify, type Constituency, type ConstituencyList } from "./names";

/** The Members API returns at most 20 constituencies a page. */
const PAGE = 20;

const SearchPage = z.object({
  totalResults: z.number(),
  items: z.array(z.object({ value: z.object({ id: z.number(), name: z.string(), endDate: z.string().nullable() }) })),
});

export function constituencyPageUrl(skip: number): string {
  return `${MEMBERS_API}/Location/Constituency/Search?skip=${skip}&take=${PAGE}`;
}

/**
 * Every current constituency from the Members API, A to Z, with a unique
 * slug each, for data/reference/constituencies.json. Throws if the API's
 * total is not reached or two names make the same slug, so a bad refresh
 * never replaces a good list.
 */
export async function fetchConstituencyList(doFetch: FetchLike, today: string): Promise<ConstituencyList> {
  const out: Constituency[] = [];
  let total = Infinity;
  for (let skip = 0; skip < total; skip += PAGE) {
    const page = SearchPage.parse(await requestJson(doFetch, "members", constituencyPageUrl(skip)));
    total = page.totalResults;
    if (!page.items.length) break;
    for (const { value } of page.items) if (value.endDate === null) out.push({ id: value.id, name: value.name.trim(), slug: slugify(value.name) });
  }
  if (out.length !== total) throw new Error(`expected ${total} constituencies, got ${out.length}`);
  const seen = new Map<string, string>();
  for (const c of out) {
    const clash = seen.get(c.slug);
    if (clash) throw new Error(`"${clash}" and "${c.name}" both make the slug ${c.slug}`);
    seen.set(c.slug, c.name);
  }
  out.sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  return {
    source: "UK Parliament Members API",
    source_url: `${MEMBERS_API}/Location/Constituency/Search`,
    licence: "Open Parliament Licence v3.0",
    fetched_on: today,
    constituencies: out,
  };
}
