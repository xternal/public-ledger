/**
 * The public read-only API (M7): /api/v1/… as JSON, and as CSV with a .csv
 * suffix. Built at deploy time from the same committed files as the site
 * (data/build, content/), so it serves no database rows: no subscriptions,
 * no submissions, nothing about readers. Field names are stable within a
 * version; a breaking change gets /api/v2 and v1 keeps working.
 */

export const API_VERSION = "v1";

/** Fresh for an hour in browsers, a day at the edge; the data only changes when the site is deployed. */
export const API_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  "x-content-type-options": "nosniff",
};

export const OGL = {
  name: "Open Government Licence v3.0",
  url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
} as const;

export const OPEN_PARLIAMENT_LICENCE = {
  name: "Open Parliament Licence v3.0",
  url: "https://www.parliament.uk/site-information/copyright-parliament/open-parliament-licence/",
} as const;

export interface Licence {
  name: string;
  url: string;
  attribution: string;
  notes: string[];
}

const SOURCES_NOTE = "Every number names its source (sources[].licence gives each one's terms). Most are Crown copyright under the OGL; Bank of England and NATO figures follow their own terms.";
const OWN_WORK_NOTE =
  "Notes, summaries and statuses written by Public Ledger have no open licence yet: credit Public Ledger and link to the page they come from.";

export type Dataset = "index" | "statement" | "promises" | "actors" | "forecasts" | "contracts" | "vintages";

/** The licence and attribution that go with a dataset. */
export function licenceFor(dataset: Dataset, siteUrl: string): Licence {
  const notes = [SOURCES_NOTE];
  if (dataset === "promises" || dataset === "actors" || dataset === "index") {
    notes.push(
      `Quotes from Parliament: contains Parliamentary information licensed under the ${OPEN_PARLIAMENT_LICENCE.name} (${OPEN_PARLIAMENT_LICENCE.url}). Other quotes are short extracts reproduced for reporting; their rights stay with the speaker and publisher (see each card's quote_licence).`,
    );
  }
  if (dataset !== "statement" && dataset !== "vintages") notes.push(OWN_WORK_NOTE);
  if (dataset === "forecasts" || dataset === "index")
    notes.push("Official forecasts are the OBR's and the ONS's, labelled by maker; only records with maker \"public_ledger\" are ours.");
  return {
    ...OGL,
    attribution: `Contains public sector information licensed under the ${OGL.name}. Compiled by Public Ledger (${siteUrl}).`,
    notes,
  };
}

/** Licence of a quote, from where it was said. */
export function quoteLicence(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "Quoted for reporting; rights stay with the publisher";
  }
  const under = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (under("parliament.uk")) return OPEN_PARLIAMENT_LICENCE.name;
  if (["gov.uk", "gov.scot", "gov.wales"].some(under)) return OGL.name;
  return "Quoted for reporting; rights stay with the publisher";
}

export interface Envelope<T> {
  api_version: typeof API_VERSION;
  dataset: string;
  /** The data build the response was made from (data/build/app.json built_at). */
  data_build: string;
  docs_url: string;
  licence: Licence;
  data: T;
}

export function envelope<T>(dataset: Dataset, path: string, data: T, ctx: { siteUrl: string; dataBuild: string }): Envelope<T> {
  return {
    api_version: API_VERSION,
    dataset: path,
    data_build: ctx.dataBuild,
    docs_url: `${ctx.siteUrl}/method/api`,
    licence: licenceFor(dataset, ctx.siteUrl),
    data,
  };
}

// ------------------------------------------------------------------ CSV

export type Cell = string | number | boolean | null | undefined;

const cell = (v: Cell): string => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** RFC 4180 CSV with a header row, in the column order given. Empty cells mean "none". */
export function toCsv<T extends Record<string, Cell>>(columns: (keyof T & string)[], rows: T[]): string {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), { headers: { ...API_HEADERS, "content-type": "application/json; charset=utf-8" } });
}

export function csvResponse(csv: string, name: string, licence: Licence): Response {
  return new Response(csv, {
    headers: {
      ...API_HEADERS,
      "content-type": "text/csv; charset=utf-8; header=present",
      "content-disposition": `inline; filename="${name}.csv"`,
      // CSV has no room for the licence block, so it travels in a header too.
      "x-licence": `${licence.name} <${licence.url}>`,
      link: `<${licence.url}>; rel="license"`,
    },
  });
}

export function notFound(message = "Not found"): Response {
  return new Response(JSON.stringify({ api_version: API_VERSION, error: message }), {
    status: 404,
    headers: { ...API_HEADERS, "content-type": "application/json; charset=utf-8" },
  });
}

/** "2025-26.csv" → { key: "2025-26", format: "csv" }; "2025-26" or "2025-26.json" → json. */
export function splitFormat(file: string): { key: string; format: "json" | "csv" } {
  if (file.endsWith(".csv")) return { key: file.slice(0, -4), format: "csv" };
  if (file.endsWith(".json")) return { key: file.slice(0, -5), format: "json" };
  return { key: file, format: "json" };
}
