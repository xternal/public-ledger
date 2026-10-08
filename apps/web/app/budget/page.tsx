import type { Metadata } from "next";
import type { CardView } from "@ledger/schema";
import { collectionJsonLd } from "@ledger/server/seo";
import { getSeed } from "@/lib/data";
import { EVENT_LABEL } from "@/lib/copy";
import { AREA_LABEL, todayIso } from "@/lib/promises";
import { BUDGET, budgetDayEvents, budgetWatch } from "@/lib/budget";
import { SiteHeader } from "@/components/SiteHeader";
import { PromiseList, StatusPill } from "@/components/PromiseList";
import { FollowButton } from "@/components/FollowPanel";
import { followOptions, followWindows } from "@/app/follow/targets";
import { JsonLd } from "@/components/JsonLd";
import { OPEN_GRAPH, seoContext } from "@/lib/site";

/** Re-render hourly, so the page turns from "to watch" to "what it did" on Budget day without a deploy. */
export const revalidate = 3600;

/** "Wednesday 28 October 2026" */
const dayDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-GB", { ...o, timeZone: "Europe/London" });
  return `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "long" })} ${part({ year: "numeric" })}`;
};

const TITLE = `${BUDGET.name}: the promises it could fund or break`;
const DESCRIPTION = `The Budget on ${dayDate(BUDGET.date)} can fund, change or break the government's promises. The ones to watch, what each would cost a year, and, from Budget day, what it did to each.`;

