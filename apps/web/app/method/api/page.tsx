import type { Metadata } from "next";
import { API_VERSION, OGL, OPEN_PARLIAMENT_LICENCE, licenceFor, statementYear } from "@ledger/server/api";
import { getSeed } from "@/lib/data";
import { endpoints } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/copy";
import { SiteHeader } from "@/components/SiteHeader";
import { MethodNav } from "@/components/MethodNav";
import { JsonLd } from "@/components/JsonLd";
import { CodeBlock } from "@/components/CopyButton";
import { API_DESCRIPTION, API_TITLE } from "@/lib/method-copy";
import { absolute, OPEN_GRAPH, MAKER, SITE_NAME, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: `${API_TITLE} | Public Ledger`,
  description: API_DESCRIPTION,
  alternates: { canonical: "/method/api" },
  openGraph: { ...OPEN_GRAPH, title: API_TITLE, description: API_DESCRIPTION, type: "article", url: "/method/api" },
  twitter: { card: "summary_large_image", title: API_TITLE, description: API_DESCRIPTION },
};

const FIELDS: { name: string; means: string }[] = [
  { name: "value", means: "The number, in its unit. Money is in £ billion (gbp_bn) unless the unit says otherwise." },
  { name: "unit", means: "gbp_bn, pct_gdp (% of GDP), rate_pct, persons_m, persons_k (thousands), households_m." },
  { name: "quality", means: "sourced: from an official release. approx: worked out from official figures, with the method. modelled: from a model, as a range. training: a working figure not yet checked." },
  { name: "source_id", means: "Which source the number comes from; the response lists every cited source under sources, with its licence." },
  { name: "vintage", means: "The edition the number comes from, for example EFO-2026-03 (the OBR's March 2026 forecast)." },
  { name: "method_note", means: "How a number that is not simply copied from a source was made." },
  { name: "low, central, high", means: "A range. Forecasts and model results always have one; a single published number has low = central = high." },
];

