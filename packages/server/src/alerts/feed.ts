import { alertWindows, dueInWindow, isDeadlineWindow, monthKey, windowPhrase, COSTED_BY_LABEL, WINDOW_LABEL, type CardView, type ContractLink, type DeadlineWindow } from "@ledger/schema";
import { contractChangeText, contractLinkedText, type Headline, type LooseContract } from "./data";
import { CONTRACT_STATUSES, areaLabel, costRangeText, eventLabel, gbpBnText, statusLabel, truncate, ukDate, ukToday } from "./labels";

/**
 * Atom 1.0 feeds (RFC 4287) built from content and data/build alone, no
 * database: one entry per timeline event, rewording (version 2 onwards),
 * published reply, change to a card's current cost and contract snapshot, and
 * one per edition of the headline figures. Entry ids are tag: URIs that depend
 * only on the card id and the entry's position in its append-only history
 * (invariant 5), or on the edition, so they never change.
 */

export type FeedKind = "all" | "promise" | "actor" | "area" | "deadlines" | "updates";

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
  out.push(...costEntries(card, opts));
  out.push(...contractEntries(card, opts));
  return out;
}

const COST_CORRECTION = /^versions\[(\d+)\]\.parameters\.how_much_bn_per_year$/;
const sameCost = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Changes to a card's current cost. A new official figure, or a fix to ours,
 * is a correction to the version (PROMISE_STANDARD §9, BUDGET_DAY.md); a
 * rewording can carry a new cost. One entry per correction of a version's cost
 * made while that version was the current one, and one per new version whose
 * cost differs from the version before. Ids depend only on the card id and the
 * entry's position in its append-only history, so they never change.
 */
export function costEntries(card: CardView, opts: EntryOptions): AtomEntry[] {
  const site = opts.siteUrl.replace(/\/$/, "");
  const today = opts.today ?? ukToday();
  const f = card.file;
  const who = card.actor.name;
  const link = `${site}/promise/${card.id}`;
  const category = { term: f.policy_area, label: areaLabel(f.policy_area) };
  const quote = `${who}, ${ukDate(f.made_on)}: “${card.current.text}”`;
  const statusLine = `Status now: ${statusLabel(f.status)}.`;
  const out: AtomEntry[] = [];
  /** Who made the figure, when the version still carries it. */
  const maker = (k: number, figure: unknown) => {
    const p = f.versions[k]?.parameters;
    return p?.costed_by && sameCost(p.how_much_bn_per_year, figure) ? `Central figure by ${p.costed_by.name} (${COSTED_BY_LABEL[p.costed_by.kind]}).` : null;
  };
  const entry = (id: string, date: string, now: unknown, was: unknown, lines: (string | null)[]): AtomEntry => ({
    id: tagUri(site, `promise/${card.id}/cost/${id}`),
    // Worded as the email and Telegram alert for the same change (diff.ts).
    title: `Cost changed: now ${lower(costRangeText(now as number[] | null))}, was ${lower(costRangeText(was as number[] | null))} (${who})`,
    updated: stamp(date),
    link,
    category,
    content: [`Cost changed, ${ukDate(date)}: now ${lower(costRangeText(now as number[] | null))}; was ${lower(costRangeText(was as number[] | null))}.`, ...lines, "", quote, statusLine]
      .filter((x) => x !== null)
      .join("\n"),
  });

  f.corrections.forEach((c, i) => {
    const m = COST_CORRECTION.exec(c.path);
    if (!m || c.date > today || sameCost(c.was, c.now)) return;
    const k = Number(m[1]);
    const next = f.versions[k + 1];
    if (next && next.recorded_on <= c.date) return; // that version was no longer the current one
    out.push(entry(`correction/${i}`, c.date, c.now, c.was, [maker(k, c.now), `Why: ${c.reason}`, c.source_url ? `Source: ${c.source_url}` : null]));
  });

  f.versions.forEach((v, k) => {
    if (k === 0 || v.recorded_on > today) return;
    const was = f.versions[k - 1]!.parameters?.how_much_bn_per_year ?? null;
    const now = v.parameters?.how_much_bn_per_year ?? null;
    if (sameCost(was, now)) return;
    out.push(entry(`version/${v.version}`, v.recorded_on, now, was, [maker(k, now), `With the reworded promise (version ${v.version}). Source: ${v.source_url}`]));
  });
  return out;
}

const SOURCE_NAME: Record<string, string> = { find_a_tender: "Find a Tender", contracts_finder: "Contracts Finder", zakupki: "zakupki.gov.ru" };

