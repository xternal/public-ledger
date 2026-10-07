import type { SourceDoc, Venue } from "../types";

export interface FetchDayOptions {
  fetch?: typeof fetch;
  /** Most GOV.UK press releases to read in a day (default 40). */
  govukLimit?: number;
}

/** A day's sources: Commons oral statements, PMQs, written ministerial statements, GOV.UK press releases. */
export async function fetchDay(_date: string, _opts: FetchDayOptions = {}): Promise<{ docs: SourceDoc[]; errors: { sourceId: string; message: string }[] }> {
  throw new Error("fetchDay: not built yet (M4 sources)");
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
export async function sourceFromUpload(_input: UploadInput, _opts: { fetch?: typeof fetch } = {}): Promise<SourceDoc> {
  throw new Error("sourceFromUpload: not built yet (M4 sources)");
}
