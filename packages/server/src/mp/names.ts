import { z } from "zod";

/** Constituency names, slugs and the stored list's shape: no data, no network. */

export interface Constituency {
  /** The Members API constituency id. */
  id: number;
  name: string;
  slug: string;
}

export const ConstituencyList = z.object({
  source: z.string(),
  source_url: z.url(),
  licence: z.string(),
  fetched_on: z.string(),
  constituencies: z.array(z.object({ id: z.number().int().positive(), name: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/) })),
});
export type ConstituencyList = z.infer<typeof ConstituencyList>;

/** Accents and case folded away, "&" read as "and", punctuation as spaces: "Ynys Môn" and "ynys mon" compare equal. */
export function foldName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['‘’ʼ`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Argyll, Bute and South Lochaber" → "argyll-bute-and-south-lochaber"; "Ynys Môn" → "ynys-mon". */
export function slugify(name: string): string {
  return foldName(name).replace(/ /g, "-");
}
