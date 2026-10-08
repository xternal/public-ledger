import listRaw from "../../../../data/reference/constituencies.json";
import { ConstituencyList, foldName, type Constituency } from "./names";

/**
 * The 650 Westminster constituencies (2024 boundaries), from the UK
 * Parliament Members API, kept in data/reference/constituencies.json so a
 * page address (/mp/<slug>) never depends on an outside service. Boundaries
 * change only at a boundary review; refresh with `pnpm constituencies`.
 */

let list: ConstituencyList | null = null;
let bySlug: Map<string, Constituency> | null = null;
let byId: Map<number, Constituency> | null = null;
let byFolded: Map<string, Constituency> | null = null;

/** The stored list, checked once. */
export function constituencyList(): ConstituencyList {
  list ??= ConstituencyList.parse(listRaw);
  return list;
}

export function constituencies(): Constituency[] {
  return constituencyList().constituencies;
}

export function constituencyBySlug(slug: string): Constituency | null {
  bySlug ??= new Map(constituencies().map((c) => [c.slug, c]));
  return bySlug.get(slug) ?? null;
}

export function constituencyById(id: number): Constituency | null {
  byId ??= new Map(constituencies().map((c) => [c.id, c]));
  return byId.get(id) ?? null;
}

/** The constituency with exactly this name, ignoring case, accents and punctuation (postcodes.io and Parliament may spell a few differently). */
export function constituencyByName(name: string): Constituency | null {
  byFolded ??= new Map(constituencies().map((c) => [foldName(c.name), c]));
  return byFolded.get(foldName(name)) ?? null;
}

/** Constituencies with every word of the query at the start of a word in their name: "leeds" finds every Leeds seat, "leeds w" the two in the west. */
export function searchConstituencies(query: string, all: Constituency[] = constituencies()): Constituency[] {
  const words = foldName(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  return all.filter((c) => {
    const name = foldName(c.name).split(" ");
    return words.every((w) => name.some((n) => n.startsWith(w)));
  });
}
