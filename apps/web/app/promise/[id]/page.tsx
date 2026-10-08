import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { baseSettings, createModel, encodeScenario } from "@ledger/engine";
import { getSeed } from "@/lib/data";
import { STATUS_LABEL } from "@/lib/copy";
import { costText } from "@/lib/promises";
import { SiteHeader } from "@/components/SiteHeader";
import { PromiseDetail } from "@/components/PromiseDetail";
import { SourcesProvider } from "@/components/ui";
import { JsonLd } from "@/components/JsonLd";
import { absolute, lastChanged, SITE_NAME } from "@/lib/site";
import type { CardView } from "@ledger/schema";

/** The promise as a quotation by its speaker, on a page in the ledger. Facts only; no rating markup. */
function structuredData(card: CardView) {
  const speaker =
    card.actor.kind === "party"
      ? { "@type": "Organization", name: card.actor.name, url: absolute(`/actor/${card.actor.id}`) }
      : { "@type": "Person", name: card.actor.name, url: absolute(`/actor/${card.actor.id}`), ...(card.party ? { affiliation: { "@type": "Organization", name: card.party.name } } : {}) };
  const updated = lastChanged(card.file);
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      url: absolute(`/promise/${card.id}`),
      name: `${card.actor.name}: “${card.current.text}”`,
      inLanguage: "en-GB",
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absolute("/") },
      dateModified: updated,
      mainEntity: {
        "@type": "Quotation",
        text: card.current.text,
        spokenByCharacter: speaker,
        dateCreated: card.file.made_on,
        citation: card.file.sources.map((src) => src.url),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: absolute("/") },
        { "@type": "ListItem", position: 2, name: "Promise ledger", item: absolute("/promises") },
        { "@type": "ListItem", position: 3, name: card.actor.name, item: absolute(`/promise/${card.id}`) },
      ],
    },
  ];
}

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return getSeed().cards.map((c) => ({ id: c.id }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const card = getSeed().cards.find((c) => c.id === id);
  if (!card) return {};
  const title = `${card.actor.name}: “${card.current.text}”`;
  const funding = card.current.parameters?.funded_by ? `Paid for by: ${card.current.parameters.funded_by}` : card.current.parameters ? "Funding not stated" : "";
  const description = [`${STATUS_LABEL[card.file.status]}`, costText(card), funding].filter(Boolean).join(". ") + ".";
  return {
    title: `${title} | Public Ledger`,
    description,
    alternates: { canonical: `/promise/${id}`, types: { "application/atom+xml": [{ url: `/feeds/promise/${id}.xml`, title: `Changes to this promise` }] } },
    openGraph: { title, description, type: "article", url: `/promise/${id}` },
    twitter: { card: "summary_large_image", title, description },
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
  return (
    <SourcesProvider sources={seed.sources}>
      <JsonLd data={structuredData(card)} />
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[1100px] gap-6 px-4 pb-20 pt-8 sm:px-6">
        <a href="/promises" className="justify-self-start text-label font-medium no-underline">
          ← All promises
        </a>
        <PromiseDetail card={card} householdsM={macro.households_m} householdsP={macro.provenance.households_m!} spendingBn={spendingBn} runHref={runHref} />
      </main>
    </SourcesProvider>
  );
}
