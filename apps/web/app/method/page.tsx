import type { Metadata } from "next";
import { backtestSummary } from "@ledger/schema";
import { ENGINE_VERSION } from "@ledger/engine";
import { getForecasts, getSeed, getVintages } from "@/lib/data";
import { SiteHeader } from "@/components/SiteHeader";
import { MethodNav } from "@/components/MethodNav";
import { JsonLd } from "@/components/JsonLd";
import { QualityBadge } from "@/components/ui";
import { QUALITY_HELP } from "@/lib/copy";
import { T1_METHOD } from "@/lib/t1-copy";
import { AI_JOURNALIST_NOTE } from "@/lib/reviews";
import { fixed, grouped, longDate } from "@/lib/format";
import { METHOD_DESCRIPTION, METHOD_TITLE } from "@/lib/method-copy";
import { absolute, MAKER, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: `${METHOD_TITLE} | Public Ledger`,
  description: METHOD_DESCRIPTION,
  alternates: { canonical: "/method" },
  openGraph: { title: METHOD_TITLE, description: METHOD_DESCRIPTION, type: "article", url: "/method" },
  twitter: { card: "summary_large_image", title: METHOD_TITLE, description: METHOD_DESCRIPTION },
};

/** How many editions to list before "Show all". */
const CHANGELOG_FIRST = 8;

function Figure({ value, label, href }: { value: string; label: string; href?: string }) {
  return (
    <div className="grid content-start gap-1 border-t border-line pt-3">
      <span className="text-figure font-semibold tracking-figure tabular-nums">{value}</span>
      <span className="text-label text-muted">{href ? <a href={href}>{label}</a> : label}</span>
    </div>
  );
}

