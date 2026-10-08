import { PolicyArea, type ActorFile, type CardView, type PromiseFile } from "@ledger/schema";
import { areaLabel, costRangeText, statusLabel, ukDate } from "../alerts/labels";
import { memberUrl } from "../mp/parliament";

/**
 * How a promise card names and describes itself to search engines and AI
 * assistants: its headline, page title, meta description, last-updated date,
 * related cards and the official pages that identify its speaker. Pure
 * functions over the same content the site renders, so the page, its
 * structured data, its Markdown and llms-full.txt always agree.
 */

export const SITE_NAME = "Public Ledger";

/** Where pages and files are served from, and today's date (YYYY-MM-DD, UK time). */
export interface SeoContext {
  siteUrl: string;
  today: string;
}

export const absoluteUrl = (ctx: Pick<SeoContext, "siteUrl">, path: string) => `${ctx.siteUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

/**
 * Readable, stable slugs for the policy-area pages (/promises/area/<slug>).
 * They are URLs: never change one once published.
 */
export const AREA_SLUG: Record<PolicyArea, string> = {
  taxes: "taxes",
  social_protection: "social-protection",
  health: "health",
  education: "education",
  economic_affairs: "transport-and-economy",
  defence: "defence",
  public_order: "police-courts-and-prisons",
  general_services: "running-government",
  housing_env: "housing-and-environment",
  culture: "culture-and-sport",
};

export const areaPath = (area: PolicyArea) => `/promises/area/${AREA_SLUG[area]}`;

export function areaBySlug(slug: string): PolicyArea | null {
  return PolicyArea.options.find((a) => AREA_SLUG[a] === slug) ?? null;
}

/** Cut text to at most `max` characters at a word boundary, with "…" when cut. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const atWord = cut.replace(/\s+\S*$/, "");
  return `${(atWord.length >= max / 2 ? atWord : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** Longest fallback headline: the quote cut at a word boundary, for a card without one. */
const FALLBACK_HEADLINE = 60;

/** The card's headline, or its quote cut at a word boundary until an editor writes one. */
export const cardHeadline = (c: Pick<CardView, "file" | "current">) => c.file.headline ?? clip(c.current.text, FALLBACK_HEADLINE);

export const shortName = (a: Pick<ActorFile, "name" | "short_name">) => a.short_name ?? a.name;

/** Titles stay under about 70 characters, what search results show; past this the site name is dropped. */
export const TITLE_MAX = 75;
/** Search results show about this many characters of a description. */
export const DESCRIPTION_MAX = 160;

/**
 * "Create Great British Energy – Labour promise, Delivering | Public Ledger".
 * The site name is dropped when it would push the title past TITLE_MAX; who
 * made the promise and where it stands never are. `social` is the title for
 * link previews, without the site name (they show it separately).
 */
export function cardTitle(c: Pick<CardView, "file" | "current" | "actor">): { title: string; social: string } {
  const social = `${cardHeadline(c)} – ${shortName(c.actor)} promise, ${statusLabel(c.file.status)}`;
  const branded = `${social} | ${SITE_NAME}`;
  return { title: branded.length <= TITLE_MAX ? branded : social, social };
}

/** "Not costable", "Cost not stated", "Costs £0.36bn to £0.44bn a year": as the card shows it. */
export function cardCostText(c: Pick<CardView, "current">): string {
  const p = c.current.parameters;
  if (p === null) return "Not costable";
  return costRangeText(p.how_much_bn_per_year);
}

/** How the promise is paid for, as stated when it was made; null when the card has no parameters. */
export function cardFundingText(c: Pick<CardView, "current">): string | null {
  const p = c.current.parameters;
  if (p === null) return null;
  return p.funded_by ? `Paid for by: ${p.funded_by.replace(/\s+/g, " ").trim()}` : "Funding not stated";
}

const endSentence = (s: string) => (/[.…!?]$/.test(s) ? s : `${s}.`);

/**
 * The meta description, facts first and at most DESCRIPTION_MAX characters:
 * status, cost a year, who pays, who promised it and when; then as much of the
 * quote as fits. "Delivering. Costs £1.53bn to £1.87bn a year. Paid for by: a
 * windfall tax… Promised by Labour Party on 13 June 2024."
 */
export function cardDescription(c: Pick<CardView, "file" | "current" | "actor" | "outcomeBy">): string {
  const status = `${statusLabel(c.file.status)}${c.outcomeBy ? ` (by ${c.outcomeBy.name})` : ""}.`;
  const head = `${status} ${endSentence(cardCostText(c))}`;
  const tail = `Promised by ${c.actor.name} on ${ukDate(c.file.made_on)}.`;
  const pay = cardFundingText(c);
  // Two spaces join the three parts; the funding text gets what is left.
  const room = DESCRIPTION_MAX - head.length - tail.length - 2;
  const parts = [head, ...(pay && room >= 20 ? [endSentence(clip(pay, room - 1))] : []), tail];
  let text = parts.join(" ");
  // Fill the rest with the quote, when a useful part of it fits (a space and two quote marks).
  const left = DESCRIPTION_MAX - text.length - 3;
  if (left >= 24) text += ` “${clip(c.current.text, left)}”`;
  return text;
}

/**
 * The last day the card changed: its newest version, timeline event,
 * correction or review up to today. Future dates (a deadline) are not changes.
 * The same date is the page's "Last updated", its dateModified and the
 * sitemap's lastmod.
 */
export function cardLastUpdated(
  file: Pick<PromiseFile, "events" | "versions"> & Partial<Pick<PromiseFile, "corrections" | "reviews">>,
  today: string,
): string | undefined {
  return [...file.events.map((e) => e.date), ...file.versions.map((v) => v.recorded_on), ...(file.corrections ?? []).map((x) => x.date), ...(file.reviews ?? []).map((r) => r.on)]
    .filter((d) => d <= today)
    .sort()
    .at(-1);
}

/** Who a card counts towards: the speaker's party, or the speaker when it is a party or has none (HM Government). */
const ownerId = (c: Pick<CardView, "actor" | "party">) => (c.party ?? c.actor).id;

/**
 * Up to `max` other cards to read next: first those in the same policy area,
 * then those by the same party (or the same speaker, when it has no party).
 * Keeps the order of `all` (newest promise first), so the list is stable.
 */
export function relatedCards<C extends Pick<CardView, "id" | "file" | "actor" | "party">>(card: C, all: C[], max = 3): C[] {
  const others = all.filter((c) => c.id !== card.id);
  const sameArea = others.filter((c) => c.file.policy_area === card.file.policy_area);
  const sameParty = others.filter((c) => c.file.policy_area !== card.file.policy_area && ownerId(c) === ownerId(card));
  return [...sameArea, ...sameParty].slice(0, max);
}

/**
 * Official pages that identify an actor (schema.org sameAs): their UK
 * Parliament page, derived from their Members API id, then the pages an
 * editor checked (a party's website, a GOV.UK profile). Nothing is guessed.
 */
export function actorSameAs(a: Pick<ActorFile, "parliament_member_id" | "same_as">): string[] {
  return [...(a.parliament_member_id ? [memberUrl(a.parliament_member_id)] : []), ...(a.same_as ?? [])];
}

/** Where the area's label does not read well before "promises". */
const AREA_NOUN: Partial<Record<PolicyArea, string>> = { taxes: "Tax", public_order: "Police, courts and prisons" };

/** The area as it reads before "promises": "Health", "Tax", "Police, courts and prisons". */
export const areaName = (area: PolicyArea) => AREA_NOUN[area] ?? areaLabel(area);

/** "Health promises: what UK politicians promised and whether it happened". */
export const areaTitle = (area: PolicyArea) => `${areaName(area)} promises: what UK politicians promised and whether it happened`;

/** Statuses in ladder order, then off the ladder, for counts. */
const STATUS_ORDER = ["promised", "in_plan", "legislated", "funded", "delivering", "delivered", "failed", "quietly_dropped", "unscoreable"] as const;

/** How many cards are at each status, in ladder order, leaving out the empty ones. */
export function statusCounts(cards: Pick<CardView, "file">[]): { status: (typeof STATUS_ORDER)[number]; count: number }[] {
  return STATUS_ORDER.map((status) => ({ status, count: cards.filter((c) => c.file.status === status).length })).filter((x) => x.count > 0);
}

/**
 * An area page's description, numbers first: "9 UK political promises about
 * taxes, tracked: 3 delivered, 1 legislated, 1 in plan, 4 promised. Each…".
 */
export function areaDescription(area: PolicyArea, cards: Pick<CardView, "file">[]): string {
  const mix = statusCounts(cards)
    .map((x) => `${x.count} ${statusLabel(x.status).toLowerCase()}`)
    .join(", ");
  const n = cards.length;
  return clip(
    `${n} UK political ${n === 1 ? "promise" : "promises"} about ${areaLabel(area).toLowerCase()}, tracked: ${mix}. Each with its cost a year, who pays, the evidence and a dated timeline.`,
    DESCRIPTION_MAX,
  );
}