export default function ApiPage() {
  const seed = getSeed();
  const site = siteUrl();
  const list = endpoints();
  const datasets = list.filter((e) => !e.path.includes("{")).length;
  const year = seed.baseYear;
  const sample = statementYear(seed, year, { siteUrl: site, statusLabel: STATUS_LABEL })!;
  const borrowing = sample.totals.borrowing;
  const licence = licenceFor("index", site);

  const examples = [
    { caption: "One year's statement, line by line (curl)", code: `curl -s ${site}/api/${API_VERSION}/statement/${year}` },
    { caption: "Every promise card as a spreadsheet", code: `curl -s -o promises.csv ${site}/api/${API_VERSION}/promises.csv` },
    {
      caption: "Forecasts and their scores in Python (pandas)",
      code: `import pandas as pd\n\nforecasts = pd.read_csv("${site}/api/${API_VERSION}/forecasts.csv")\nprint(forecasts.groupby("result").size())`,
    },
    {
      caption: "Promise statuses in a web page (JavaScript)",
      code: `const res = await fetch("${site}/api/${API_VERSION}/promises");\nconst { data, licence } = await res.json();\nfor (const p of data.promises) console.log(p.status_label, p.text);\nconsole.log(licence.attribution);`,
    },
  ];
  const figureJson = JSON.stringify({ borrowing }, null, 2);

  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebAPI",
      name: `${SITE_NAME} open data API`,
      description: API_DESCRIPTION,
      url: absolute(`/api/${API_VERSION}`),
      documentation: absolute("/method/api"),
      termsOfService: OGL.url,
      provider: { "@type": "Organization", "@id": absolute("/#org"), name: SITE_NAME, url: absolute("/") },
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "Public Ledger: UK public finances, promises and forecasts",
      description: API_DESCRIPTION,
      url: absolute("/method/api"),
      inLanguage: "en-GB",
      isAccessibleForFree: true,
      license: OGL.url,
      creator: { "@type": "Organization", "@id": absolute("/#org"), name: SITE_NAME, url: absolute("/") },
      author: { "@type": "Person", name: MAKER.name, url: MAKER.url },
      dateModified: seed.builtAt.slice(0, 10),
      spatialCoverage: { "@type": "Place", name: "United Kingdom" },
      distribution: list.flatMap((e) => [
        { "@type": "DataDownload", name: e.path, encodingFormat: "application/json", contentUrl: absolute(e.example) },
        ...(e.csv ? [{ "@type": "DataDownload", name: `${e.path}.csv`, encodingFormat: "text/csv", contentUrl: absolute(`${e.example}.csv`) }] : []),
      ]),
    },
  ];

  return (
    <>
      <JsonLd data={structuredData} />
      <SiteHeader current="/method" />
      <main className="mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-10 px-4 pb-20 pt-8 sm:px-6">
        <MethodNav current="/method/api" />
        <div className="grid max-w-[70ch] gap-3">
          <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">{API_TITLE}</h1>
          <p className="m-0 text-lead text-muted">
            <b className="font-semibold text-ink">{datasets} datasets</b> as JSON or CSV: the statement for every year, every promise card, actors,
            forecasts and how they scored, contracts and data editions. Free, with no key and no sign-up.
          </p>
          <p className="m-0 text-muted">
            Start at <a href={`/api/${API_VERSION}`}>/api/{API_VERSION}</a>, which lists every endpoint with a working example. Add <code>.csv</code> to an
            address for a spreadsheet.
          </p>
        </div>

        <section aria-labelledby="start-h" className="grid gap-5 border-t border-line pt-10">
          <h2 id="start-h" className="m-0 text-title font-semibold">
            Try it
          </h2>
          <div className="grid gap-6 lg:grid-cols-2">
            {examples.map((e) => (
              <CodeBlock key={e.caption} caption={e.caption} code={e.code} />
            ))}
          </div>
        </section>

        <section aria-labelledby="endpoints-h" className="grid gap-4 border-t border-line pt-10">
          <h2 id="endpoints-h" className="m-0 text-title font-semibold">
            Endpoints
          </h2>
          <ul className="m-0 grid list-none border-t border-line p-0">
            {list.map((e) => (
              <li key={e.path} className="grid gap-x-6 gap-y-1 border-b border-line py-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_88px]">
                <code className="break-all font-medium">{e.path}</code>
                <span className="text-muted">{e.about}</span>
                <span className="flex gap-3 text-label">
                  <a href={e.example}>JSON</a>
                  {e.csv && <a href={`${e.example}.csv`}>CSV</a>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="fields-h" className="grid gap-x-10 gap-y-6 border-t border-line pt-10 lg:grid-cols-2">
          <div className="grid min-w-0 content-start gap-3">
            <h2 id="fields-h" className="m-0 text-title font-semibold">
              Every number comes with its source
            </h2>
            <p className="m-0 max-w-[62ch] text-muted">
              Each number carries its unit, quality label, source and edition. Here is {year} borrowing as the API gives it:
            </p>
            <CodeBlock caption={`From /api/${API_VERSION}/statement/${year}`} code={figureJson} />
          </div>
          <dl className="m-0 grid content-start gap-3 text-sm">
            {FIELDS.map((f) => (
              <div key={f.name} className="grid gap-0.5">
                <dt>
                  <code className="font-medium">{f.name}</code>
                </dt>
                <dd className="m-0 text-muted">{f.means}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="licence-h" className="grid gap-x-10 gap-y-6 border-t border-line pt-10 md:grid-cols-2">
          <div className="grid max-w-[62ch] content-start gap-3">
            <h2 id="licence-h" className="m-0 text-title font-semibold">
              Licence and credit
            </h2>
            <p className="m-0 text-muted">
              Most figures are Crown copyright under the <a href={OGL.url}>{OGL.name}</a>; quotes from Parliament are under the{" "}
              <a href={OPEN_PARLIAMENT_LICENCE.url}>{OPEN_PARLIAMENT_LICENCE.name}</a>. Every response carries its licence, and each source lists its own
              terms.
            </p>
            <p className="m-0 text-muted">Please credit the data like this:</p>
            <CodeBlock caption="Attribution" code={licence.attribution} />
            <details className="text-caption text-muted">
              <summary className="cursor-pointer text-label font-medium text-accent">What else the licence block says</summary>
              <ul className="m-0 mt-2 grid gap-1.5 pl-4">
                {licence.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          </div>
          <div className="grid max-w-[62ch] content-start gap-3">
            <h2 className="m-0 text-title font-semibold">Stable, cached, private</h2>
            <ul className="m-0 grid gap-1.5 pl-4 text-muted">
              <li>
                Field names stay the same within <code>{API_VERSION}</code>. New fields may be added; anything that would break your code comes as a new
                version, and this one keeps working.
              </li>
              <li>The data changes when the site is updated, after the nightly data job finds a new official release. Responses can be cached for an hour.</li>
              <li>Any website can call it from the browser (open CORS for GET).</li>
              <li>It only serves what the site publishes. Nothing about readers is in it: no follows, no subscriptions, no submissions.</li>
              <li>No key, no account, no tracking.</li>
            </ul>
          </div>
        </section>
      </main>
    </>
  );
}