export default function MethodPage() {
  const seed = getSeed();
  const { changelog, runs, manifest } = getVintages();
  const { forecasts } = getForecasts();
  const scored = backtestSummary(forecasts).scored;
  const lastBuild = runs.find((r) => r.status === "ok");
  const newest = changelog.find((e) => e.published_on)?.published_on ?? null;
  const inManifest = new Set(manifest.sources.map((s) => s.id));
  const otherSources = seed.sources.filter((s) => !inManifest.has(s.id));
  const { spending_multiplier: ms, tax_multiplier: mt } = seed.levers.macro_rules;
  const band = (r: readonly number[]) => `${fixed(r[0]!, 1)} to ${fixed(r[2]!, 1)}`;

  const editionRow = (e: (typeof changelog)[number]) => (
    <li
      key={`${e.source_id}|${e.vintage}`}
      className="grid gap-x-6 gap-y-0.5 border-b border-line py-2.5 text-sm sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,220px)]"
    >
      <span className="tabular-nums text-muted">{e.published_on ? longDate(e.published_on) : "Not dated"}</span>
      <span className="grid gap-0.5">
        <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-medium">
          {e.source_title}
        </a>
        <span className="text-caption text-muted">
          {e.publisher}
          {e.licence ? ` · ${e.licence}` : ""}
          {e.first_loaded ? ` · first used here ${longDate(e.first_loaded)}` : ""}
        </span>
      </span>
      <span className="text-caption text-muted">
        Edition <code>{e.vintage}</code>
        {e.latest ? " (newest)" : ""}
      </span>
    </li>
  );
  const table = (rows: typeof changelog) => <ul className="m-0 grid list-none border-t border-line p-0">{rows.map(editionRow)}</ul>;

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: METHOD_TITLE,
    description: METHOD_DESCRIPTION,
    url: absolute("/method"),
    inLanguage: "en-GB",
    dateModified: seed.builtAt.slice(0, 10),
    author: { "@type": "Person", name: MAKER.name, url: MAKER.url },
    publisher: { "@type": "Organization", "@id": absolute("/#org"), name: SITE_NAME, url: absolute("/") },
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absolute("/") },
    citation: manifest.sources.map((s) => ({ "@type": "Dataset", name: s.title, url: s.url, publisher: { "@type": "Organization", name: s.publisher } })),
    hasPart: [
      { "@type": "WebPage", name: "Forecasts against what happened", url: absolute("/method/backtest") },
      { "@type": "WebPage", name: "Open data API", url: absolute("/method/api") },
    ],
  };

  return (
    <>
      <JsonLd data={structuredData} />
      <SiteHeader current="/method" />
      <main className="mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-10 px-4 pb-20 pt-8 sm:px-6">
        <MethodNav current="/method" />
        <div className="grid max-w-[70ch] gap-3">
          <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">{METHOD_TITLE}</h1>
          <p className="m-0 text-lead text-muted">
            Every number on this site comes from one of <b className="font-semibold text-ink">{seed.sources.length} official sources</b>, or is worked
            out from them, and says which. Official forecasts are shown as their makers publish them; our own model results are always ranges.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          <Figure value={String(manifest.sources.length)} label="sources read by our nightly data job" />
          <Figure value={String(changelog.length)} label="data editions on file, each kept as published" />
          <Figure value={newest ? longDate(newest) : "—"} label="the newest edition was published" />
          <Figure value={String(scored)} label="forecasts checked against what happened so far" href="/method/backtest" />
        </div>

        <section aria-labelledby="labels-h" className="grid gap-x-10 gap-y-6 border-t border-line pt-10 md:grid-cols-2">
          <div className="grid max-w-[62ch] content-start gap-3">
            <h2 id="labels-h" className="m-0 text-title font-semibold">
              Every number has a label
            </h2>
            <p className="m-0 text-muted">Hover over or focus a number anywhere on the site to see its label, how it was made and a link to its source.</p>
            <ul className="m-0 grid list-none gap-3 p-0 text-sm">
              {(["sourced", "approx", "modelled", "training", "plug"] as const).map((q) => (
                <li key={q} className="grid gap-0.5">
                  <QualityBadge quality={q} />
                  <span className="text-muted">{q === "modelled" ? T1_METHOD.modelledHelp : QUALITY_HELP[q]}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid max-w-[62ch] content-start gap-3">
            <h2 className="m-0 text-title font-semibold">Ranges, not single numbers</h2>
            <ul className="m-0 grid gap-1.5 pl-4 text-muted">
              <li>Every sandbox result shows low, central and high.</li>
              <li>Tax levers use HMRC&apos;s costings per unit of change. They include how taxpayers respond, but not knock-on effects on the wider economy.</li>
              <li>Where a source gives a central figure only, the range is an editorial band around it, and the method note says so.</li>
              <li>
                Effects on GDP use spending multipliers of {band(ms)} and tax multipliers of {band(mt)}: wide on purpose, and labelled as rules of thumb.
              </li>
              <li>Bank Rate is set by the Bank of England. The sandbox lets you move it, labelled as such.</li>
              <li>Years after the latest outturn show the OBR&apos;s forecast as the OBR publishes it.</li>
            </ul>
            <details className="text-sm text-muted">
              <summary className="cursor-pointer font-medium text-ink">{T1_METHOD.heading}</summary>
              <div className="mt-2 grid gap-2.5">
                {T1_METHOD.paragraphs.map((p) => (
                  <p key={p} className="m-0 leading-relaxed">
                    {p}
                  </p>
                ))}
              </div>
            </details>
          </div>
        </section>

        <section aria-labelledby="checks-h" className="grid gap-x-10 gap-y-6 border-t border-line pt-10 md:grid-cols-2">
          <div id="reviews" className="grid max-w-[62ch] content-start gap-3">
            <h2 id="checks-h" className="m-0 text-title font-semibold">
              Who checks the cards
            </h2>
            <p className="m-0 text-muted">{AI_JOURNALIST_NOTE}</p>
            <p className="m-0 text-muted">
              Whatever a review finds is fixed in public: the card shows a dated correction with the old and new value. Every party&apos;s cards get the
              same checks.
            </p>
          </div>
          <div className="grid max-w-[62ch] content-start gap-3">
            <h2 className="m-0 text-title font-semibold">Checked against what happened</h2>
            <p className="m-0 text-muted">
              Every forecast the site shows is recorded on the day it is shown and never changed. When the official outturn arrives, it is scored: inside
              the range, or a miss above or below.
            </p>
            <p className="m-0">
              <a href="/method/backtest" className="font-medium">
                See forecasts against outturn
              </a>
              <span className="text-muted"> · </span>
              <a href="/method/api" className="font-medium">
                Get the data (JSON or CSV)
              </a>
            </p>
          </div>
        </section>

        <section id="changelog" aria-labelledby="changelog-h" className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-line pt-10">
          <div className="grid max-w-[70ch] gap-2">
            <h2 id="changelog-h" className="m-0 text-title font-semibold">
              Changelog of data editions
            </h2>
            <p className="m-0 text-muted">
              Every edition of every source the data holds, newest first. A new edition arrives through the nightly data job as a reviewed change, and older
              editions stay on file.
              {lastBuild && (
                <>
                  {" "}
                  Latest data build: {longDate(lastBuild.build_id.slice(0, 10))}, {grouped(lastBuild.observations)} numbers from {manifest.sources.length}{" "}
                  sources, with no errors in its checks.
                </>
              )}
            </p>
          </div>
          {table(changelog.slice(0, CHANGELOG_FIRST))}
          {changelog.length > CHANGELOG_FIRST && (
            <details>
              <summary className="cursor-pointer text-label font-medium text-accent">Show all {changelog.length} editions</summary>
              <div className="mt-3">{table(changelog.slice(CHANGELOG_FIRST))}</div>
            </details>
          )}
          <p className="m-0 text-caption text-muted">
            Also as data: <a href="/api/v1/vintages">/api/v1/vintages</a> (JSON) and <a href="/api/v1/vintages.csv">CSV</a>. Engine {ENGINE_VERSION}.
          </p>
        </section>

        {otherSources.length > 0 && (
          <section aria-labelledby="other-h" className="grid gap-3 border-t border-line pt-10">
            <h2 id="other-h" className="m-0 text-title font-semibold">
              Also cited
            </h2>
            <p className="m-0 max-w-[70ch] text-muted">Announcements and records used for single figures, such as a costed measure or a contract.</p>
            <ul className="m-0 grid list-none gap-2 p-0 text-sm">
              {otherSources.map((s) => (
                <li key={s.id}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>
                  <span className="text-muted"> · {s.publisher}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