const looseContract = (c: ContractLink): LooseContract => ({
  key: c.key,
  title: c.title,
  buyer: c.buyer,
  supplier: c.supplier.name,
  awarded_on: c.awarded_on,
  notice_url: c.notice_url,
  snapshots: c.snapshots,
});

/**
 * A card's linked contracts, once the card shows them (funded or later): the
 * first snapshot as "Contract linked", each later one as "Contract changed".
 * Snapshots are append-only (M6b), so the entries never change.
 */
export function contractEntries(card: CardView, opts: EntryOptions): AtomEntry[] {
  if (!CONTRACT_STATUSES.includes(card.file.status)) return [];
  const site = opts.siteUrl.replace(/\/$/, "");
  const today = opts.today ?? ukToday();
  const who = card.actor.name;
  const link = `${site}/promise/${card.id}#contracts-${card.id}`;
  const category = { term: card.file.policy_area, label: areaLabel(card.file.policy_area) };
  const quote = `${who}, ${ukDate(card.file.made_on)}: “${card.current.text}”`;
  return card.contracts.flatMap((c) => {
    const loose = looseContract(c);
    const source = `Source: ${SOURCE_NAME[c.source] ?? c.source} notice, ${c.notice_url} (sourced).`;
    return c.snapshots.flatMap((snap, i): AtomEntry[] => {
      if (snap.fetched_at > today) return [];
      const text = i === 0 ? contractLinkedText({ ...loose, snapshots: [snap] }) : contractChangeText(loose, c.snapshots[i - 1]!, snap);
      if (!text) return [];
      return [
        {
          id: tagUri(site, `promise/${card.id}/contract/${c.key}/${i}`),
          title: `${truncate(text, 140)} (${who})`,
          updated: stamp(snap.fetched_at),
          link,
          category,
          content: [`${text} Seen on ${ukDate(snap.fetched_at)}.`, source, "", quote, `Status now: ${statusLabel(card.file.status)}.`].join("\n"),
        },
      ];
    });
  });
}

/**
 * One entry per edition of the Statement's headline figures (an OBR forecast,
 * an ONS outturn release), listing what that edition says for each of its
 * years. History is not kept in data/build, so the feed carries the editions
 * in use now; a feed reader keeps the earlier ones it has seen.
 */
export function editionEntries(headlines: Headline[], opts: Pick<EntryOptions, "siteUrl">): AtomEntry[] {
  const site = opts.siteUrl.replace(/\/$/, "");
  const byVintage = new Map<string, Headline[]>();
  for (const h of [...headlines].sort((a, b) => a.year.localeCompare(b.year))) byVintage.set(h.vintage, [...(byVintage.get(h.vintage) ?? []), h]);
  return [...byVintage.values()].map((years) => {
    // The year a reader looks at first: the latest outturn, or the nearest forecast.
    const lead = years[0]!.kind === "outturn" ? years[years.length - 1]! : years[0]!;
    const source = lead.source;
    const published = years.map((h) => h.source?.published_on).filter((d): d is string => !!d).sort().at(-1);
    return {
      id: tagUri(site, `edition/${lead.vintage.replace(/[^A-Za-z0-9.-]+/g, "_")}`),
      title: `Borrowing ${gbpBnText(lead.borrowing)} in ${lead.year}: ${lead.vintage_label}`,
      updated: stamp(published ?? `${lead.year.slice(0, 4)}-04-01`),
      link: `${site}/#statement`,
      category: { term: "edition", label: "Headline figures" },
      content: [
        `${lead.vintage_label}: what the Statement shows, year by year.`,
        "",
        ...years.map((h) => `${h.year}: borrowing ${gbpBnText(h.borrowing)}, income ${gbpBnText(h.income)}, spending ${gbpBnText(h.spending)}.`),
        "",
        source ? `Source: ${source.title}, ${source.url} (${lead.quality ?? "sourced"}).` : null,
      ]
        .filter((x) => x !== null)
        .join("\n"),
    };
  });
}

/**
 * A deadline window's feed: the outcomes its followers hear about (delivered,
 * deadline passed) for promises whose deadline fell in the window, judged on
 * the day of the outcome, and this month's list of what is coming due.
 */
