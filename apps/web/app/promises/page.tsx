import type { Metadata } from "next";
import { PolicyArea } from "@ledger/schema";
import { areaPath, collectionJsonLd } from "@ledger/server/seo";
import { getSeed } from "@/lib/data";
import { SiteHeader } from "@/components/SiteHeader";
import { PromiseIndex } from "@/components/PromiseIndex";
import { FollowButton } from "@/components/FollowPanel";
import { ComingUp, type DueItem } from "@/components/ComingUp";
import { AREA_LABEL, todayIso, whoShort } from "@/lib/promises";
import { followOptions, followWindows } from "@/app/follow/targets";
import { JsonLd } from "@/components/JsonLd";
import { OPEN_GRAPH, seoContext } from "@/lib/site";
import { creditRows } from "@/components/CreditTable";

const TITLE = "Promise ledger";
const DESCRIPTION = "Every tracked UK political promise: what, who, how much, from where, and whether it happened. One standard for every party.";

export const metadata: Metadata = {
  title: `${TITLE}: UK political promises, costed and tracked | Public Ledger`,
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
  const owners = creditRows(seed.cards, "party");
  return (
    <>
      <JsonLd data={structuredData} />
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[1200px] gap-8 px-4 pb-20 pt-12 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:items-start">
          <div className="grid max-w-[66ch] gap-3">
            <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">Promise ledger</h1>
            <p className="m-0 text-lead text-muted">
              Every card follows one published standard, the same for every party: the promise in the speaker&apos;s own words, its cost and who pays,
              and a timeline that ends in delivery or in silence.
            </p>
            <FollowButton
              label="Follow a policy area or everything"
              trackKind="area"
              areas={Object.entries(AREA_LABEL).map(([id, label]) => ({ id, label }))}
              windows={followWindows()}
              options={options}
            />
          </div>
          <ComingUp items={due} builtOn={todayIso()} windows={followWindows()} options={options} />
        </div>
        <PromiseIndex cards={seed.cards} />
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
            {owners.map((o) => (
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
