import type { Metadata } from "next";
import { constituencies } from "@ledger/server/mp";
import { SiteHeader } from "@/components/SiteHeader";
import { MpLookup } from "@/components/MpLookup";
import { JsonLd } from "@/components/JsonLd";
import { absolute, OPEN_GRAPH, SITE_NAME } from "@/lib/site";
import { LOOKUP_STEPS, MP_DESCRIPTION, MP_FAQ, MP_TITLE, ONSPD_ATTRIBUTION, OGL_URL, OPL_ATTRIBUTION, OPL_URL } from "@/lib/mp-copy";

const TITLE = "Your MP: find them by postcode, see their promises and votes";

export const metadata: Metadata = {
  title: `${TITLE} | Public Ledger`,
  description: MP_DESCRIPTION,
  alternates: { canonical: "/mp" },
  openGraph: { ...OPEN_GRAPH, title: TITLE, description: MP_DESCRIPTION, type: "website", url: "/mp" },
  twitter: { card: "summary_large_image", title: TITLE, description: MP_DESCRIPTION },
};

function structuredData() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      url: absolute("/mp"),
      name: TITLE,
      description: MP_DESCRIPTION,
      inLanguage: "en-GB",
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absolute("/") },
      about: { "@type": "GovernmentOrganization", name: "House of Commons", url: "https://www.parliament.uk/business/commons/" },
    },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: MP_FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: absolute("/") },
        { "@type": "ListItem", position: 2, name: MP_TITLE, item: absolute("/mp") },
      ],
    },
  ];
}

/** A to Z, one block per first letter. */
function byLetter() {
  const groups = new Map<string, { slug: string; name: string }[]>();
  for (const c of constituencies()) {
    const letter = c.name[0]!.toUpperCase();
    groups.set(letter, [...(groups.get(letter) ?? []), c]);
  }
  return [...groups.entries()];
}

/** /mp: one search box first; how it works, questions and every constituency after it. */
export default function MpLookupPage() {
  const all = constituencies();
  return (
    <>
      <JsonLd data={structuredData()} />
      <SiteHeader current="/mp" />
      <main className="mx-auto grid max-w-[760px] grid-cols-[minmax(0,1fr)] gap-12 px-4 pb-20 pt-12 sm:px-6">
        <div className="grid gap-6">
          <div className="grid gap-3">
            <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">{MP_TITLE}</h1>
            <p className="m-0 text-lead text-muted">
              Who represents you in the House of Commons, the promises we track for them and their party, and how they voted recently.
            </p>
          </div>
          <MpLookup />
        </div>

        <section aria-labelledby="mp-how-h" className="grid gap-4 border-t border-line pt-10">
          <h2 id="mp-how-h" className="m-0 text-title font-semibold">
            How it works
          </h2>
          <ol className="m-0 grid list-none gap-3 p-0 text-sm">
            {LOOKUP_STEPS.map((step, i) => (
              <li key={step} className="grid grid-cols-[28px_minmax(0,1fr)] items-baseline gap-2">
                <span className="text-label font-semibold tabular-nums text-muted">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="m-0 text-sm text-muted">
            Each constituency has its own page, such as <a href="/mp/manchester-central">Manchester Central</a>. Its address names only the constituency, so you
            can share it and it says nothing about who looked it up.
          </p>
        </section>

        <section aria-labelledby="mp-faq-h" className="border-t border-line pt-10">
          <h2 id="mp-faq-h" className="m-0 mb-6 text-title font-semibold">
            Questions
          </h2>
          <div className="grid gap-6 text-sm">
            {MP_FAQ.map(({ q, a }) => (
              <div key={q} className="grid max-w-[62ch] gap-1.5">
                <h3 className="m-0 text-body font-semibold text-ink">{q}</h3>
                <p className="m-0 text-muted">{a}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="mp-all-h" className="border-t border-line pt-10">
          <h2 id="mp-all-h" className="m-0 mb-3 text-title font-semibold">
            Every constituency
          </h2>
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-accent underline underline-offset-2">Show all {all.length} constituencies, A to Z</summary>
            <div className="mt-5 grid gap-5">
              {byLetter().map(([letter, list]) => (
                <div key={letter} className="grid gap-1.5">
                  <h3 className="m-0 text-label font-semibold text-muted">{letter}</h3>
                  <ul className="m-0 grid list-none gap-x-6 gap-y-1 p-0 text-sm sm:grid-cols-2">
                    {list.map((c) => (
                      <li key={c.slug}>
                        <a href={`/mp/${c.slug}`}>{c.name}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        </section>

        <p className="m-0 border-t border-line pt-6 text-caption text-muted">
          MPs and votes: UK Parliament&apos;s open data, checked daily. <a href={OPL_URL}>{OPL_ATTRIBUTION}</a> {ONSPD_ATTRIBUTION}{" "}
          <a href={OGL_URL}>Open Government Licence v3.0</a>.
        </p>
      </main>
    </>
  );
}
