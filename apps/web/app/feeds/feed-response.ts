import "server-only";
import { DEADLINE_WINDOWS, PolicyArea, WINDOW_LABEL, isDeadlineWindow } from "@ledger/schema";
import { buildFeed, headlineOf, windowFeedTitle, FEED_CONTENT_TYPE, type FeedKind, type Headline } from "@ledger/server/alerts";
import { areaPath } from "@ledger/server/seo";
import { getSeed } from "@/lib/data";
import { AREA_LABEL } from "@/lib/promises";
import { siteUrl } from "@/lib/site";

/**
 * Atom feeds, built from content and data/build (no database). URL convention
 * (shared with Follow): /feeds/all.xml, /feeds/promise/{id}.xml,
 * /feeds/actor/{id}.xml, /feeds/area/{area}.xml, /feeds/deadlines/{window}.xml,
 * and /feeds/updates.xml for data changes (contracts and new editions of the
 * headline figures).
 */

/** Headline figures of every year in the Statement, for edition entries. */
function headlines(): Headline[] {
  return Object.values(getSeed().statements).flatMap((s) => headlineOf(s) ?? []);
}

const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function feedTargets() {
  const seed = getSeed();
  return {
    promises: seed.cards.map((c) => ({ id: c.id, title: `${c.actor.name}: “${short(c.current.text)}”` })),
    actors: seed.actors.map((a) => ({ id: a.id, title: a.name, kind: a.kind })),
    areas: PolicyArea.options.map((a) => ({ id: a, title: AREA_LABEL[a] })),
    windows: DEADLINE_WINDOWS.map((w) => ({ id: w, title: WINDOW_LABEL[w] })),
  };
}

/** "uk-bus-cap-2-2026.xml" → "uk-bus-cap-2-2026"; anything else → null. */
export const keyFromFile = (file: string) => (/^[a-z0-9_-]+\.xml$/.test(file) ? file.slice(0, -4) : null);

export function feedResponse(kind: FeedKind, key: string): Response {
  const seed = getSeed();
  const names = new Map(seed.actors.map((a) => [a.id, a.name]));
  let title: string | null = null;
  let subtitle: string;
  let alternatePath: string;
  if (kind === "all") {
    title = "Public Ledger: every change";
    subtitle =
      "New timeline events, rewordings and replies on every tracked UK political promise, changes to the contracts behind them, and new editions of the headline figures, newest first.";
    alternatePath = "/promises";
  } else if (kind === "updates") {
    title = "Public Ledger: updates to the figures";
    subtitle = "Data changes only: a contract behind a promise moves or is linked, or a new OBR forecast or ONS release changes the Statement's borrowing, income or spending.";
    alternatePath = "/#statement";
  } else if (kind === "deadlines") {
    if (isDeadlineWindow(key)) title = windowFeedTitle(key);
    subtitle = "When a promise due in this window is delivered or its deadline passes, and each month the list of what is coming due.";
    alternatePath = "/promises#coming-up";
  } else if (kind === "promise") {
    const card = seed.cards.find((c) => c.id === key);
    if (card) title = `Public Ledger: ${card.actor.name}, “${short(card.current.text)}”`;
    subtitle = "Every change to this promise: timeline events, rewordings and replies.";
    alternatePath = `/promise/${key}`;
  } else if (kind === "actor") {
    const actor = seed.actors.find((a) => a.id === key);
    if (actor) title = `Public Ledger: ${actor.name}`;
    subtitle = actor?.kind === "party" ? `Changes to promises by ${actor.name} and its people.` : `Changes to promises by ${actor?.name ?? key}.`;
    alternatePath = `/actor/${key}`;
  } else {
    const area = PolicyArea.safeParse(key);
    if (area.success) title = `Public Ledger: ${AREA_LABEL[area.data]}`;
    subtitle = `Changes to promises about ${area.success ? AREA_LABEL[area.data].toLowerCase() : key}.`;
    // The area's own page, once it has cards (an empty area has no page).
    alternatePath = area.success && seed.cards.some((c) => c.file.policy_area === area.data) ? areaPath(area.data) : "/promises";
  }
  if (!title) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const xml = buildFeed(seed.cards, kind, key, {
    siteUrl: siteUrl(),
    title,
    subtitle,
    alternatePath,
    actorName: (id) => names.get(id),
    headlines: kind === "all" || kind === "updates" ? headlines() : undefined,
  });
  return new Response(xml, { headers: { "content-type": FEED_CONTENT_TYPE } });
}
