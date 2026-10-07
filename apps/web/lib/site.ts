/**
 * Site identity for metadata, structured data, the sitemap and llms.txt.
 * SITE_URL is set in production (docs/OPERATIONS.md); Vercel previews fall back
 * to their own production URL, local development to localhost.
 */
export const SITE_NAME = "Public Ledger";
export const SITE_DESCRIPTION =
  "An open P&L of the UK state: where public money comes from, where it goes, and what every political promise would cost, with every number linked to its official source.";

/** An alpha (SITE_STAGE=alpha): a public early version, labelled on every page. */
export const isAlpha = () => process.env.SITE_STAGE === "alpha";

/** The maker, credited at the foot of every page. */
export const MAKER = { name: "Pavel Guzhikov", url: "https://guzh.uk", coffee: "https://ko-fi.com/pavelg" } as const;

export function siteUrl(): string {
  const fromEnv = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return (fromEnv || "http://localhost:3000").replace(/\/$/, "");
}

/** The last date a card changed: its newest version or timeline event up to today (future deadlines are not changes). */
export function lastChanged(file: { events: { date: string }[]; versions: { recorded_on: string }[] }, today = new Date().toISOString().slice(0, 10)): string | undefined {
  return [...file.events.map((e) => e.date), ...file.versions.map((v) => v.recorded_on)].filter((d) => d <= today).sort().at(-1);
}

export function absolute(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
