import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { collectionJsonLd } from "@ledger/server/seo";
import { getSeed } from "@/lib/data";
import { BUDGET, BUDGET_TOPICS, budgetDay, topicCards } from "@/lib/budget";
import { todayIso } from "@/lib/promises";
import { SiteHeader } from "@/components/SiteHeader";
import { PromiseList } from "@/components/PromiseList";
import { JsonLd } from "@/components/JsonLd";
import { OPEN_GRAPH, seoContext } from "@/lib/site";

type Props = { params: Promise<{ topic: string }> };

/** A topic with at least one card; a topic without cards has no page. */
function load(id: string) {
  const topic = BUDGET_TOPICS.find((t) => t.id === id);
  if (!topic) return null;
  const cards = topicCards(getSeed().cards, topic);
  return cards.length ? { topic, cards } : null;
}

export function generateStaticParams() {
  return BUDGET_TOPICS.filter((t) => load(t.id)).map((t) => ({ topic: t.id }));
}
export const dynamicParams = false;
/** Hourly, like /budget, so Budget-day changes show without a deploy. */
export const revalidate = 3600;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = load((await params).topic);
  if (!r) return {};
  const path = `/budget/${r.topic.id}`;
  const { heading: title, description } = r.topic;
  return {
    title: `${title} | Public Ledger`,
    description,
    alternates: { canonical: path },
    openGraph: { ...OPEN_GRAPH, title, description, type: "website", url: path },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * /budget/<topic>: one question readers bring to the Budget, on its own page
 * so it can be shared with its own card. The same list and rule as the
 * section on /budget.
 */
export default async function BudgetTopicPage({ params }: Props) {
  const r = load((await params).topic);
  if (!r) notFound();
  const { topic, cards } = r;
  const path = `/budget/${topic.id}`;
  const structuredData = collectionJsonLd(
    {
      path,
      name: topic.heading,
      description: topic.description,
      cards,
      breadcrumb: [
        { name: "Promise ledger", path: "/promises" },
        { name: BUDGET.name, path: "/budget" },
        { name: topic.title, path },
      ],
    },
    seoContext(),
  );

  return (
    <>
      <JsonLd data={structuredData} />
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[1000px] gap-10 px-4 pb-20 pt-10 sm:px-6">
        <header className="grid max-w-[68ch] gap-4">
          <a href="/budget" className="justify-self-start text-label font-medium">
            {BUDGET.name}
          </a>
          <p className="m-0 text-label font-medium text-muted">Budget day: {budgetDay()}</p>
          <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">{topic.heading}</h1>
          <p className="m-0 text-lead text-muted">{topic.intro}</p>
          <p className="m-0 text-label text-muted">
            Sources:{" "}
            {topic.sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 && " · "}
                <a href={s.url}>{s.title}</a>
              </span>
            ))}
          </p>
        </header>

        <section aria-label={topic.heading} className="grid gap-4">
          <PromiseList cards={cards} today={todayIso()} />
        </section>

        <section aria-labelledby="more-h" className="grid max-w-[68ch] gap-3 border-t border-line pt-8">
          <h2 id="more-h" className="m-0 text-title font-semibold">
            How this list is made
          </h2>
          <p className="m-0 text-muted">
            It shows every promise we track whose headline, words or status note mention {topic.title.toLowerCase()}: the same rule for every party. The
            government&apos;s come first, because only the government sets a Budget; then the rest, the largest cost first. Each card links to its source and
            shows any correction.
          </p>
          <p className="m-0 text-muted">
            See <a href="/budget">all the promises the Budget could fund or break</a> and <a href="/method">how the numbers are made</a>.
          </p>
        </section>
      </main>
    </>
  );
}
