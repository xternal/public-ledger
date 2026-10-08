import { z } from "zod";
import { requestJson, UpstreamError, type FetchLike } from "./http";

/**
 * Postcode to constituency with postcodes.io (ONS Postcode Directory, Open
 * Government Licence). The postcode goes in a POST body, never in a URL, so
 * it stays out of every log on the way; we keep nothing.
 */

export const POSTCODES_API = "https://api.postcodes.io";
/** Ask for the constituency only (current, 2024 boundaries). */
export const POSTCODES_URL = `${POSTCODES_API}/postcodes?filter=postcode,parliamentary_constituency`;

/** A full UK postcode, with or without its space: "SW1A 1AA", "sw1a1aa", "M1 1AE". */
const FULL = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/;
/** The first half only: "SW1A", "M1". */
const OUTWARD = /^[A-Z]{1,2}\d[A-Z\d]?$/;

/**
 * What a reader typed into the one search box. Names of MPs and
 * constituencies have no digits, so anything else with a digit is taken for
 * a mistyped postcode and goes nowhere.
 */
export type QueryKind = "empty" | "postcode" | "outcode" | "partial_postcode" | "text";

export function queryKind(raw: string): QueryKind {
  const s = raw.trim().toUpperCase();
  if (!s) return "empty";
  if (FULL.test(s)) return "postcode";
  if (OUTWARD.test(s)) return "outcode";
  if (/\d/.test(s)) return "partial_postcode";
  return "text";
}

/** "sw1a1aa" → "SW1A 1AA". */
export function tidyPostcode(raw: string): string {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  return `${s.slice(0, -3)} ${s.slice(-3)}`;
}

const Bulk = z.object({
  result: z.array(z.object({ result: z.object({ parliamentary_constituency: z.string().nullable() }).nullable() })),
});

/**
 * The constituency name for a postcode, or null when postcodes.io does not
 * know it (a typo, a brand-new or a retired postcode). Throws an
 * UpstreamError when the service does not answer.
 */
export async function constituencyForPostcode(doFetch: FetchLike, postcode: string): Promise<string | null> {
  const body = await requestJson(doFetch, "postcodes.io", POSTCODES_URL, { method: "POST", body: { postcodes: [tidyPostcode(postcode)] } });
  const parsed = Bulk.safeParse(body);
  if (!parsed.success) throw new UpstreamError("postcodes.io", 200, "unexpected answer");
  return parsed.data.result[0]?.result?.parliamentary_constituency ?? null;
}
