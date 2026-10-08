import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { baseSettings, createModel, encodeScenario } from "@ledger/engine";
import { areaPath, cardDescription, cardHeadline, cardJsonLd, cardTitle, relatedCards } from "@ledger/server/seo";
import { getSeed } from "@/lib/data";
import { AREA_LABEL, whoShort } from "@/lib/promises";
import { SiteHeader } from "@/components/SiteHeader";
import { PromiseDetail } from "@/components/PromiseDetail";
import { SourcesProvider } from "@/components/ui";
import { JsonLd } from "@/components/JsonLd";
import { lastChanged, OPEN_GRAPH, seoContext } from "@/lib/site";

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return getSeed().cards.map((c) => ({ id: c.id }));
}
export const dynamicParams = false;

/**
 * Title "<headline> – <speaker> promise, <status> | Public Ledger"; the
 * description leads with the facts (status, cost, who pays, who and when).
 * Both come from @ledger/server/seo, like the structured data, the card's
 * Markdown (/promise/<id>.md) and /llms-full.txt.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const card = getSeed().cards.find((c) => c.id === id);
  if (!card) return {};
  const { title, social } = cardTitle(card);
  const description = cardDescription(card);
  return {
    title,
    description,
    alternates: {
      canonical: `/promise/${id}`,
      types: {
        "application/atom+xml": [{ url: `/feeds/promise/${id}.xml`, title: `Changes to this promise` }],
        "text/markdown": [{ url: `/promise/${id}.md`, title: "This promise as Markdown" }],
      },
    },
    openGraph: {
      ...OPEN_GRAPH,
      title: social,
      description,
      type: "article",
      url: `/promise/${id}`,
      section: AREA_LABEL[card.file.policy_area],
      modifiedTime: lastChanged(card.file),
    },
    twitter: { card: "summary_large_image", title: social, description },
  };
}

export default async function PromisePage({ params }: Props) {
  const { id } = await params;
  const seed = getSeed();
  const card = seed.cards.find((c) => c.id === id);
  if (!card) notFound();
  const model = createModel(seed.statement, seed.levers);
  const runHref = card.file.lever_settings
    ? `/?s=${encodeScenario(model, { ...baseSettings(model), ...card.file.lever_settings }, seed.baseYear)}#scenario`
    : null;
  const { macro } = seed.statement;
  const spendingBn = seed.statement.spending.reduce((a, l) => a + l.bn, 0);
  const related = relatedCards(card, seed.cards).map((c) => ({ id: c.id, headline: cardHeadline(c), who: whoShort(c), status: c.file.status }));
  return (
    <SourcesProvider sources={seed.sources}>
      <JsonLd data={cardJsonLd(card, seoContext())} />
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[1100px] gap-6 px-4 pb-20 pt-8 sm:px-6">
        <a href="/promises" className="justify-self-start text-label font-medium no-underline">
          ← All promises
        </a>
        <PromiseDetail
          card={card}
          householdsM={macro.households_m}
          householdsP={macro.provenance.households_m!}
          spendingBn={spendingBn}
          runHref={runHref}
          headline={cardHeadline(card)}
          updated={lastChanged(card.file) ?? null}
          areaHref={areaPath(card.file.policy_area)}
          related={related}
        />
      </main>
    </SourcesProvider>
  );
}
