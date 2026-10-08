import type { Metadata } from "next";
import { backtestSummary, outturnExpected, seriesInfo, type ForecastMaker, type ScoredForecast } from "@ledger/schema";
import { lineLabels } from "@ledger/server/api";
import { getForecasts, getSeed } from "@/lib/data";
import { SiteHeader } from "@/components/SiteHeader";
import { MethodNav } from "@/components/MethodNav";
import { JsonLd } from "@/components/JsonLd";
import { QualityBadge } from "@/components/ui";
import { grouped, longDate } from "@/lib/format";
import {
  BACKTEST_DESCRIPTION,
  BACKTEST_TITLE,
  MAKER_LABEL,
  MAKER_LONG,
  RESULT_LABEL,
  backtestFaq,
  backtestLead,
  dueMonth,
  inUnit,
  missSize,
  pctText,
  periodLabel,
} from "@/lib/method-copy";
import { absolute, OPEN_GRAPH, MAKER, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `${BACKTEST_TITLE} | Public Ledger`,
  description: BACKTEST_DESCRIPTION,
  alternates: { canonical: "/method/backtest" },
  openGraph: { ...OPEN_GRAPH, title: BACKTEST_TITLE, description: BACKTEST_DESCRIPTION, type: "article", url: "/method/backtest" },
  twitter: { card: "summary_large_image", title: BACKTEST_TITLE, description: BACKTEST_DESCRIPTION },
};

const MAKER_ORDER: ForecastMaker[] = ["public_ledger", "obr", "ons"];

