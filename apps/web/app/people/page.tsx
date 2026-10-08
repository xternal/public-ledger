import type { Metadata } from "next";
import type { PeopleProvenance } from "@ledger/schema";
import { getPeople } from "@/lib/data";
import { SiteHeader } from "@/components/SiteHeader";
import { PeopleExplorer } from "@/components/PeopleExplorer";
import { JsonLd } from "@/components/JsonLd";
import { QualityBadge, SourcesProvider, WithProvenance } from "@/components/ui";
import { CONTROLLED_BY_LABEL, QUALITY_HELP } from "@/lib/copy";
import { longDate } from "@/lib/format";
import { PEOPLE_COPY as C, PEOPLE_DESCRIPTION, PEOPLE_TITLE, peopleFaq } from "@/lib/people-copy";
import { deathsOvertake, pctGdp, per100, ratio, span, spendingSpan } from "@/lib/people-view";
import { absolute, OPEN_GRAPH, MAKER, SITE_NAME } from "@/lib/site";

const SHORT_TITLE = "People and long-term spending";

export const metadata: Metadata = {
  title: `${SHORT_TITLE} | Public Ledger`,
  description: PEOPLE_DESCRIPTION,
  alternates: { canonical: "/people" },
  openGraph: { ...OPEN_GRAPH, title: PEOPLE_TITLE, description: PEOPLE_DESCRIPTION, type: "website", url: "/people" },
  twitter: { card: "summary_large_image", title: PEOPLE_TITLE, description: PEOPLE_DESCRIPTION },
};

function structuredData() {
  const p = getPeople();
  const oadr = span(p.charts.oadr);
  const faq = peopleFaq(p);
  const vintages = editions();
  return [
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "UK population and age-related public spending projections",
      description: PEOPLE_DESCRIPTION,
      url: absolute("/people"),
      inLanguage: "en-GB",
      isAccessibleForFree: true,
      license: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
      creator: { "@type": "Organization", "@id": absolute("/#org"), name: SITE_NAME, url: absolute("/") },
      author: { "@type": "Person", name: MAKER.name, url: MAKER.url },
      temporalCoverage: `${oadr.firstYear}/${oadr.lastYear}`,
      spatialCoverage: { "@type": "Place", name: "United Kingdom" },
      variableMeasured: [C.oadrTitle, C.workersTitle, C.births, C.deaths, C.spendingTitle],
      isBasedOn: p.sources.map((s) => ({
        "@type": "Dataset",
        name: s.title,
        url: s.url,
        publisher: { "@type": "Organization", name: s.publisher },
        ...(s.published_on ? { datePublished: s.published_on } : {}),
        ...(vintages[s.id] ? { version: vintages[s.id] } : {}),
      })),
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absolute("/") },
    },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];
}

/** The edition (vintage) of each source the page uses. */
function editions(): Record<string, string> {
  const p = getPeople();
  const provs: PeopleProvenance[] = [p.charts.oadr.provenance, p.charts.births.past.provenance, p.spending.provenance].filter((x): x is PeopleProvenance => !!x);
  return Object.fromEntries(provs.map((x) => [x.source_id, x.vintage]));
}

/** A headline number. Figures on the right open their provenance tip leftwards, so it stays on screen. */
function Figure({ value, label, detail, p, align = "start" }: { value: string; label: string; detail: string; p: PeopleProvenance; align?: "start" | "end" }) {
  return (
    <div className="grid content-start gap-1 border-t border-line pt-3">
      <WithProvenance p={p} align={align} className="w-full">
        <span className="text-figure font-semibold tracking-figure tabular-nums">{value}</span>
      </WithProvenance>
      <span className="text-label text-ink">{label}</span>
      <span className="text-caption text-muted">{detail}</span>
    </div>
  );
}

