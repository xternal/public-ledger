import type { CardView } from "@ledger/schema";
import { areaLabel, eventLabel, statusLabel, truncate, ukDate, ukToday } from "./labels";

/**
 * Atom 1.0 feeds (RFC 4287) built from content alone, no database: one entry
 * per timeline event, rewording (version 2 onwards) and published reply.
 * Entry ids are tag: URIs that depend only on the card id and the entry's
 * position in its append-only history (invariant 5), so they never change.
 */

export type FeedKind = "all" | "promise" | "actor" | "area";

export interface AtomEntry {
  id: string;
  title: string;
  /** RFC 3339 */
  updated: string;
  link: string;
  content: string;
  category?: { term: string; label: string };
}

export interface FeedMeta {
  id: string;
  title: string;
  subtitle?: string;
  selfUrl: string;
  alternateUrl: string;
  siteUrl: string;
  /** Used when there are no entries, so an empty feed is still stable. */
  updatedFallback: string;
}

// XML 1.0 allows tab, newline, carriage return and these ranges; anything else is dropped.
const INVALID_XML = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;

export function xmlEscape(s: string): string {
  return s
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** tag:publicledger.example,2026:promise/uk-bus-cap-2-2026/event/1 (RFC 4151). The year is fixed: the ids must never change. */
export function tagUri(siteUrl: string, path: string): string {
  let host = "localhost";
  try {
    host = new URL(siteUrl).hostname || host;
  } catch {
    // keep localhost
  }
  return `tag:${host},2026:${path}`;
}

const stamp = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : new Date(date).toISOString());

export interface EntryOptions {
  siteUrl: string;
  /** Leave out entries dated after this day (YYYY-MM-DD, UK); default today. */
  today?: string;
  /** Actor names for replies from someone other than the card's actor. */
  actorName?: (id: string) => string | undefined;
}

/** Every dated entry of one card, oldest first. Scheduled `deadline` markers are not changes, so they are left out. */
export function cardEntries(card: CardView, opts: EntryOptions): AtomEntry[] {
  const site = opts.siteUrl.replace(/\/$/, "");
  const today = opts.today ?? ukToday();
  const link = `${site}/promise/${card.id}`;
  const f = card.file;
  const who = card.actor.name;
  const quote = `${who}, ${ukDate(f.made_on)}: “${card.current.text}”`;
  const category = { term: f.policy_area, label: areaLabel(f.policy_area) };
  const statusLine = `Status now: ${statusLabel(f.status)}.`;
  const out: AtomEntry[] = [];

  f.events.forEach((e, i) => {
    if (e.type === "deadline" || e.date > today) return;
    const label = e.type === "deadline_missed" ? "Deadline passed" : eventLabel(e.type);
    out.push({
      id: tagUri(site, `promise/${card.id}/event/${i}`),
      title: `${label}: ${truncate(e.text, 140)} (${who})`,
      updated: stamp(e.date),
      link,
      category,
      content: [`${label}, ${ukDate(e.date)}: ${e.text}`, e.evidence_url ? `Evidence: ${e.evidence_url}` : null, "", quote, statusLine].filter((x) => x !== null).join("\n"),
    });
  });

  f.versions.forEach((v, i) => {
    if (i === 0 || v.recorded_on > today) return;
    const prev = f.versions[i - 1]!;
    out.push({
      id: tagUri(site, `promise/${card.id}/version/${v.version}`),
      title: `Reworded: “${truncate(v.text, 120)}” (${who})`,
      updated: stamp(v.recorded_on),
      link,
      category,
      content: [`Reworded, ${ukDate(v.recorded_on)}.`, `Was: “${prev.text}”`, `Now: “${v.text}”`, `Source: ${v.source_url}`, "", statusLine].join("\n"),
    });
  });

  f.replies.forEach((r, i) => {
    if (r.date > today) return;
    const from = opts.actorName?.(r.from_actor_id) ?? (r.from_actor_id === card.actor.id ? who : r.from_actor_id);
    out.push({
      id: tagUri(site, `promise/${card.id}/reply/${i}`),
      title: `Reply from ${from} (${truncate(card.current.text, 80)})`,
      updated: stamp(r.date),
      link,
      category,
      content: [`Reply from ${from}, ${ukDate(r.date)}:`, r.text, r.editor_response ? `\nEditors’ response: ${r.editor_response}` : null, "", quote].filter((x) => x !== null).join("\n"),
    });
  });
  return out;
}

