import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { absolute } from "@/lib/site";
import { feedTargets } from "./feed-response";

const TITLE = "Feeds: follow promise changes in a feed reader | Public Ledger";
const DESCRIPTION =
  "Atom feeds for every tracked UK political promise, party, politician and policy area: each new timeline event, rewording and right of reply, with no sign-up.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: absolute("/feeds"),
    types: { "application/atom+xml": [{ url: absolute("/feeds/all.xml"), title: "Public Ledger: every promise change" }] },
  },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", url: absolute("/feeds") },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const FAQ = [
  {
    q: "What is in a feed?",
    a: "One entry for each dated change on a promise card: a new timeline event (such as funded, legislated or deadline passed), a rewording of the promise, and any published reply from the person or party named on the card. Each entry links to the card.",
  },
  {
    q: "How do I use one?",
    a: "Copy a feed’s address into any feed reader. Readers that say they support RSS read Atom too.",
  },
  {
    q: "Do I need an account, or do you know who reads a feed?",
    a: "No account and no sign-up. A feed is a public file; we keep no list of who reads it.",
  },
  {
    q: "How quickly does a change appear?",
    a: "When an editor’s change is merged, the site rebuilds and its feeds with it, usually within minutes. Email and Telegram alerts go out from the same change.",
  },
];

function FeedLink({ path, label }: { path: string; label: string }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-line py-2">
      <span className="text-body">{label}</span>
      <a href={path} type="application/atom+xml" className="text-label">
        {path}
      </a>
    </li>
  );
}

export default function FeedsPage() {
  const { promises, actors, areas } = feedTargets();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Public Ledger feeds",
    description: DESCRIPTION,
    url: absolute("/feeds"),
    inLanguage: "en-GB",
    hasPart: [{ "@type": "DataFeed", name: "Every promise change", url: absolute("/feeds/all.xml"), encodingFormat: "application/atom+xml" }],
    mainEntity: {
      "@type": "FAQPage",
      mainEntity: FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    },
  };
  const section = "grid gap-2";
  const h2 = "m-0 text-title font-semibold";
  return (
    <>
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[880px] gap-10 px-4 pb-20 pt-10 sm:px-6">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
        <div className="grid gap-3">
          <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">Follow changes in a feed reader</h1>
          <p className="m-0 max-w-[62ch] text-lead text-muted">
            Every promise card, party, politician and policy area has an Atom feed. Each entry is one change: a new timeline event, a rewording or a published
            reply. No sign-up needed.
          </p>
        </div>

        <section aria-labelledby="all-h" className={section}>
          <h2 id="all-h" className={h2}>
            Everything
          </h2>
          <ul className="m-0 list-none p-0">
            <FeedLink path="/feeds/all.xml" label="Every change to every promise" />
          </ul>
        </section>

        <section aria-labelledby="area-h" className={section}>
          <h2 id="area-h" className={h2}>
            By policy area
          </h2>
          <ul className="m-0 list-none p-0">
            {areas.map((a) => (
              <FeedLink key={a.id} path={`/feeds/area/${a.id}.xml`} label={a.title} />
            ))}
          </ul>
        </section>

        <section aria-labelledby="actor-h" className={section}>
          <h2 id="actor-h" className={h2}>
            By party or politician
          </h2>
          <p className="m-0 text-label text-muted">A party’s feed includes the promises of its people.</p>
          <ul className="m-0 list-none p-0">
            {actors.map((a) => (
              <FeedLink key={a.id} path={`/feeds/actor/${a.id}.xml`} label={a.title} />
            ))}
          </ul>
        </section>

        <section aria-labelledby="promise-h" className={section}>
          <h2 id="promise-h" className={h2}>
            By promise
          </h2>
          <ul className="m-0 list-none p-0">
            {promises.map((p) => (
              <FeedLink key={p.id} path={`/feeds/promise/${p.id}.xml`} label={p.title} />
            ))}
          </ul>
        </section>

        <section aria-labelledby="faq-h" className={section}>
          <h2 id="faq-h" className={h2}>
            Questions
          </h2>
          <dl className="m-0 grid gap-4">
            {FAQ.map(({ q, a }) => (
              <div key={q} className="grid gap-1">
                <dt className="text-body font-semibold">{q}</dt>
                <dd className="m-0 text-body text-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </>
  );
}