function Figure({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return (
    <div className="grid content-start gap-1 border-t border-line pt-3">
      <span className="text-figure font-semibold tracking-figure tabular-nums">{value}</span>
      <span className="text-label text-ink">{label}</span>
      {detail && <span className="text-caption text-muted">{detail}</span>}
    </div>
  );
}

const forecastText = (f: ScoredForecast) =>
  f.range === "range" ? `${inUnit(f.predicted[0], f.unit)} to ${inUnit(f.predicted[2], f.unit)}` : inUnit(f.predicted[1], f.unit);

/** One series a maker forecasts, for the table of what is recorded. */
interface Group {
  maker: ForecastMaker;
  label: string;
  periods: string[];
  count: number;
  ranged: boolean;
  quality: ScoredForecast["quality"];
  scored: number;
  due: string | null;
  recordedOn: string;
}

function groups(rows: ScoredForecast[], labels: Record<string, string>): Group[] {
  const by = new Map<string, ScoredForecast[]>();
  for (const f of rows) by.set(`${f.maker}|${f.series_id}`, [...(by.get(`${f.maker}|${f.series_id}`) ?? []), f]);
  return [...by.values()]
    .map((fs) => {
      const f = fs[0]!;
      const waiting = fs.filter((x) => !x.score).map(outturnExpected).sort();
      return {
        maker: f.maker,
        label: seriesInfo(f.series_id, labels).label,
        periods: [...new Set(fs.map((x) => x.period))].sort(),
        count: fs.length,
        ranged: fs.some((x) => x.range === "range"),
        quality: f.quality,
        scored: fs.filter((x) => x.score).length,
        due: waiting[0] ?? null,
        recordedOn: fs.map((x) => x.recorded_on).sort()[0]!,
      };
    })
    .sort((a, b) => MAKER_ORDER.indexOf(a.maker) - MAKER_ORDER.indexOf(b.maker) || (a.due ?? "").localeCompare(b.due ?? "") || a.label.localeCompare(b.label));
}

export default function BacktestPage() {
  const seed = getSeed();
  const { forecasts, table } = getForecasts();
  const labels = lineLabels(seed);
  const shownRows = forecasts.filter((f) => f.recorded_as === "shown");
  const contextRows = forecasts.filter((f) => f.recorded_as === "context");
  const shown = backtestSummary(shownRows);
  const context = backtestSummary(contextRows);
  const all = backtestSummary(forecasts);
  const firstRecorded = shownRows.map((f) => f.recorded_on).sort()[0] ?? null;
  const misses = forecasts.filter((f) => f.score && f.score.result !== "hit").sort((a, b) => (b.score!.miss_pct ?? 0) - (a.score!.miss_pct ?? 0));
  const biggest = contextRows.filter((f) => f.score).sort((a, b) => Math.abs(b.score!.error_pct ?? 0) - Math.abs(a.score!.error_pct ?? 0))[0];
  const faq = backtestFaq({ shown, context });
  const editions = table.outturn_editions.map((e) => `${seed.sources.find((x) => x.id === e.source_id)?.publisher ?? e.source_id} ${e.vintage}`);
  const recorded = groups(forecasts, labels);

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "Public Ledger forecasts against outturn",
      description: BACKTEST_DESCRIPTION,
      url: absolute("/method/backtest"),
      inLanguage: "en-GB",
      isAccessibleForFree: true,
      license: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
      creator: { "@type": "Organization", "@id": absolute("/#org"), name: SITE_NAME, url: absolute("/") },
      author: { "@type": "Person", name: MAKER.name, url: MAKER.url },
      dateModified: seed.builtAt.slice(0, 10),
      spatialCoverage: { "@type": "Place", name: "United Kingdom" },
      variableMeasured: [...new Set(forecasts.map((f) => seriesInfo(f.series_id, labels).label))],
      distribution: [
        { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: absolute("/api/v1/forecasts") },
        { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: absolute("/api/v1/forecasts.csv") },
      ],
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absolute("/") },
    },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];

  return (
    <>
      <JsonLd data={structuredData} />
      <SiteHeader current="/method" />
      <main className="mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-10 px-4 pb-20 pt-8 sm:px-6">
        <MethodNav current="/method/backtest" />
        <div className="grid max-w-[70ch] gap-3">
          <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">{BACKTEST_TITLE}</h1>
          <p className="m-0 text-lead text-muted">{backtestLead(shown, firstRecorded)}</p>
          <p className="m-0 text-muted">
            Every forecast this site shows is recorded on the day it is shown and never changed. When the official figure for that year comes out, we check
            it: inside the range is a hit; anything else is a miss above or below, measured from the nearer edge.
          </p>
        </div>

        <section aria-label="Forecasts this site shows, so far" className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          <Figure
            value={shown.hit_rate === null ? "None yet" : `${Math.round(shown.hit_rate * 100)}%`}
            label="hit rate"
            detail={shown.ranged.scored ? `${shown.ranged.hit} of ${shown.ranged.scored} forecasts with a range` : "No forecast with a range has been checked yet."}
          />
          <Figure value={String(shown.ranged.miss_above + shown.single.miss_above)} label="missed above" detail="The outturn came in higher." />
          <Figure value={String(shown.ranged.miss_below + shown.single.miss_below)} label="missed below" detail="The outturn came in lower." />
          <Figure
            value={grouped(shown.waiting)}
            label="waiting for the outturn"
            detail={shown.next_due ? `The next ${grouped(shown.next_due.count)} are due in ${dueMonth(shown.next_due.month)}.` : undefined}
          />
        </section>

        {context.scored > 0 && (
          <section aria-labelledby="context-h" className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-line pt-10">
            <div className="grid max-w-[70ch] gap-2">
              <h2 id="context-h" className="m-0 text-title font-semibold">
                Earlier official forecasts, checked
              </h2>
              <p className="m-0 text-muted">
                Before this site recorded anything, the OBR and the ONS had forecast years that have now ended. We check those too, to show how close
                official forecasts come. They are theirs, not ours. They are single numbers, so they are not in the hit rate.
              </p>
              <p className="m-0">
                <b className="font-semibold">{context.scored} checked.</b>{" "}
                <span className="text-muted">
                  The outturn came in higher in {context.single.miss_above + context.ranged.miss_above} and lower in{" "}
                  {context.single.miss_below + context.ranged.miss_below}
                  {biggest ? `; the biggest gap was ${pctText(biggest.score!.error_pct)} (${seriesInfo(biggest.series_id, labels).label.toLowerCase()}, ${periodLabel(biggest.period)}).` : "."}
                </span>
              </p>
            </div>
          </section>
        )}

        <section aria-labelledby="misses-h" className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-line pt-10">
          <div className="grid max-w-[70ch] gap-2">
            <h2 id="misses-h" className="m-0 text-title font-semibold">
              List of misses
            </h2>
            <p className="m-0 text-muted">
              {misses.length ? "Biggest first, by the size of the miss as a share of the forecast." : "No forecast has missed yet."}
            </p>
          </div>
          {misses.length > 0 && (
            <ul className="m-0 grid list-none border-t border-line p-0">
              {misses.map((f) => {
                const s = f.score!;
                return (
                  <li key={f.id} className="grid gap-x-6 gap-y-1 border-b border-line py-3 text-sm sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <span className="grid gap-0.5">
                      <span className="font-medium">
                        {seriesInfo(f.series_id, labels).label}, {periodLabel(f.period)}
                      </span>
                      <span className="text-caption text-muted">
                        {f.recorded_as === "context" ? "Earlier forecast by the " : "Shown here, forecast by "}
                        {MAKER_LONG[f.maker]}, {longDate(f.made_on)}
                      </span>
                    </span>
                    <span className="grid gap-0.5 text-muted">
                      <span>
                        Forecast <span className="text-ink tabular-nums">{forecastText(f)}</span>
                      </span>
                      <span>
                        Outturn <span className="text-ink tabular-nums">{inUnit(s.outturn, f.unit)}</span>{" "}
                        <span className="text-caption">({s.outturn_vintage})</span>
                      </span>
                    </span>
                    <span className="grid content-start gap-0.5">
                      <span className="font-medium">{RESULT_LABEL[s.result]}</span>
                      <span className="text-muted">
                        by {missSize(s.miss, f.unit)}
                        {s.miss_pct !== null ? ` (${pctText(s.miss_pct)})` : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {editions.length > 0 && (
            <p className="m-0 text-caption text-muted">Outturn used: {editions.join(", ")}. Scores are worked out again when a new release comes in.</p>
          )}
        </section>

        <section aria-labelledby="recorded-h" className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-line pt-10">
          <div className="grid max-w-[70ch] gap-2">
            <h2 id="recorded-h" className="m-0 text-title font-semibold">
              What is recorded
            </h2>
            <p className="m-0 text-muted">
              {grouped(all.recorded)} forecasts so far: {grouped(shown.recorded)} the site shows and {grouped(context.recorded)} earlier official ones. Ours
              are listed first and labelled as ours; the rest are the OBR&apos;s and the ONS&apos;s.
            </p>
          </div>
          <details className="min-w-0">
            <summary className="cursor-pointer text-label font-medium text-accent">Show every series ({recorded.length})</summary>
            <ul className="m-0 mt-3 grid list-none border-t border-line p-0">
              {recorded.map((g) => (
                <li
                  key={`${g.maker}|${g.label}`}
                  className="grid gap-x-6 gap-y-1 border-b border-line py-2.5 text-sm sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1.2fr)]"
                >
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className="font-medium">{g.label}</span>
                    <QualityBadge quality={g.quality} />
                  </span>
                  <span className="text-muted">{MAKER_LABEL[g.maker]}</span>
                  <span className="tabular-nums text-muted">
                    {periodLabel(g.periods[0]!)}
                    {g.periods.length > 1 ? ` to ${periodLabel(g.periods.at(-1)!)}` : ""}, {g.ranged ? "ranges" : "single numbers"}
                  </span>
                  <span className="text-muted">
                    {g.scored ? `${g.scored} of ${g.count} checked` : `${g.count} waiting`}
                    {g.due ? `; next due ${dueMonth(g.due)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </section>

        <section aria-labelledby="how-h" className="grid gap-x-10 gap-y-6 border-t border-line pt-10 md:grid-cols-2">
          <div className="grid max-w-[62ch] content-start gap-3">
            <h2 id="how-h" className="m-0 text-title font-semibold">
              How the check works
            </h2>
            <p className="m-0 text-muted">
              The official figures come from the ONS public finances (then the OBR&apos;s outturn), HM Treasury&apos;s spending statistics and the ONS
              population estimates. A job runs with every nightly data refresh; a score only changes when a new release does.
            </p>
            <p className="m-0 text-muted">
              Ranges come from whoever made the forecast: the ONS&apos;s published variants on the population page, our own model where it makes one. Where
              a forecast is a single number, we show it as one and say how far off it was, rather than invent a range.
            </p>
          </div>
          <div className="grid max-w-[62ch] content-start gap-3">
            <h2 className="m-0 text-title font-semibold">What is left out, and why</h2>
            <p className="m-0 text-muted">
              Promise costs and sandbox results are what-ifs: what a policy would cost, or what a change would do, on official costings. No official figure
              measures a what-if, so they are not scored. The OBR&apos;s tax-by-tax forecasts are left out too, because the OBR and the ONS draw some taxes
              differently, and a gap would be a difference of definition, not of forecast.
            </p>
            <p className="m-0 text-caption text-muted">
              The data: <a href="/api/v1/forecasts">/api/v1/forecasts</a> (JSON) and <a href="/api/v1/forecasts.csv">CSV</a>.
            </p>
          </div>
        </section>

        <section aria-labelledby="backtest-faq-h" className="border-t border-line pt-10">
          <h2 id="backtest-faq-h" className="m-0 mb-6 text-title font-semibold">
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
      </main>
    </>
  );
}
