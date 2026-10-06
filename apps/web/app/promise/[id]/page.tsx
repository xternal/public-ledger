import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { baseSettings, createModel, encodeScenario } from "@ledger/engine";
import { getSeed } from "@/lib/data";
import { STATUS_LABEL } from "@/lib/copy";
import { costText, whoLine } from "@/lib/promises";
import { SiteHeader } from "@/components/SiteHeader";
import { PromiseDetail } from "@/components/PromiseDetail";
import { SourcesProvider } from "@/components/ui";

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
  return { title: `${title} | Public Ledger`, description, openGraph: { title, description, type: "article" }, twitter: { card: "summary_large_image", title, description } };
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
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[880px] gap-6 px-4 pb-20 pt-10 sm:px-6">
        <a href="/promises" className="justify-self-start text-label font-medium">
          All promises
        </a>
        <PromiseDetail card={card} householdsM={macro.households_m} householdsP={macro.provenance.households_m!} spendingBn={spendingBn} runHref={runHref} />
        <p className="m-0 border-t border-line pt-5 text-[12.5px] text-muted">
          Status follows the <a href="https://github.com/xternal/public-ledger/blob/main/docs/PROMISE_STANDARD.md">promise standard</a>, the same for every party.
          Anyone named on a card can reply, and replies are published next to it. {whoLine(card)}.
        </p>
      </main>
    </SourcesProvider>
  );
}
