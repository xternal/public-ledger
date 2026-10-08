import type { Metadata } from "next";
import { PolicyArea } from "@ledger/schema";
import { areaPath, collectionJsonLd } from "@ledger/server/seo";
import { getSeed } from "@/lib/data";
import { SiteHeader } from "@/components/SiteHeader";
import { PromiseIndex } from "@/components/PromiseIndex";
import { FollowButton } from "@/components/FollowPanel";
import { ComingUp, type DueItem } from "@/components/ComingUp";
import { AREA_LABEL, isOverdue, ownerOf, promisesSummary, shortName, standingOf, todayIso, whoShort } from "@/lib/promises";
import { followOptions, followWindows } from "@/app/follow/targets";
import { JsonLd } from "@/components/JsonLd";
import { OPEN_GRAPH, seoContext } from "@/lib/site";
import { creditRows } from "@/components/CreditTable";

const TITLE = "Promises";
const DESCRIPTION = "What UK parties and the government have promised, quoted word for word, and where each promise stands now: cost, who pays, and evidence. One standard for every party.";

export const metadata: Metadata = {
  title: "UK political promises: what was promised and where each stands | Public Ledger",
  description: DESCRIPTION,
  alternates: {
    canonical: "/promises",
    types: {
      "application/atom+xml": [
        { url: "/feeds/all.xml", title: "Public Ledger: every change" },
        { url: "/feeds/deadlines/next-3-months.xml", title: "Public Ledger: promises due in the next 3 months" },
      ],
    },
  },
  openGraph: { ...OPEN_GRAPH, title: TITLE, description: DESCRIPTION, type: "website", url: "/promises" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function PromisesPage() {
  const seed = getSeed();
  const options = followOptions();
  const due: DueItem[] = seed.cards.flatMap((c) =>
    c.file.deadline ? [{ id: c.id, deadline: c.file.deadline, status: c.file.status, text: c.current.text, who: whoShort(c) }] : [],
  );
  // A CollectionPage whose list names each card by its headline, in the order the page lists them.
  const structuredData = collectionJsonLd(
    { path: "/promises", name: TITLE, description: DESCRIPTION, cards: seed.cards, breadcrumb: [{ name: TITLE, path: "/promises" }] },
    seoContext(),
  );
  const areas = PolicyArea.options
    .map((a) => ({ id: a, n: seed.cards.filter((c) => c.file.policy_area === a).length }))
    .filter((a) => a.n > 0)
    .sort((a, b) => AREA_LABEL[a.id].localeCompare(AREA_LABEL[b.id]));
  const ownerRows = creditRows(seed.cards, "party");
  const today = todayIso();
  const summary = promisesSummary(seed.cards);
  const govCards = seed.cards.filter((c) => standingOf(c) === "government");
  const gov = govCards.length;
  const govNames = [...new Set(govCards.map((c) => shortName(ownerOf(c))))].join(" and ");
  const opp = seed.cards.filter((c) => standingOf(c) === "opposition");
  const oppParties = new Set(opp.map((c) => ownerOf(c).id)).size;
  const owners = new Set(seed.cards.map((c) => ownerOf(c).id)).size;
  const dueSoon = due.filter((d) => d.deadline >= today && !isOverdue(seed.cards.find((c) => c.id === d.id)!, today)).length;
  const figures = [
    { label: "Promises tracked", value: seed.cards.length, sub: `from ${owners} parties and public bodies` },
    { label: "Government", value: gov, sub: govNames },
    { label: "Opposition", value: opp.length, sub: `${oppParties} parties at Westminster` },
    { label: "Deadlines ahead", value: dueSoon, sub: "see Coming up below", href: "#coming-up" },
  ];
  return (
    <>
      <JsonLd data={structuredData} />
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[1200px] gap-10 px-4 pb-20 pt-12 sm:px-6">
        <header className="grid max-w-[68ch] gap-4">
          <h1 className="m-0 text-[clamp(32px,4.6vw,48px)] font-semibold leading-[1.04] tracking-[-0.035em]">{TITLE}</h1>
          <p className="m-0 text-lead text-muted">
            What UK parties and the government have promised, quoted word for word, and where each promise stands now. Every party is held to the same
            rules.
          </p>
          {summary.length > 0 && <p className="m-0 text-lead text-muted">{summary.join(" ")}</p>}
          <p className="m-0 text-label text-muted">
            A promise moves along its timeline only on evidence: a plan, a bill, money in a Budget, or delivery.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-label">
            <FollowButton
              label="Follow a topic or everything"
              trackKind="area"
              areas={Object.entries(AREA_LABEL).map(([id, label]) => ({ id, label }))}
              windows={followWindows()}
              options={options}
            />
            <a href="/feeds/all.xml">Follow every promise by RSS</a>
            <a href="/feeds" className="text-muted">
              What is RSS?
            </a>
          </div>
        </header>

        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-line pt-6 md:grid-cols-4">
          {figures.map((x) => (
            <div key={x.label} className="grid content-start gap-1">
              <dt className="text-label text-muted">{x.label}</dt>
              <dd className="m-0 text-[28px] font-semibold leading-none tracking-[var(--tracking-figure)]">
                {x.href ? (
                  <a href={x.href} className="text-ink no-underline hover:underline">
                    {x.value}
                  </a>
                ) : (
                  x.value
                )}
              </dd>
              <dd className="m-0 text-caption text-muted">{x.sub}</dd>
            </div>
          ))}
        </dl>

        <PromiseIndex cards={seed.cards} />

        <ComingUp items={due} builtOn={today} windows={followWindows()} options={options} />
        <nav aria-labelledby="browse-h" className="grid gap-3 border-t border-line pt-6 text-label">
          <h2 id="browse-h" className="m-0 text-label font-medium text-muted">
            Browse the ledger
          </h2>
          <p className="m-0 flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-muted">By policy area:</span>
            {areas.map((a) => (
              <a key={a.id} href={areaPath(a.id)}>
                {AREA_LABEL[a.id]} ({a.n})
              </a>
            ))}
          </p>
          <p className="m-0 flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-muted">By party or speaker:</span>
            {ownerRows.map((o) => (
              <a key={o.id} href={o.href}>
                {o.name} ({o.cards.length})
              </a>
            ))}
          </p>
        </nav>
      </main>
    </>
  );
}
