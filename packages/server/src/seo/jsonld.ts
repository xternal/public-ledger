import type { ActorFile, CardView, PolicyArea } from "@ledger/schema";
import { areaLabel } from "../alerts/labels";
import { OWN_WORK_LICENCE } from "../api/envelope";
import { absoluteUrl, actorSameAs, areaPath, cardDescription, cardHeadline, cardLastUpdated, cardTitle, shortName, SITE_NAME, type SeoContext } from "./cards";

/**
 * schema.org structured data (JSON-LD) for the promise pages: facts only, no
 * rating markup. Every builder returns plain objects; the web app prints
 * them in a <script type="application/ld+json">.
 */

export type JsonLdObject = Record<string, unknown>;

const CONTEXT = "https://schema.org";

const website = (ctx: SeoContext) => ({ "@type": "WebSite", "@id": absoluteUrl(ctx, "/#website"), name: SITE_NAME, url: absoluteUrl(ctx, "/") });

/** The policy area as the subject of a page: a Thing with its own page. */
export const areaThing = (area: PolicyArea, ctx: SeoContext) => ({ "@type": "Thing", name: areaLabel(area), url: absoluteUrl(ctx, areaPath(area)) });

/** Roles held today (no end date), for jobTitle. A past role is not a job title. */
const currentRoles = (a: ActorFile, today: string) => a.roles.filter((r) => (!r.from || r.from <= today) && (!r.to || r.to >= today)).map((r) => r.title);

/**
 * A speaker as a Person, Organization or GovernmentOrganization, with its
 * page on Public Ledger and the official pages that identify it (sameAs). A
 * person carries their party as affiliation.
 */
export function actorEntity(a: ActorFile, party: ActorFile | null, ctx: SeoContext, opts: { jobTitle?: boolean } = {}): JsonLdObject {
  const sameAs = actorSameAs(a);
  const base = {
    "@id": absoluteUrl(ctx, `/actor/${a.id}#${a.kind === "person" ? "person" : "organization"}`),
    name: a.name,
    ...(a.short_name ? { alternateName: a.short_name } : {}),
    url: absoluteUrl(ctx, `/actor/${a.id}`),
    ...(sameAs.length ? { sameAs } : {}),
  };
  if (a.kind !== "person") return { "@type": a.kind === "government" ? "GovernmentOrganization" : "Organization", ...base };
  const roles = opts.jobTitle ? currentRoles(a, ctx.today) : [];
  return {
    "@type": "Person",
    ...base,
    ...(roles.length ? { jobTitle: roles.length === 1 ? roles[0] : roles } : {}),
    ...(party && party.id !== a.id ? { affiliation: actorEntity(party, null, ctx) } : {}),
  };
}

const crumbs = (items: { name: string; path: string }[], ctx: SeoContext): JsonLdObject => ({
  "@context": CONTEXT,
  "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absoluteUrl(ctx, it.path) })),
});

/** The newest last-updated date among some cards. */
export const latestUpdate = (cards: Pick<CardView, "file">[], ctx: SeoContext) =>
  cards
    .map((c) => cardLastUpdated(c.file, ctx.today))
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);

/**
 * A promise card: a WebPage about its policy area whose main entity is the
 * promise as a Quotation by its speaker, and the breadcrumb trail
 * Public Ledger › Promise ledger › area › card.
 */
export function cardJsonLd(c: CardView, ctx: SeoContext): JsonLdObject[] {
  const path = `/promise/${c.id}`;
  const url = absoluteUrl(ctx, path);
  const area = areaThing(c.file.policy_area, ctx);
  const updated = cardLastUpdated(c.file, ctx.today);
  return [
    {
      "@context": CONTEXT,
      "@type": "WebPage",
      "@id": url,
      url,
      name: cardTitle(c).social,
      headline: cardHeadline(c),
      description: cardDescription(c),
      inLanguage: "en-GB",
      isPartOf: website(ctx),
      ...(updated ? { dateModified: updated } : {}),
      about: area,
      license: OWN_WORK_LICENCE.url,
      mainEntity: {
        "@type": "Quotation",
        text: c.current.text,
        spokenByCharacter: actorEntity(c.actor, c.party, ctx),
        dateCreated: c.file.made_on,
        about: area,
        isBasedOn: c.current.source_url,
        citation: c.file.sources.map((s) => s.url),
      },
    },
    crumbs(
      [
        { name: SITE_NAME, path: "/" },
        { name: "Promise ledger", path: "/promises" },
        { name: areaLabel(c.file.policy_area), path: areaPath(c.file.policy_area) },
        { name: cardHeadline(c), path },
      ],
      ctx,
    ),
  ];
}

/** An ItemList of cards, named by their headlines, in the order the page shows them. */
export function cardItemList(cards: Pick<CardView, "id" | "file" | "current" | "actor">[], ctx: SeoContext): JsonLdObject {
  return {
    "@type": "ItemList",
    numberOfItems: cards.length,
    itemListElement: cards.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: absoluteUrl(ctx, `/promise/${c.id}`),
      name: `${cardHeadline(c)} (${shortName(c.actor)})`,
    })),
  };
}

export interface CollectionInput {
  path: string;
  name: string;
  description: string;
  cards: CardView[];
  /** The trail above this page, after the site itself. */
  breadcrumb?: { name: string; path: string }[];
  about?: JsonLdObject;
}

/** A page that lists cards (/promises, an area page): a CollectionPage whose main entity is the list. */
export function collectionJsonLd(input: CollectionInput, ctx: SeoContext): JsonLdObject[] {
  const url = absoluteUrl(ctx, input.path);
  const updated = latestUpdate(input.cards, ctx);
  return [
    {
      "@context": CONTEXT,
      "@type": "CollectionPage",
      "@id": url,
      url,
      name: input.name,
      description: input.description,
      inLanguage: "en-GB",
      isPartOf: website(ctx),
      ...(updated ? { dateModified: updated } : {}),
      ...(input.about ? { about: input.about } : {}),
      mainEntity: cardItemList(input.cards, ctx),
    },
    ...(input.breadcrumb ? [crumbs([{ name: SITE_NAME, path: "/" }, ...input.breadcrumb], ctx)] : []),
  ];
}

/** An actor's page: a ProfilePage about the person or organisation, with sameAs links, and its breadcrumb. */
export function actorJsonLd(a: ActorFile, party: ActorFile | null, cards: CardView[], ctx: SeoContext): JsonLdObject[] {
  const path = `/actor/${a.id}`;
  const url = absoluteUrl(ctx, path);
  const updated = latestUpdate(cards, ctx);
  return [
    {
      "@context": CONTEXT,
      "@type": "ProfilePage",
      "@id": url,
      url,
      name: `${a.name}: promises and how they stand`,
      inLanguage: "en-GB",
      isPartOf: website(ctx),
      ...(updated ? { dateModified: updated } : {}),
      mainEntity: actorEntity(a, party, ctx, { jobTitle: true }),
    },
    crumbs(
      [
        { name: SITE_NAME, path: "/" },
        { name: "Promise ledger", path: "/promises" },
        { name: a.name, path },
      ],
      ctx,
    ),
  ];
}
