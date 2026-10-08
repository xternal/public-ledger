/**
 * The changelog of data vintages for /method and /api/v1/vintages: every
 * edition of every source the build holds, newest first, from
 * data/build/manifest.json and the append-only run log in
 * data/build/history/ (artifacts.csv, runs.csv).
 */

export interface ManifestSource {
  id: string;
  title: string;
  publisher: string;
  url: string;
  licence?: string | null;
  published_on?: string | null;
  vintages: string[];
  observations?: number;
  freshness?: { vintage?: string; published_on?: string | null } | null;
}

export interface Manifest {
  build_id: string;
  status: string;
  observations: number;
  sources: ManifestSource[];
}

export interface VintageEntry {
  source_id: string;
  source_title: string;
  publisher: string;
  url: string;
  licence: string | null;
  vintage: string;
  /** When the publisher released the edition: the build's record for the newest edition, else the date in its label. */
  published_on: string | null;
  /** The first build of ours that read it, from the run log; null when the log does not name the edition. */
  first_loaded: string | null;
  /** The newest edition of its source. Older editions stay on file, so their numbers can still be checked. */
  latest: boolean;
}

export interface BuildRun {
  build_id: string;
  status: string;
  observations: number;
}

/** Minimal RFC 4180 reader for the run log (quoted fields, doubled quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0] !== "");
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** A date in an edition label: "…2026-09-17", "…@2026-10-01", "EFO-2026-03" (the first of the month), "PESA-2026" (none). */
export function labelDate(vintage: string): string | null {
  const day = /(\d{4})-(\d{2})-(\d{2})/.exec(vintage);
  if (day) return `${day[1]}-${day[2]}-${day[3]}`;
  const month = /(\d{4})-(\d{2})(?!\d)/.exec(vintage);
  if (month && Number(month[2]) >= 1 && Number(month[2]) <= 12) return `${month[1]}-${month[2]}-01`;
  return null;
}

export function vintageChangelog(manifest: Manifest, artifactsCsv = ""): VintageEntry[] {
  const firstSeen = new Map<string, string>();
  for (const a of parseCsv(artifactsCsv)) {
    if (!a.vintage) continue;
    const key = `${a.source_id}|${a.vintage}`;
    const day = (a.build_id ?? "").slice(0, 10);
    if (!day) continue;
    if (!firstSeen.has(key) || day < firstSeen.get(key)!) firstSeen.set(key, day);
  }
  const entries = manifest.sources.flatMap((s) =>
    s.vintages.map((v): VintageEntry => {
      const latest = s.freshness?.vintage === v;
      return {
        source_id: s.id,
        source_title: s.title,
        publisher: s.publisher,
        url: s.url,
        licence: s.licence ?? null,
        vintage: v,
        published_on: (latest ? s.freshness?.published_on : null) ?? labelDate(v) ?? (s.vintages.length === 1 ? (s.published_on ?? null) : null),
        first_loaded: firstSeen.get(`${s.id}|${v}`) ?? null,
        latest,
      };
    }),
  );
  // Newest first by publication date; undated editions last, then by source and label.
  return entries.sort((a, b) => (b.published_on ?? "").localeCompare(a.published_on ?? "") || a.source_id.localeCompare(b.source_id) || b.vintage.localeCompare(a.vintage));
}

/** Data builds from the run log, newest first. */
export function buildRuns(runsCsv: string): BuildRun[] {
  return parseCsv(runsCsv)
    .map((r) => ({ build_id: r.build_id!, status: r.status!, observations: Number(r.observations) }))
    .sort((a, b) => b.build_id.localeCompare(a.build_id));
}

export const VINTAGE_CSV_COLUMNS = ["published_on", "source_id", "source_title", "publisher", "vintage", "latest", "first_loaded", "licence", "url"] as const;