export function deadlineEntries(cards: CardView[], w: DeadlineWindow, opts: EntryOptions): AtomEntry[] {
  const site = opts.siteUrl.replace(/\/$/, "");
  const today = opts.today ?? ukToday();
  const out: AtomEntry[] = [];
  for (const card of cards) {
    const deadline = card.file.deadline;
    if (!deadline) continue;
    const who = card.actor.name;
    card.file.events.forEach((e, i) => {
      if ((e.type !== "delivered" && e.type !== "deadline_missed") || e.date > today) return;
      if (!alertWindows(deadline, e.date).includes(w)) return;
      const label = e.type === "deadline_missed" ? "Deadline passed" : eventLabel(e.type);
      out.push({
        id: tagUri(site, `promise/${card.id}/event/${i}`),
        title: `${label}: ${truncate(card.current.text, 120)} (${who}, due ${ukDate(deadline)})`,
        updated: stamp(e.date),
        link: `${site}/promise/${card.id}`,
        category: { term: card.file.policy_area, label: areaLabel(card.file.policy_area) },
        content: [`${label}, ${ukDate(e.date)}: ${e.text}`, e.evidence_url ? `Evidence: ${e.evidence_url}` : null, "", `${who}, ${ukDate(card.file.made_on)}: “${card.current.text}”`, `Deadline: ${ukDate(deadline)}. Status now: ${statusLabel(card.file.status)}.`]
          .filter((x) => x !== null)
          .join("\n"),
      });
    });
  }
  const due = dueInWindow(
    cards.map((c) => ({ id: c.id, deadline: c.file.deadline, status: c.file.status, card: c })),
    w,
    today,
  );
  if (due.length) {
    const when = windowPhrase(w, today);
    out.push({
      id: tagUri(site, `deadlines/${w}/${monthKey(today)}`),
      title: `Coming due: ${due.length} ${due.length === 1 ? "promise" : "promises"} ${when}`,
      updated: stamp(`${monthKey(today)}-01`),
      link: `${site}/promises#coming-up`,
      content: [
        `Open promises due ${when}, nearest deadline first:`,
        "",
        ...due.map(({ card: c }) => `${ukDate(c.file.deadline!)}: ${c.actor.name}, “${truncate(c.current.text, 160)}” (${statusLabel(c.file.status)}${c.file.deadline! < today ? ", deadline passed" : ""}). ${site}/promise/${c.id}`),
      ].join("\n"),
    });
  }
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
    case "deadlines":
    case "updates":
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
  return kind === "all" || kind === "updates" ? `/feeds/${kind}.xml` : `/feeds/${kind}/${key}.xml`;
}

const newestFirst = (entries: AtomEntry[], limit = 200) => entries.sort((a, b) => b.updated.localeCompare(a.updated) || b.id.localeCompare(a.id)).slice(0, limit);

/**
 * A complete feed document. "all" is every change (cards, their costs and
 * contracts, and new editions of the headline figures), like following
 * everything by email; "updates" is the data changes only (costs, contracts,
 * editions); "deadlines" is one deadline window.
 */
export function buildFeed(
  cards: CardView[],
  kind: FeedKind,
  key: string,
  opts: EntryOptions & { title: string; subtitle?: string; alternatePath: string; headlines?: Headline[] },
): string {
  const site = opts.siteUrl.replace(/\/$/, "");
  const selected = cardsForFeed(cards, kind, key);
  const fallback = selected.map((c) => c.file.made_on).sort().at(-1) ?? "2026-01-01";
  const editions = () => editionEntries(opts.headlines ?? [], opts);
  const entries =
    kind === "deadlines"
      ? isDeadlineWindow(key)
        ? newestFirst(deadlineEntries(selected, key, opts))
        : []
      : kind === "updates"
        ? newestFirst([...selected.flatMap((c) => [...costEntries(c, opts), ...contractEntries(c, opts)]), ...editions()])
        : kind === "all"
          ? newestFirst([...selected.flatMap((c) => cardEntries(c, opts)), ...editions()])
          : feedEntries(selected, opts);
  return atomFeed(
    {
      id: tagUri(site, kind === "all" || kind === "updates" ? `feed/${kind}` : `feed/${kind}/${key}`),
      title: opts.title,
      subtitle: opts.subtitle,
      selfUrl: `${site}${feedPath(kind, key)}`,
      alternateUrl: `${site}${opts.alternatePath}`,
      siteUrl: site,
      updatedFallback: stamp(fallback),
    },
    entries,
  );
}

/** Feed titles for deadline windows: "Public Ledger: promises due in the next 3 months". */
export const windowFeedTitle = (w: DeadlineWindow) => `Public Ledger: promises ${WINDOW_LABEL[w].charAt(0).toLowerCase()}${WINDOW_LABEL[w].slice(1)}`;
