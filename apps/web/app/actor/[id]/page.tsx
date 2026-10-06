import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSeed } from "@/lib/data";
import { gbpBn } from "@/lib/format";
import { SiteHeader } from "@/components/SiteHeader";
import { PromiseList } from "@/components/PromiseList";
import { CREDIT_COLUMNS, MixBar, creditRows } from "@/components/CreditTable";

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
  return { title: `${r.actor.name}: promises and how they stand | Public Ledger`, description: `${r.cards.length} tracked promises by ${r.actor.name}, with costs, funding and status.` };
}

export default async function ActorPage({ params }: Props) {
  const { id } = await params;
  const r = cardsFor(id);
  if (!r) notFound();
  const { actor, cards, seed } = r;
  const party = actor.party_id ? seed.actors.find((a) => a.id === actor.party_id) : null;
  const row = creditRows(cards, "actor").reduce(
    (acc, x) => ({ ...acc, counts: acc.counts.map((n, i) => n + x.counts[i]!), costed: acc.costed + x.costed, pledgedBn: acc.pledgedBn + x.pledgedBn, fundingNamed: acc.fundingNamed + x.fundingNamed }),
    { counts: CREDIT_COLUMNS.map(() => 0), costed: 0, pledgedBn: 0, fundingNamed: 0 },
  );
  return (
    <>
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
              <dt className="text-label text-muted">Costed, a year</dt>
              <dd className="m-0 text-[26px] font-semibold tracking-[var(--tracking-figure)]">{row.costed ? gbpBn(row.pledgedBn) : "none"}</dd>
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
              </li>
            ))}
          </ul>
          <p className="m-0 text-[12.5px] text-muted">No score: the mix speaks for itself. Every actor is held to the same promise standard.</p>
        </section>

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