export default function PeoplePage() {
  const p = getPeople();
  const oadr = span(p.charts.oadr);
  const workers = span(p.charts.workers);
  const spend = spendingSpan(p);
  const crossover = deathsOvertake(p);
  const faq = peopleFaq(p);
  const vintages = editions();
  const variantCount = p.variants.filter((v) => v.code !== "ppp").length;
  const scenarioCount = p.spending.scenarios.length - 1;
  const lastPast = p.charts.births.past.years.at(-1);

  return (
    <>
      <JsonLd data={structuredData()} />
      <SiteHeader current="/people" />
      <SourcesProvider sources={p.sources}>
        <main className="mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-10 px-4 pb-20 pt-12 sm:px-6">
          <div className="grid max-w-[70ch] gap-3">
            <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">{PEOPLE_TITLE}</h1>
            <p className="m-0 text-lead text-muted">
              By {oadr.lastYear} there are <b className="font-semibold text-ink">{per100(oadr.last)}</b> people over pension age for every 100 of working
              age in the ONS principal projection, up from {per100(oadr.first)} in {oadr.firstYear}. In the OBR&apos;s baseline, spending that rises with
              age goes from {pctGdp(spend.first)} of GDP in {spend.firstYear} to <b className="font-semibold text-ink">{pctGdp(spend.last)}</b> in{" "}
              {spend.lastYear}.
            </p>
          </div>

          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            <Figure
              value={per100(oadr.last)}
              label={`people over pension age per 100 of working age in ${oadr.lastYear}`}
              detail={`${per100(oadr.first)} in ${oadr.firstYear}. ONS variants: ${per100(oadr.range[0])} to ${per100(oadr.range[2])}.`}
              p={p.charts.oadr.provenance}
            />
            <Figure
              value={ratio(workers.last)}
              label={`people of working age per person over pension age in ${workers.lastYear}`}
              detail={`${ratio(workers.first)} in ${workers.firstYear}. ONS variants: ${ratio(workers.range[0])} to ${ratio(workers.range[2])}.`}
              p={p.charts.workers.provenance}
            />
            {crossover !== undefined && (
              <Figure
                value={String(crossover)}
                label="the first year with more deaths than births, in the principal projection"
                detail={`Up to mid-${lastPast}, births still outnumbered deaths (ONS estimates).`}
                p={p.charts.deaths.provenance}
                align="end"
              />
            )}
            <Figure
              value={pctGdp(spend.last)}
              label={`of GDP spent on things that rise with age in ${spend.lastYear}`}
              detail={`${pctGdp(spend.first)} in ${spend.firstYear}. OBR scenarios: ${pctGdp(spend.range[0])} to ${pctGdp(spend.range[2])}.`}
              p={p.spending.provenance}
              align="end"
            />
          </div>

          <div>
            <PeopleExplorer people={p} />
          </div>

          <section aria-labelledby="how-h" className="grid gap-x-10 gap-y-6 border-t border-line pt-10 md:grid-cols-2">
            <div className="grid max-w-[62ch] content-start gap-3">
              <h2 id="how-h" className="m-0 text-title font-semibold">
                What this page shows
              </h2>
              <p className="m-0 text-muted">
                How the UK&apos;s population is projected to age, and what that means for public spending. The first three charts come from the ONS
                national population projections: its principal projection and {variantCount} variants. The last comes from the OBR&apos;s long-term
                projections of public spending, its baseline and {scenarioCount} other scenarios.
              </p>
              <p className="m-0 text-muted">
                Every chart is a range, never a single line: the shaded band runs from the lowest to the highest published variant or scenario, and the
                solid line is the official central case.
              </p>
            </div>
            <div className="grid max-w-[62ch] content-start gap-3">
              <h2 className="m-0 text-title font-semibold">How it works</h2>
              <p className="m-0 text-muted">
                The ONS projects the population from assumptions about how many children people have, how long they live and how many people move to and
                from the UK. Its variants change one assumption at a time, plus a few combinations. The switches above pick one of them; when the ONS has
                not published a mix, the page says so instead of making one up.
              </p>
              <p className="m-0 text-muted">
                The OBR builds its spending projections on the ONS principal projection, and publishes scenarios with other assumptions about population,
                health and how pensions and benefits rise. Two figures are worked out here from published numbers, and are marked{" "}
                <QualityBadge quality="approx" /> with the method: people of working age per person over pension age, and spending in an OBR scenario
                (the OBR baseline plus the change the scenario makes).
              </p>
            </div>
          </section>

          <section aria-labelledby="people-faq-h" className="border-t border-line pt-10">
            <h2 id="people-faq-h" className="m-0 mb-6 text-title font-semibold">
              Questions
            </h2>
            <div className="grid gap-x-10 gap-y-6 text-sm md:grid-cols-2">
              {faq.map(({ q, a }) => (
                <div key={q} className="grid max-w-[60ch] gap-1.5">
                  <h3 className="m-0 text-body font-semibold text-ink">{q}</h3>
                  <p className="m-0 text-muted">{a}</p>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="people-sources-h" className="border-t border-line pt-10">
            <h2 id="people-sources-h" className="m-0 mb-4 text-title font-semibold">
              {C.sourcesTitle}
            </h2>
            <ul className="m-0 grid list-none gap-3 p-0 text-label">
              {p.sources.map((s) => (
                <li key={s.id} className="grid gap-0.5">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium">
                    {s.title}
                  </a>
                  <span className="text-muted">
                    {s.publisher}
                    {s.published_on ? `, published ${longDate(s.published_on)}` : ""}
                    {vintages[s.id] ? `. Edition used: ${vintages[s.id]}` : ""}
                    {s.licence ? `. ${s.licence}` : ""}.
                  </span>
                </li>
              ))}
            </ul>
            <ul className="m-0 mt-5 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-caption text-muted">
              {(["sourced", "approx"] as const).map((q) => (
                <li key={q} className="flex items-center gap-2">
                  <QualityBadge quality={q} />
                  <span>{QUALITY_HELP[q]}</span>
                </li>
              ))}
              <li>Hover over or focus a number to see its method and source.</li>
            </ul>
            <p className="m-0 mt-4 max-w-[70ch] text-caption text-muted">
              Assumptions about fertility, migration and life expectancy are {CONTROLLED_BY_LABEL.demography.toLowerCase()}; the state pension age and
              how pensions and benefits rise are {CONTROLLED_BY_LABEL.government.toLowerCase()}.
            </p>
          </section>
        </main>
      </SourcesProvider>
    </>
  );
}
