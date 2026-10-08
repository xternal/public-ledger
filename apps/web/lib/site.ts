import { cardLastUpdated, type SeoContext } from "@ledger/server/seo";

/**
 * Site identity for metadata, structured data, the sitemap and llms.txt.
 * SITE_URL is set in production (docs/OPERATIONS.md); Vercel previews fall back
 * to their own production URL, local development to localhost.
 */
export const SITE_NAME = "Public Ledger";
export const SITE_DESCRIPTION =
  "An open P&L of the UK state: where public money comes from, where it goes, and what every political promise would cost, with every number linked to its official source.";

/**
 * Open Graph fields every page shares. A page that sets its own openGraph
 * replaces the layout's whole object, so pages spread this in.
 */
export const OPEN_GRAPH = { siteName: SITE_NAME, locale: "en_GB" } as const;

/** An alpha (SITE_STAGE=alpha): a public early version, labelled on every page. */
export const isAlpha = () => process.env.SITE_STAGE === "alpha";

/** The maker, credited at the foot of every page. */
export const MAKER = { name: "Pavel Guzhikov", url: "https://guzh.uk", coffee: "https://ko-fi.com/pavelg" } as const;

export function siteUrl(): string {
  const fromEnv = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return (fromEnv || "http://localhost:3000").replace(/\/$/, "");
}

/** Today's date in UK time, YYYY-MM-DD. */
const ukToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

/**
 * The last date a card changed: its newest version, timeline event, correction
 * or review up to today (future deadlines are not changes). The card's "Last
 * updated", its dateModified and its sitemap lastmod all use it.
 */
export function lastChanged(file: Parameters<typeof cardLastUpdated>[0], today = ukToday()): string | undefined {
  return cardLastUpdated(file, today);
}

/** What the SEO helpers (titles, structured data, Markdown) need: where the site is, and today. */
export const seoContext = (): SeoContext => ({ siteUrl: siteUrl(), today: ukToday() });

export function absolute(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
