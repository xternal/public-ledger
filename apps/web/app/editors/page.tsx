import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { JsonLd } from "@/components/JsonLd";
import { CONTROLLER, EDITOR_APPLICATION_RETENTION_MONTHS } from "@/lib/privacy-copy";
import { absolute, EDITORS_EMAIL, EDITORS_PAGE_UPDATED, MAKER, OPEN_GRAPH, SITE_NAME } from "@/lib/site";

const TITLE = "Become a Public Ledger editor";
const DESCRIPTION =
  "Volunteer editors check UK political promise cards against their sources before they count: about two hours a week, remote, no coding. Any party or none, declared.";

export const metadata: Metadata = {
  title: `Volunteer editors wanted: check UK political promises | ${SITE_NAME}`,
  description: DESCRIPTION,
  alternates: { canonical: "/editors" },
  openGraph: { ...OPEN_GRAPH, title: TITLE, description: DESCRIPTION, type: "website", url: "/editors" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const APPLY_HREF = `mailto:${EDITORS_EMAIL}?subject=${encodeURIComponent("Editor application")}`;

const FACTS = [
  { label: "Time", value: "About 2 hours a week" },
  { label: "Where", value: "Remote, when it suits you" },
  { label: "Trial", value: "Three months, then decide together" },
  { label: "Pay", value: "Unpaid: a volunteer role" },
];

const TASKS = [
  "Check new promise cards against their primary source: the quote word for word, who said it and when, the cost and who pays it.",
  "Approve a card, or send it back with a note. A card needs two editors' approval to publish.",
  "Look at what readers send in (new promises, evidence, corrections) and accept or turn it down with a reason, within three working days.",
  "Now and then, confirm that a promise whose deadline passed with no evidence is “Undone”, and read replies from the people we cover.",
];

const GETS = [
  "Credit on the site as an editor, by name or not, as you prefer.",
  "A reference for your work, and real experience checking public spending and political claims.",
  "A say in how the standard grows.",
];

const section = "grid gap-4 border-t border-line pt-8";
const h2 = "m-0 text-title font-semibold";
const primary = "inline-flex w-fit rounded-control bg-ink px-4 py-2 text-sm font-semibold text-bg no-underline hover:opacity-90";

/**
 * The call for volunteer editors. Read top to bottom: what the role is and
 * the four facts that decide it, the one action (apply by email), then what
 * the work is, how it runs, who fits, the party rule, what you get, and how
 * to apply again at the end.
 */
export default function EditorsPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Volunteer editor (promise fact-checking)",
    description: `<p>${DESCRIPTION}</p><ul>${TASKS.map((t) => `<li>${t}</li>`).join("")}</ul>`,
    datePosted: EDITORS_PAGE_UPDATED,
    employmentType: "VOLUNTEER",
    jobLocationType: "TELECOMMUTE",
    applicantLocationRequirements: { "@type": "Country", name: "United Kingdom" },
    hiringOrganization: { "@type": "Organization", name: SITE_NAME, url: absolute("/"), legalName: CONTROLLER.name },
    directApply: false,
    url: absolute("/editors"),
    inLanguage: "en-GB",
  };

  return (
    <>
      <JsonLd data={structuredData} />
      <SiteHeader current="/#contribute" />
      <main className="mx-auto grid max-w-[720px] grid-cols-[minmax(0,1fr)] gap-10 px-4 pb-20 pt-10 sm:px-6">
        <header className="grid gap-5">
          <p className="m-0 text-label font-medium text-muted">Volunteer role</p>
          <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">{TITLE}</h1>
          <p className="m-0 text-lead text-muted">
            Our standard says two editors check every promise card before it counts. Today that is one person and an automated reviewer. We are looking for
            two careful readers to make it true.
          </p>
          <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 rounded-control bg-sunk p-4 sm:grid-cols-4">
            {FACTS.map((f) => (
              <div key={f.label} className="grid content-start gap-0.5">
                <dt className="text-caption text-muted">{f.label}</dt>
                <dd className="m-0 text-sm font-medium">{f.value}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-2">
            <a href={APPLY_HREF} className={primary}>
              Apply by email
            </a>
            <span className="text-label text-muted">
              {EDITORS_EMAIL}. A few lines are enough; no CV needed.
            </span>
          </p>
        </header>

        <section aria-labelledby="what-h" className={section}>
          <h2 id="what-h" className={h2}>
            What you would do
          </h2>
          <p className="m-0 text-muted">
            Public Ledger tracks what UK parties and the government promise, quoted word for word, with what each promise would cost a year, who pays, and a
            timeline that moves only on evidence. Editors keep the cards honest.
          </p>
          <ul className="m-0 grid list-disc gap-2 pl-5">
            {TASKS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="how-h" className={section}>
          <h2 id="how-h" className={h2}>
            How it works
          </h2>
          <p className="m-0">
            We start with a one-hour call to walk through <a href="/method">the method</a> and the tools. Cards are reviewed on GitHub; we show you how, and
            no coding is involved. After three months we decide together whether to carry on, and you can stop at any time.
          </p>
          <p className="m-0 text-muted">
            An automated reviewer, AI Journalist, checks every draft first and flags problems. It never publishes anything: editors decide.
          </p>
        </section>

        <section aria-labelledby="who-h" className={section}>
          <h2 id="who-h" className={h2}>
            Who we are looking for
          </h2>
          <p className="m-0">
            People who read carefully and like checking things against the source: journalism or politics students, fact-checkers, researchers, former civil
            servants, librarians, retired teachers. It helps to know your way around Hansard, GOV.UK, the OBR or the ONS, but we will teach you.
          </p>
        </section>

        <section aria-labelledby="party-h" className={section}>
          <h2 id="party-h" className={h2}>
            If you belong to a party
          </h2>
          <p className="m-0">
            You can belong to a party, or to none. Every editor declares party membership and any political role, and never approves a card about their own
            party; another editor does. The rule is in our published standard and applies to everyone, including the founder.
          </p>
        </section>

        <section aria-labelledby="gets-h" className={section}>
          <h2 id="gets-h" className={h2}>
            What you get
          </h2>
          <ul className="m-0 grid list-disc gap-2 pl-5">
            {GETS.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <p className="m-0 text-muted">
            The role is unpaid. Public Ledger is independent: no party, campaign or government funds or directs it.
          </p>
        </section>

        <section aria-labelledby="apply-h" className={section}>
          <h2 id="apply-h" className={h2}>
            How to apply
          </h2>
          <p className="m-0">
            Email <a href={APPLY_HREF}>{EDITORS_EMAIL}</a> with a few lines about you, why you would like to do it, and any party membership or political
            role.
          </p>
          <a href={APPLY_HREF} className={primary}>
            Apply by email
          </a>
          <p className="m-0 text-label text-muted">
            We use what you send only to consider your application, and delete it within {EDITOR_APPLICATION_RETENTION_MONTHS} months if you do not join.{" "}
            {CONTROLLER.name} runs Public Ledger; see the <a href="/privacy#what">privacy notice</a>. Questions first? Write to the same address.
          </p>
          <p className="m-0 text-label text-muted">
            {MAKER.name}, founder
          </p>
        </section>
      </main>
    </>
  );
}