export const metadata: Metadata = {
  title: `${TITLE} | Public Ledger`,
  description: DESCRIPTION,
  alternates: { canonical: "/budget" },
  openGraph: { ...OPEN_GRAPH, title: TITLE, description: DESCRIPTION, type: "website", url: "/budget" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const h2 = "m-0 text-title font-semibold";
const section = "grid gap-4";
const figure = "m-0 text-[26px] font-semibold tracking-[var(--tracking-figure)]";

/**
 * /budget: the government's promises a Budget can still move, before the
 * day; from the day, what it did to each, as editors add the evidence. One
 * list at a time, the most expensive first; the rest folded away.
 */
export default function BudgetPage() {
  const seed = getSeed();
  const today = todayIso();
  const after = today >= BUDGET.date;
  const w = budgetWatch(seed.cards);
  const watched = [...w.needMoney, ...w.tax, ...w.other];
  const when = dayDate(BUDGET.date);
  const structuredData = collectionJsonLd(
    {
      path: "/budget",
      name: TITLE,
      description: DESCRIPTION,
      cards: [...w.moved, ...watched, ...w.opposition].filter((c, i, all) => all.indexOf(c) === i),
      about: {
        "@type": "Event",
        name: BUDGET.name,
        startDate: BUDGET.date,
        location: { "@type": "Place", name: "House of Commons, London" },
        organizer: { "@type": "GovernmentOrganization", name: "HM Treasury" },
      },
      breadcrumb: [
        { name: "Promise ledger", path: "/promises" },
        { name: BUDGET.name, path: "/budget" },
      ],
    },
    seoContext(),
  );

  return (
    <>
      <JsonLd data={structuredData} />
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[1000px] gap-12 px-4 pb-20 pt-10 sm:px-6">
        <header className="grid max-w-[68ch] gap-4">
          <a href="/promises" className="justify-self-start text-label font-medium">
            All promises
          </a>
          <p className="m-0 text-label font-medium text-muted">
            {when} · <a href={BUDGET.source.url}>date: House of Commons Library</a>
          </p>
          <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">
            {after ? `${BUDGET.name}: what it did to the promises` : `${BUDGET.name}: the promises to watch`}
          </h1>
          <p className="m-0 text-lead text-muted">
            In a Budget the Chancellor sets out the government&apos;s taxes and spending. It is one of the four kinds of evidence that move a promise here:
            money in a Budget moves a card to Funded, and a tax change can keep or break a pledge. Only the government sets a Budget, so these are the
            government&apos;s promises it can still move.
          </p>
          <div>
            <FollowButton
              label="Get an email when a promise moves"
              trackKind="area"
              areas={Object.entries(AREA_LABEL).map(([id, label]) => ({ id, label }))}
              windows={followWindows()}
              options={followOptions()}
            />
          </div>
        </header>

        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line py-5 sm:grid-cols-4">
          {after && (
            <div className="grid gap-0.5">
              <dt className="text-label text-muted">Moved on Budget day</dt>
              <dd className={figure}>{w.moved.length}</dd>
            </div>
          )}
          <div className="grid gap-0.5">
            <dt className="text-label text-muted">Government promises it could move</dt>
            <dd className={figure}>{watched.length}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-label text-muted">With a stated cost</dt>
            <dd className={figure}>{w.needMoney.length}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-label text-muted">About tax</dt>
            <dd className={figure}>{w.tax.length}</dd>
          </div>
          {!after && (
            <div className="grid gap-0.5">
              <dt className="text-label text-muted">Opposition pledges, costed</dt>
              <dd className={figure}>{w.opposition.length}</dd>
            </div>
          )}
        </dl>

        {after && (
          <section aria-labelledby="did-h" className={section}>
            <h2 id="did-h" className={h2}>
              What the Budget did
            </h2>
            {w.moved.length ? (
              <MovedList cards={w.moved} />
            ) : (
              <p className="m-0 border-y border-line py-6 text-muted">
                Editors are reading the Budget documents. Each card moves here as its evidence is added, with a link to the page that shows it.
              </p>
            )}
          </section>
        )}

        {w.needMoney.length > 0 && (
          <section aria-labelledby="money-h" className={section}>
            <div className="grid max-w-[68ch] gap-1">
              <h2 id="money-h" className={h2}>
                Promises that need money
              </h2>
              <p className="m-0 text-muted">The government&apos;s promises with a stated cost and no money behind them yet, the largest first.</p>
            </div>
            <PromiseList cards={w.needMoney} today={today} />
          </section>
        )}

        {w.tax.length > 0 && (
          <section aria-labelledby="tax-h" className={section}>
            <div className="grid max-w-[68ch] gap-1">
              <h2 id="tax-h" className={h2}>
                Tax pledges
              </h2>
              <p className="m-0 text-muted">A Budget keeps these or breaks them.</p>
            </div>
            <PromiseList cards={w.tax} today={today} />
          </section>
        )}

        {w.other.length > 0 && (
          <section aria-labelledby="other-h" className={section}>
            <details className="group">
              <summary className="cursor-pointer list-none">
                <span id="other-h" className={h2}>
                  {w.other.length} more government promises it could move
                </span>
                <span className="mt-1 block text-muted">
                  No yearly cost on these: some have no cost of their own, others no official yearly figure yet. Each card says which.{" "}
                  <span className="font-medium text-accent group-open:hidden">Show them</span>
                </span>
              </summary>
              <div className="mt-4">
                <PromiseList cards={w.other} today={today} />
              </div>
            </details>
          </section>
        )}

        {w.opposition.length > 0 && (
          <section aria-labelledby="opp-h" className={section}>
            <div className="grid max-w-[68ch] gap-1">
              <h2 id="opp-h" className={h2}>
                For comparison: the opposition&apos;s costed pledges
              </h2>
              <p className="m-0 text-muted">
                The Budget cannot fund these. They show what other parties say they would do instead, costed and checked by the same rules.
              </p>
            </div>
            <PromiseList cards={w.opposition} today={today} />
          </section>
        )}

        <section aria-labelledby="how-h" className="grid max-w-[68ch] gap-3 border-t border-line pt-8">
          <h2 id="how-h" className={h2}>
            How this page works
          </h2>
          <p className="m-0 text-muted">
            It lists every promise we track whose owner is in government and which has not yet been funded or started: the same rule for every party. On
            Budget day editors read the Budget documents and the Office for Budget Responsibility&apos;s forecast, add what changed to each card with a link to
            the evidence, and the card appears under &ldquo;What the Budget did&rdquo;. A promise moves only on evidence, never on an announcement alone.
          </p>
          <p className="m-0 text-muted">
            See <a href="/method">how the numbers are made</a> and <a href="/promises">every promise</a>.
          </p>
        </section>
      </main>
    </>
  );
}

/** Cards that changed on Budget day, each with what changed and the evidence. */
function MovedList({ cards }: { cards: CardView[] }) {
  return (
    <ul className="m-0 grid list-none border-t border-line p-0">
      {cards.map((c) => (
        <li key={c.id} className="grid gap-2 border-b border-line px-3 py-5">
          <a href={`/promise/${c.id}`} className="text-[16px] font-[550] leading-snug text-ink">
            {c.file.headline ?? c.current.text}
          </a>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-muted">
            <StatusPill status={c.file.status} />
            <span>{AREA_LABEL[c.file.policy_area]}</span>
          </span>
          {budgetDayEvents(c).map((e, i) => (
            <p key={i} className="m-0 text-sm">
              <span className="font-medium">{EVENT_LABEL[e.type]}:</span> {e.text}
              {e.evidence_url && (
                <>
                  {" "}
                  <a href={e.evidence_url}>Evidence</a>
                </>
              )}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}
