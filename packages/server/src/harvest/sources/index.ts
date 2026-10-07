import type { SourceDoc, Venue } from "../types";
import { DEFAULT_GOVUK_LIMIT, fetchGovukDay } from "./govuk";
import { fetchHansardDay } from "./hansard";
import { buildUploadDoc } from "./upload";
import { errorMessage, isIsoDate } from "./util";
import { fetchWmsDay } from "./wms";

export interface FetchDayOptions {
  fetch?: typeof fetch;
  /** Most GOV.UK press releases to read in a day (default 40). */
  govukLimit?: number;
}

/**
 * A day's sources: Commons oral statements, PMQs, written ministerial statements, GOV.UK press releases.
 * Requests go one at a time. A failure in one source (or one document) is
 * reported in `errors` and never fails the day.
 */
export async function fetchDay(date: string, opts: FetchDayOptions = {}): Promise<{ docs: SourceDoc[]; errors: { sourceId: string; message: string }[] }> {
  if (!isIsoDate(date)) throw new Error(`fetchDay: date must be YYYY-MM-DD, got "${date}"`);
  const doFetch = opts.fetch ?? fetch;
  const limit = Math.max(0, Math.floor(opts.govukLimit ?? DEFAULT_GOVUK_LIMIT));
  const docs: SourceDoc[] = [];
  const errors: { sourceId: string; message: string }[] = [];
  const sources: [string, () => Promise<{ docs: SourceDoc[]; errors: { sourceId: string; message: string }[] }>][] = [
    ["hansard", () => fetchHansardDay(date, doFetch)],
    ["wms", () => fetchWmsDay(date, doFetch)],
    ["govuk", () => fetchGovukDay(date, doFetch, limit)],
  ];
  for (const [sourceId, run] of sources) {
    try {
      const out = await run();
      docs.push(...out.docs);
      errors.push(...out.errors);
    } catch (e) {
      errors.push({ sourceId, message: errorMessage(e) });
    }
  }
  return { docs, errors };
}

export interface UploadInput {
  /** Pasted or file text; or leave empty and give youtubeUrl to fetch captions. */
  text?: string;
  youtubeUrl?: string;
  /** Public page the words come from (required: drafts cite it). */
  url: string;
  title: string;
  date: string;
  venue: Venue;
  venueLabel?: string;
  /** Who is speaking, when the whole text is one person's words. */
  speaker?: { name: string; role?: string | null; party?: string | null };
}

/** A manually supplied transcript (or YouTube captions) as a SourceDoc. */
export async function sourceFromUpload(input: UploadInput, opts: { fetch?: typeof fetch } = {}): Promise<SourceDoc> {
  return buildUploadDoc(input, opts.fetch);
}
