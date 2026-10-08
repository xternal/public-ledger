import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSeed } from "@/lib/data";
import { contractTotals } from "@ledger/schema";
import { signedBn, signedMoney } from "@/lib/format";
import { delayText, showsContracts } from "@/lib/contracts";
import { SiteHeader } from "@/components/SiteHeader";
import { PromiseList } from "@/components/PromiseList";
import { CREDIT_COLUMNS, MixBar, creditRows } from "@/components/CreditTable";
import { FollowButton } from "@/components/FollowPanel";
import { followOptions } from "@/app/follow/targets";
import { JsonLd } from "@/components/JsonLd";
import { absolute, SITE_NAME } from "@/lib/site";

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return getSeed().actors.map((a) => ({ id: a.id }));
}
export const dynamicParams = false;

function cardsFor(id: string) {
  const seed = getSeed();
  const actor = seed.actors.find((a) => a.id === id);
  if (!actor) return null;
  // A party's page includes its members' cards; a person's page only their own.
  const cards = seed.cards.filter((c) => c.actor.id === id || (actor.kind === "party" && c.party?.id === id));
  return { actor, cards, seed };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const r = cardsFor(id);
  if (!r) return {};
  const title = `${r.actor.name}: promises and how they stand`;
  const description = `${r.cards.length} tracked ${r.cards.length === 1 ? "promise" : "promises"} by ${r.actor.name}, with costs, funding and status.`;
  return {
    title: `${title} | Public Ledger`,
    description,
    alternates: { canonical: `/actor/${id}`, types: { "application/atom+xml": [{ url: `/feeds/actor/${id}.xml`, title: `Changes to ${r.actor.name}'s promises` }] } },
    openGraph: { title, description, type: "profile", url: `/actor/${id}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ActorPage({ params }: Props) {
  const { id } = await params;
  const r = cardsFor(id);
  if (!r) notFound();
  const { actor, cards, seed } = r;
  const party = actor.party_id ? seed.actors.find((a) => a.id === actor.party_id) : null;
  const row = creditRows(cards, "actor").reduce(
    (acc, x) => ({
      ...acc,
      counts: acc.counts.map((n, i) => n + x.counts[i]!),
      byOthers: acc.byOthers.map((n, i) => n + x.byOthers[i]!),
      costed: acc.costed + x.costed,
      pledgedBn: acc.pledgedBn + x.pledgedBn,
      fundingNamed: acc.fundingNamed + x.fundingNamed,
    }),
    { counts: CREDIT_COLUMNS.map(() => 0), byOthers: CREDIT_COLUMNS.map(() => 0), costed: 0, pledgedBn: 0, fundingNamed: 0 },
  );
  // Contracts behind delivery (M6b): only for cards that show them, so the total matches what the cards list.
  const contracts = contractTotals(cards.filter((c) => showsContracts(c.file.status)).flatMap((c) => c.contracts));
  const about =
    actor.kind === "party"
      ? { "@type": "Organization", name: actor.name }
      : { "@type": "Person", name: actor.name, ...(actor.roles[0] ? { jobTitle: actor.roles[0].title } : {}), ...(party ? { affiliation: { "@type": "Organization", name: party.name } } : {}) };
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      url: absolute(`/actor/${actor.id}`),
      name: `${actor.name}: promises and how they stand`,
      inLanguage: "en-GB",
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absolute("/") },
      mainEntity: about,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: absolute("/") },
        { "@type": "ListItem", position: 2, name: "Promise ledger", item: absolute("/promises") },
        { "@type": "ListItem", position: 3, name: actor.name, item: absolute(`/actor/${actor.id}`) },
      ],
    },
  ];
  return (
    <>
      <JsonLd data={structuredData} />
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[1000px] gap-10 px-4 pb-20 pt-10 sm:px-6">
        <div className="grid gap-2">
          <a href="/promises" className="justify-self-start text-label font-medium">
            All promises
          </a>
          <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">{actor.name}</h1>
          <p className="m-0 text-lead text-muted">
            {actor.kind === "party" ? "Party" : actor.roles.map((ro) => ro.title).join(", ") || "Person"}
            {party ? `, ${party.name}` : ""}
          </p>
          <div className="mt-2">
            <FollowButton label={`Follow ${actor.name}`} trackKind="actor" target={{ kind: "actor", id: actor.id }} options={followOptions()} />
          </div>
        </div>

        <section aria-labelledby="record-h" className="grid gap-4">
          <h2 id="record-h" className="text-title font-semibold">
            Track record
          </h2>
          <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line py-5 sm:grid-cols-4">
            <div className="grid gap-0.5">
              <dt className="text-label text-muted">Cards</dt>
              <dd className="m-0 text-[26px] font-semibold tracking-[var(--tracking-figure)]">{cards.length}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-label text-muted">Net cost of costed cards, a year</dt>
              <dd className="m-0 text-[26px] font-semibold tracking-[var(--tracking-figure)]">{row.costed ? signedBn(row.pledgedBn) : "none"}</dd>
              <dd className="m-0 text-[12.5px] text-muted">
                {row.costed} of {cards.length} cards costed
              </dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-label text-muted">Funding named</dt>
              <dd className="m-0 text-[26px] font-semibold tracking-[var(--tracking-figure)]">
                {row.fundingNamed} of {cards.length}
              </dd>
            </div>
            <div className="grid content-start gap-2">
              <dt className="text-label text-muted">Status mix</dt>
              <dd className="m-0">
                <MixBar counts={row.counts} total={Math.max(cards.length, 1)} />
              </dd>
            </div>
          </dl>
          <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-label text-muted">
            {CREDIT_COLUMNS.map((c, i) => (
              <li key={c.label} className="inline-flex items-center gap-1.5">
                <i className="size-2 rounded-full" style={{ background: c.color }} aria-hidden />
                {c.label}: <b className="font-semibold text-ink">{row.counts[i]}</b>
                {row.byOthers[i] ? ` (${row.byOthers[i]} by others)` : ""}
              </li>
            ))}
          </ul>
          <p className="m-0 text-[12.5px] text-muted">No score: the mix speaks for itself. Every actor is held to the same promise standard.</p>
        </section>

        {contracts.count > 0 && (
          <section aria-labelledby="contracts-h" className="grid gap-3">
            <h2 id="contracts-h" className="text-title font-semibold">
              Contracts behind delivery
            </h2>
            <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line py-5 sm:grid-cols-3">
              <div className="grid gap-0.5">
                <dt className="text-label text-muted">Contracts linked</dt>
                <dd className="m-0 text-[26px] font-semibold tracking-[var(--tracking-figure)]">{contracts.count}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-label text-muted">Change in value since the first notice</dt>
                <dd className={`m-0 text-[26px] font-semibold tracking-[var(--tracking-figure)] ${contracts.valueDelta > 0 ? "text-debt-ink" : ""}`}>
                  {contracts.valueDelta ? signedMoney(contracts.valueDelta) : "None"}
                </dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-label text-muted">Median delay to the end date</dt>
                <dd className="m-0 text-[26px] font-semibold tracking-[var(--tracking-figure)]">{delayText(contracts.medianMonthsLate ?? 0)}</dd>
              </div>
            </dl>
            <p className="m-0 text-[12.5px] text-muted">
              Across the public contracts editors linked to these promises once they were funded or under way, read from the contract notices. Each promise card lists
              its contracts.
            </p>
          </section>
        )}

        <section aria-labelledby="cards-h" className="grid gap-4">
          <h2 id="cards-h" className="text-title font-semibold">
            Promises
          </h2>
          <PromiseList cards={cards} today={null} />
        </section>
      </main>
    </>
  );
}
