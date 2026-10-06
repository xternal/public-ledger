import "server-only";
import { PolicyArea } from "@ledger/schema";
import { buildFeed, FEED_CONTENT_TYPE, type FeedKind } from "@ledger/server/alerts";
import { getSeed } from "@/lib/data";
import { AREA_LABEL } from "@/lib/promises";
import { siteUrl } from "@/lib/site";

/**
 * Atom feeds, built from content at build time (no database). URL convention
 * (shared with Follow): /feeds/all.xml, /feeds/promise/{id}.xml,
 * /feeds/actor/{id}.xml, /feeds/area/{area}.xml.
 */

const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function feedTargets() {
  const seed = getSeed();
  return {
    promises: seed.cards.map((c) => ({ id: c.id, title: `${c.actor.name}: “${short(c.current.text)}”` })),
    actors: seed.actors.map((a) => ({ id: a.id, title: a.name, kind: a.kind })),
    areas: PolicyArea.options.map((a) => ({ id: a, title: AREA_LABEL[a] })),
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
    title = "Public Ledger: every promise change";
    subtitle = "New timeline events, rewordings and replies on every tracked UK political promise, newest first.";
    alternatePath = "/promises";
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
    alternatePath = "/promises";
  }
  if (!title) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const xml = buildFeed(seed.cards, kind, key, { siteUrl: siteUrl(), title, subtitle, alternatePath, actorName: (id) => names.get(id) });
  return new Response(xml, { headers: { "content-type": FEED_CONTENT_TYPE } });
}