/** Entries from many cards, newest first (ties broken by id so the order is stable). */
export function feedEntries(cards: CardView[], opts: EntryOptions, limit = 200): AtomEntry[] {
  return cards
    .flatMap((c) => cardEntries(c, opts))
    .sort((a, b) => b.updated.localeCompare(a.updated) || b.id.localeCompare(a.id))
    .slice(0, limit);
}

export function atomFeed(meta: FeedMeta, entries: AtomEntry[]): string {
  const updated = entries.reduce((max, e) => (e.updated > max ? e.updated : max), "") || meta.updatedFallback;
  const x = xmlEscape;
  const lines = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-GB">`,
    `  <id>${x(meta.id)}</id>`,
    `  <title type="text">${x(meta.title)}</title>`,
    meta.subtitle ? `  <subtitle type="text">${x(meta.subtitle)}</subtitle>` : null,
    `  <link rel="self" type="application/atom+xml" href="${x(meta.selfUrl)}"/>`,
    `  <link rel="alternate" type="text/html" href="${x(meta.alternateUrl)}"/>`,
    `  <updated>${x(updated)}</updated>`,
    `  <author><name>Public Ledger</name><uri>${x(meta.siteUrl)}</uri></author>`,
    ...entries.map((e) =>
      [
        `  <entry>`,
        `    <id>${x(e.id)}</id>`,
        `    <title type="text">${x(e.title)}</title>`,
        `    <link rel="alternate" type="text/html" href="${x(e.link)}"/>`,
        `    <updated>${x(e.updated)}</updated>`,
        e.category ? `    <category term="${x(e.category.term)}" label="${x(e.category.label)}"/>` : null,
        `    <content type="text">${x(e.content)}</content>`,
        `  </entry>`,
      ]
        .filter((l) => l !== null)
        .join("\n"),
    ),
    `</feed>`,
  ];
  return lines.filter((l) => l !== null).join("\n") + "\n";
}

/** The cards a feed covers. An actor feed of a party includes its people's cards (as on the actor page). */
export function cardsForFeed(cards: CardView[], kind: FeedKind, key: string): CardView[] {
  switch (kind) {
    case "all":
      return cards;
    case "promise":
      return cards.filter((c) => c.id === key);
    case "actor":
      return cards.filter((c) => c.actor.id === key || c.party?.id === key);
    case "area":
      return cards.filter((c) => c.file.policy_area === key);
  }
}

export const FEED_CONTENT_TYPE = "application/atom+xml; charset=utf-8";

export function feedPath(kind: FeedKind, key?: string): string {
  return kind === "all" ? "/feeds/all.xml" : `/feeds/${kind}/${key}.xml`;
}

/** A complete feed document for one of the four feed kinds. */
export function buildFeed(
  cards: CardView[],
  kind: FeedKind,
  key: string,
  opts: EntryOptions & { title: string; subtitle?: string; alternatePath: string },
): string {
  const site = opts.siteUrl.replace(/\/$/, "");
  const selected = cardsForFeed(cards, kind, key);
  const fallback = selected.map((c) => c.file.made_on).sort().at(-1) ?? "2026-01-01";
  return atomFeed(
    {
      id: tagUri(site, kind === "all" ? "feed/all" : `feed/${kind}/${key}`),
      title: opts.title,
      subtitle: opts.subtitle,
      selfUrl: `${site}${feedPath(kind, key)}`,
      alternateUrl: `${site}${opts.alternatePath}`,
      siteUrl: site,
      updatedFallback: stamp(fallback),
    },
    feedEntries(selected, opts),
  );
}
