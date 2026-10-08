import type { Metadata } from "next";
import { getSeed } from "@/lib/data";
import { FAQ } from "@/lib/faq";
import { absolute, MAKER, OPEN_GRAPH, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import { JsonLd } from "@/components/JsonLd";
import { Ledger } from "@/components/Ledger";

const TITLE = "Public Ledger: where UK public money comes from and goes";

export const metadata: Metadata = {
  title: TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/", types: { "application/atom+xml": [{ url: "/feeds/all.xml", title: "Public Ledger: every change" }] } },
  openGraph: { ...OPEN_GRAPH, title: TITLE, description: SITE_DESCRIPTION, type: "website", url: "/" },
};

function structuredData() {
  const seed = getSeed();
  const { meta } = seed.statement;
  const [start] = meta.fiscal_year.split("-");
  const org = { "@type": "Organization", "@id": absolute("/#org"), name: SITE_NAME, url: absolute("/") };
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url: absolute("/"),
      description: SITE_DESCRIPTION,
      inLanguage: "en-GB",
      publisher: org,
      creator: { "@type": "Person", name: MAKER.name, url: MAKER.url },
    },
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: `UK public finances ${meta.fiscal_year}: receipts, spending and borrowing`,
      description: `Where UK public money came from and went in ${meta.fiscal_year}, based on the ${meta.vintage_label}, with every line linked to its official source.`,
      url: absolute("/"),
      creator: org,
      temporalCoverage: `${start}-04-01/${Number(start) + 1}-03-31`,
      spatialCoverage: { "@type": "Place", name: "United Kingdom" },
      isBasedOn: seed.sources.map((s) => s.url),
      dateModified: seed.builtAt.slice(0, 10),
    },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];
}

export default function Home() {
  return (
    <>
      <JsonLd data={structuredData()} />
      <Ledger seed={getSeed()} />
    </>
  );
}
