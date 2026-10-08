import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PolicyArea } from "@ledger/schema";
import { AREA_SLUG, areaBySlug, areaName, areaDescription, areaPath, areaThing, areaTitle, collectionJsonLd, statusCounts } from "@ledger/server/seo";
import { getSeed } from "@/lib/data";
import { STATUS_LABEL } from "@/lib/copy";
import { AREA_LABEL } from "@/lib/promises";
import { SiteHeader } from "@/components/SiteHeader";
import { PromiseList, StatusPill } from "@/components/PromiseList";
import { CREDIT_COLUMNS, MixBar, creditRows } from "@/components/CreditTable";
import { FollowButton } from "@/components/FollowPanel";
import { followOptions } from "@/app/follow/targets";
import { JsonLd } from "@/components/JsonLd";
import { OPEN_GRAPH, seoContext } from "@/lib/site";

type Props = { params: Promise<{ area: string }> };

/** Areas with at least one card; an empty area has no page (and no thin page for search engines). */
function areasWithCards(): PolicyArea[] {
  return [...new Set(getSeed().cards.map((c) => c.file.policy_area))];
}

export function generateStaticParams() {
  return areasWithCards().map((a) => ({ area: AREA_SLUG[a] }));
}
export const dynamicParams = false;

function load(slug: string) {
  const area = areaBySlug(slug);
  if (!area) return null;
  const cards = getSeed().cards.filter((c) => c.file.policy_area === area);
  return cards.length ? { area, cards } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = load((await params).area);
  if (!r) return {};
  const title = areaTitle(r.area);
  const description = areaDescription(r.area, r.cards);
  const path = areaPath(r.area);
  return {
    title,
    description,
    alternates: { canonical: path, types: { "application/atom+xml": [{ url: `/feeds/area/${r.area}.xml`, title: `Changes to ${areaName(r.area).toLowerCase()} promises` }] } },
    openGraph: { ...OPEN_GRAPH, title, description, type: "website", url: path },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * Every card in one policy area (/promises/area/<slug>): how they stand,
 * who made them (linking each party's own page), and the list. Parties keep
 * their pages at /actor/<id>; this page never duplicates them.
 */
export default async function AreaPage({ params }: Props) {
  const r = load((await params).area);
  if (!r) notFound();
  const { area, cards } = r;
  const label = AREA_LABEL[area];
  const path = areaPath(area);
  const mix = CREDIT_COLUMNS.map((col) => cards.filter((c) => col.statuses.includes(c.file.status)).length);
  const byStatus = statusCounts(cards);
  const owners = creditRows(cards, "party");
  const costed = cards.filter((c) => c.current.parameters?.how_much_bn_per_year).length;
  const fundingNamed = cards.filter((c) => c.current.parameters?.funded_by).length;
  const others = areasWithCards()
    .filter((a) => a !== area)
    .sort((a, b) => AREA_LABEL[a].localeCompare(AREA_LABEL[b]));
  const structuredData = collectionJsonLd(
    {
      path,
      name: areaTitle(area),
      description: areaDescription(area, cards),
      cards,
      about: areaThing(area, seoContext()),
      breadcrumb: [
        { name: "Promise ledger", path: "/promises" },
        { name: label, path },
      ],
    },
    seoContext(),
  );
  const figure = "m-0 text-[26px] font-semibold tracking-[var(--tracking-figure)]";
  return (
    <>
      <JsonLd data={structuredData} />
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[1000px] gap-10 px-4 pb-20 pt-10 sm:px-6">
        <div className="grid gap-2">
          <a href="/promises" className="justify-self-start text-label font-medium">
            All promises
          </a>
          <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">{areaName(area)} promises</h1>
          <p className="m-0 max-w-[62ch] text-lead text-muted">
            Every UK political promise we track about {label.toLowerCase()}: what was promised and by whom, what it would cost a year, who pays, and whether it
            happened.
          </p>
          <div className="mt-2">
            <FollowButton label={`Follow ${areaName(area).toLowerCase()} promises`} trackKind="area" target={{ kind: "area", id: area }} options={followOptions()} />
          </div>
        </div>

        <section aria-labelledby="stand-h" className="grid gap-4">
          <h2 id="stand-h" className="text-title font-semibold">
            Where they stand
          </h2>
          <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line py-5 sm:grid-cols-4">
            <div className="grid gap-0.5">
              <dt className="text-label text-muted">Cards</dt>
              <dd className={figure}>{cards.length}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-label text-muted">Costed</dt>
              <dd className={figure}>
                {costed} of {cards.length}
              </dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-label text-muted">Funding named</dt>
              <dd className={figure}>
                {fundingNamed} of {cards.length}
              </dd>
            </div>
            <div className="grid content-start gap-2">
              <dt className="text-label text-muted">Status mix</dt>
              <dd className="m-0">
                <MixBar counts={mix} total={Math.max(cards.length, 1)} />
              </dd>
            </div>
          </dl>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-label text-muted" aria-label="Cards by status">
            {byStatus.map((x) => (
              <li key={x.status} className="inline-flex items-center gap-1.5">
                <StatusPill status={x.status} />
                <b className="font-semibold text-ink">{x.count}</b>
                <span className="sr-only">{x.count === 1 ? "card" : "cards"} {STATUS_LABEL[x.status]}</span>
              </li>
            ))}
          </ul>
          {owners.length > 0 && (
            <p className="m-0 text-label text-muted">
              Made by{" "}
              {owners.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && (i === owners.length - 1 ? " and " : ", ")}
                  <a href={o.href}>{o.name}</a> ({o.cards.length})
                </span>
              ))}
              .
            </p>
          )}
        </section>

        <section aria-labelledby="cards-h" className="grid gap-4">
          <h2 id="cards-h" className="text-title font-semibold">
            Promises
          </h2>
          <PromiseList cards={cards} today={null} />
        </section>

        <section aria-labelledby="how-h" className="grid max-w-[66ch] gap-3 border-t border-line pt-8 text-muted">
          <h2 id="how-h" className="m-0 text-title font-semibold text-ink">
            How this page works
          </h2>
          <p className="m-0">
            Each card quotes the promise in the speaker&apos;s own words and links to where it was said. Its status moves only on evidence: a plan, a bill, money in a
            Budget, or delivery. Costs are a year, as a range, with their source. Every party is held to{" "}
            <a href="https://github.com/xternal/public-ledger/blob/main/docs/PROMISE_STANDARD.md">the same published standard</a>; <a href="/method">the method</a>{" "}
            explains how cards are checked.
          </p>
          <p className="m-0">
            Follow this area by email or Telegram with the button above, or in a feed reader:{" "}
            <a href={`/feeds/area/${area}.xml`} type="application/atom+xml">
              the {label.toLowerCase()} feed
            </a>
            .
          </p>
        </section>

        {others.length > 0 && (
          <nav aria-labelledby="areas-h" className="grid gap-2">
            <h2 id="areas-h" className="m-0 text-label font-medium text-muted">
              Other policy areas
            </h2>
            <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-label">
              {others.map((a) => (
                <li key={a}>
                  <a href={areaPath(a)}>{AREA_LABEL[a]}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </main>
    </>
  );
}
