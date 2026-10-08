"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { countUsage } from "@ledger/server";
import { lookup, type LookupResult } from "@ledger/server/mp";
import { getServer } from "@/lib/server";

/**
 * The /mp search box. A postcode is posted here, looked up once (postcodes.io
 * in a POST body, never cached) and dropped; the reader is sent to the
 * constituency's page, whose address names only the constituency. Nothing
 * typed is stored or logged: only an aggregate count of how lookups went.
 */

export interface LookupState {
  result: LookupResult | null;
  /** What the reader typed, sent back to their own browser only, to refill the box when nothing was found. */
  query: string;
}

/** Never cached: a postcode must not land in Next's data cache. */
const noStore = (url: string, init?: RequestInit) => fetch(url, { ...init, cache: "no-store" });

export async function findMp(_prev: LookupState, form: FormData): Promise<LookupState> {
  const raw = form.get("q");
  const query = typeof raw === "string" ? raw.slice(0, 200) : "";
  const { result, by } = await lookup(query, noStore);

  if (by !== "none" && result.kind !== "empty") {
    const outcome = result.kind;
    after(async () => {
      try {
        const { db } = await getServer();
        await countUsage(db, { event: "mp_lookup", props: { by, outcome } });
      } catch {
        // Counting is best effort and never blocks a lookup.
      }
    });
  }

  if (result.kind === "found") redirect(`/mp/${result.slug}`);
  return { result, query };
}
