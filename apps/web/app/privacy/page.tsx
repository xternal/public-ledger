import type { Metadata } from "next";
import { CONFIRM_TTL_DAYS } from "@ledger/server/follow";
import { SUBMITTER_EMAIL_RETENTION_DAYS } from "@ledger/server/intake";
import { SiteHeader } from "@/components/SiteHeader";
import { NavLinks } from "@/components/NavLinks";
import { JsonLd } from "@/components/JsonLd";
import { longDate } from "@/lib/format";
import { absolute, MAKER, SITE_NAME } from "@/lib/site";
import {
  CONTROLLER,
  CONTROLLER_OFFICE,
  ICO_COMPLAINTS_URL,
  ICO_REGISTRATION_NUMBER,
  ICO_PHONE,
  PRIVACY_DESCRIPTION,
  PRIVACY_EMAIL,
  PRIVACY_FAQ,
  PRIVACY_TITLE,
  PRIVACY_UPDATED,
  followerThreshold,
  retention,
} from "@/lib/privacy-copy";

export const metadata: Metadata = {
  title: `${PRIVACY_TITLE} | Public Ledger`,
  description: PRIVACY_DESCRIPTION,
  alternates: { canonical: "/privacy" },
  openGraph: { title: PRIVACY_TITLE, description: PRIVACY_DESCRIPTION, type: "article", url: "/privacy" },
  twitter: { card: "summary_large_image", title: PRIVACY_TITLE, description: PRIVACY_DESCRIPTION },
};

/** The page's own menu: it highlights the section in view as the reader scrolls. */
const SECTIONS = [
  { href: "#who", label: "Who we are" },
  { href: "#what", label: "What we keep" },
  { href: "#basis", label: "Lawful basis" },
  { href: "#services", label: "Who else" },
  { href: "#how-long", label: "How long" },
  { href: "#rights", label: "Your rights" },
  { href: "#complain", label: "Complaints" },
];

const SERVICES: { name: string; role: string; where: string; sees: string; whereToConfirm?: boolean }[] = [
  { name: "Vercel", role: "hosts the site", where: "US company; our code runs in London", sees: "Every request, including your IP address, in its own logs." },
  { name: "Neon", role: "runs our database", where: "US company; the data is stored in London", sees: "Everything we keep. Addresses are encrypted before they reach it." },
  { name: "Resend", role: "sends our emails", where: "US company; sends from Ireland", sees: "Your email address and each email, which names what you follow." },
  {
    name: "Telegram",
    role: "carries the bot's messages, if you choose Telegram",
    where: "Its own servers, in several countries",
    sees: "Your chat and what you follow. Telegram runs your account under its own privacy policy.",
  },
  {
    name: "GitHub",
    role: "holds our code and runs the alerts job",
    where: "US company, part of Microsoft",
    sees: "Addresses while alerts go out, and accepted submissions as draft changes, with your credit name if you asked for one.",
  },
];

const MORE_SERVICES: typeof SERVICES = [
  { name: "Anthropic", role: "its Claude model suggests card details to editors", where: "US company", sees: "What you sent and the source's text. Never your email or credit name." },
  { name: "Internet Archive", role: "saves a public copy of a link you send", where: "US non-profit", sees: "The link only, sent from our server." },
  { name: "postcodes.io", role: "finds the constituency for a postcode", where: "UK service", whereToConfirm: true, sees: "The postcode only, sent from our server, never with your IP address." },
  { name: "UK Parliament", role: "provides the data about MPs", where: "UK", sees: "A name you type into Your MP, sent from our server." },
];

const h2 = "m-0 text-title font-semibold";
const h3 = "m-0 text-body font-semibold text-ink";
// The html scroll padding (72px) clears the header; 40px more clears this page's own menu.
const section = "grid scroll-mt-10 gap-4 border-t border-line pt-8";

/** A fact the code cannot show, still to be confirmed by the owner. */
function ToConfirm() {
  return <span className="whitespace-nowrap text-caption font-medium text-muted">(to confirm)</span>;
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <h3 className={h3}>{title}</h3>
      {children}
    </div>
  );
}

function ServiceList({ items }: { items: typeof SERVICES }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {items.map((s) => (
        <li key={s.name} className="grid gap-0.5">
          <span>
            <b className="font-semibold">{s.name}</b> {s.role}.
          </span>
          <span className="text-muted">
            {s.where}
            {s.whereToConfirm && (
              <>
                {" "}
                <ToConfirm />
              </>
            )}
            . {s.sees}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The privacy notice (DPIA M1): who runs Public Ledger, what each feature
 * keeps and why, the lawful bases, the services that handle data, how long
 * things are kept (from the code), readers' rights and how to complain.
 * Short sections in plain words; detail behind "show more" where it helps.
 */
export default function PrivacyPage() {
  const threshold = followerThreshold();
  const faq = PRIVACY_FAQ(threshold);
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      url: absolute("/privacy"),
      name: PRIVACY_TITLE,
      description: PRIVACY_DESCRIPTION,
      inLanguage: "en-GB",
      dateModified: PRIVACY_UPDATED,
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absolute("/") },
      author: { "@type": "Person", name: MAKER.name, url: MAKER.url },
      publisher: {
        "@type": "Organization",
        name: CONTROLLER.name,
        legalName: CONTROLLER.name,
        email: PRIVACY_EMAIL,
        address: {
          "@type": "PostalAddress",
          streetAddress: CONTROLLER.office.street,
          addressLocality: CONTROLLER.office.locality,
          postalCode: CONTROLLER.office.postcode,
          addressCountry: "GB",
        },
        identifier: { "@type": "PropertyValue", propertyID: "Companies House company number", value: CONTROLLER.companyNumber },
      },
    },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];

  return (
    <>
      <JsonLd data={structuredData} />
      <SiteHeader />
      <div className="sticky top-14 z-10 border-b border-line bg-bg/85 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex max-w-[720px] px-4 py-1.5 sm:px-6">
          <NavLinks links={SECTIONS} spy label="On this page" />
        </div>
      </div>
      <main className="mx-auto grid max-w-[720px] grid-cols-[minmax(0,1fr)] gap-10 px-4 pb-20 pt-10 text-sm sm:px-6">
        <div className="grid gap-4">
          <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">{PRIVACY_TITLE}</h1>
          <p className="m-0 text-lead text-muted">
            Public Ledger keeps as little about you as it can. This page says what we keep when you follow something, send something in or look up your MP,
            why, for how long, and how to have it deleted.
          </p>
          <ul className="m-0 grid list-disc gap-1.5 rounded-control bg-sunk py-3.5 pl-8 pr-4">
            <li>Reading the site stores nothing about you: no tracking cookies, no analytics scripts, no ads.</li>
            <li>If you follow something, we keep your email address or Telegram chat, encrypted, and what you follow. Nothing else.</li>
            <li>We never show who follows what, and we never share or sell our lists.</li>
            <li>You can delete it all yourself, at any time, from any alert email or with /stop in Telegram.</li>
          </ul>
        </div>

        <section id="who" aria-labelledby="who-h" className={section}>
          <h2 id="who-h" className={h2}>
            Who we are
          </h2>
          <p className="m-0">
            Public Ledger is run by {CONTROLLER.name}, Pavel Guzhikov&apos;s company, independently of any party. {CONTROLLER.name} is the controller of
            your personal data: it decides what is collected and why, and is responsible for it.
          </p>
          <p className="m-0">
            Write to <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> about anything on this page.
          </p>
          <p className="m-0 text-muted">
            {CONTROLLER.name} is a private limited company registered in England, company number {CONTROLLER.companyNumber}, registered office{" "}
            {CONTROLLER_OFFICE}. Registered with the Information Commissioner&apos;s Office (
            {ICO_REGISTRATION_NUMBER ? `registration number ${ICO_REGISTRATION_NUMBER}` : "registration number to follow"}).
          </p>
        </section>

        <section id="what" aria-labelledby="what-h" className={section}>
          <h2 id="what-h" className={h2}>
            What we keep, and why
          </h2>
          <Feature title="Alerts by email">
            <p className="m-0">
              Your email address, encrypted; what you follow; how often you want alerts; and when you agreed, to which version of the consent text. Nothing
              else.
            </p>
            <p className="m-0 text-muted">
              We use it only to send the alerts you asked for. Nothing is followed until you press Confirm in the email we send, and adding more later is
              confirmed the same way. What you follow can reveal your political opinions, so we treat it as sensitive.
            </p>
          </Feature>
          <Feature title="Alerts on Telegram">
            <p className="m-0">Your Telegram chat number, encrypted; what you follow; and when you agreed.</p>
            <p className="m-0 text-muted">Telegram also sends us your first name and username with each message. We do not keep them.</p>
          </Feature>
          <Feature title="Sending in a promise or evidence">
            <p className="m-0">
              What you send: the link, the words, who said them, the date and the time in a video. If you give them, your email address, encrypted, and a name
              to credit you by.
            </p>
            <p className="m-0 text-muted">
              Editors use it to check the promise against its source. Your email gets a receipt and one update with their decision, then we delete it. Your
              credit name appears on the card if it is published. Our server saves a copy of the link at the Internet Archive and may ask Anthropic&apos;s
              Claude to suggest card details; neither gets your email or name.
            </p>
          </Feature>
          <Feature title="Your MP">
            <p className="m-0">Nothing. We use your postcode once to find your constituency, then forget it.</p>
            <p className="m-0 text-muted">
              Our server asks postcodes.io, so the postcode is never stored, logged or put in a web address. Names you type go to UK Parliament&apos;s data
              service the same way. We count only whether a search used a postcode or a name, and whether it found someone.
            </p>
          </Feature>
          <Feature title="Using the site">
            <p className="m-0">Daily counts of what happens, such as how many follows started by email. They carry no IP address, no ids and nothing you typed.</p>
            <p className="m-0 text-muted">
              Forms use a small puzzle your browser solves, which sets no cookies. To stop one connection flooding a form, we keep a scrambled code made from
              your IP address with a random key that changes every day. The key and the codes are deleted the next day, after which nobody can link them to
              you.
            </p>
          </Feature>
          <Feature title="The editors' area">
            <p className="m-0">Editors sign in with a shared password. They see submissions, never email addresses.</p>
            <p className="m-0 text-muted">Failed sign-ins are counted with the same daily scrambled code, to slow down anyone guessing the password.</p>
          </Feature>
        </section>

        <section id="basis" aria-labelledby="basis-h" className={section}>
          <h2 id="basis-h" className={h2}>
            Our lawful basis
          </h2>
          <ul className="m-0 grid list-disc gap-2 pl-5">
            <li>
              <b className="font-semibold">Alerts:</b> your explicit consent (UK GDPR Articles 6(1)(a) and 9(2)(a)), because what you follow can reveal
              political opinions. You can withdraw it at any time, as easily as you gave it.
            </li>
            <li>
              <b className="font-semibold">Your email and credit name with a submission:</b> your consent (Article 6(1)(a)).
            </li>
            <li>
              <b className="font-semibold">What you send in, Your MP searches, spam checks, usage counts and hosting logs:</b> our legitimate interest in
              running a useful, secure site (Article 6(1)(f)). Each uses as little as it can, and none is used to profile you or decide anything about you.
            </li>
          </ul>
        </section>

        <section id="services" aria-labelledby="services-h" className={section}>
          <h2 id="services-h" className={h2}>
            Who else handles your data
          </h2>
          <p className="m-0 text-muted">These services run parts of Public Ledger for us. None may use your data for anything else.</p>
          <ServiceList items={SERVICES} />
          <details>
            <summary className="cursor-pointer font-medium text-accent">Four more, for submissions and Your MP</summary>
            <div className="mt-3">
              <ServiceList items={MORE_SERVICES} />
            </div>
          </details>
          <p className="m-0 text-muted">
            Where data leaves the UK, it goes to Ireland, which UK law treats as safe, or to US companies, under the UK–US data bridge or the UK&apos;s standard
            contract clauses. <ToConfirm />
          </p>
        </section>

        <section id="how-long" aria-labelledby="how-long-h" className={section}>
          <h2 id="how-long-h" className={h2}>
            How long we keep it
          </h2>
          <dl className="m-0 grid border-t border-line">
            {retention().map((r) => (
              <div key={r.what} className="grid gap-x-6 gap-y-0.5 border-b border-line py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <dt className="font-medium">{r.what}</dt>
                <dd className="m-0 text-muted">
                  {r.howLong}
                  {r.toConfirm && (
                    <>
                      {" "}
                      <ToConfirm />
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="m-0 text-muted">
            The database and the clean-up job delete for real: when you delete, your address and everything you follow go at once. Unconfirmed sign-ups go
            after {CONFIRM_TTL_DAYS} days and submitters&apos; emails after {SUBMITTER_EMAIL_RETENTION_DAYS} days at most, even if nobody acts.
          </p>
        </section>

        <section id="rights" aria-labelledby="rights-h" className={section}>
          <h2 id="rights-h" className={h2}>
            Your rights
          </h2>
          <p className="m-0 text-muted">You can see, change and delete what we keep. Most of it you can do yourself, straight away:</p>
          <dl className="m-0 grid border-t border-line">
            {[
              ["See or change what you follow", "Open the link in any alert email. On Telegram, send /list or /unfollow."],
              [
                "Stop alerts, delete everything and withdraw consent",
                "Press “Stop all alerts and delete my data” on that page, use the unsubscribe link in any email, or send /stop on Telegram.",
              ],
              ["Delete your email from a submission", "Open the link in your receipt and press the button."],
              [
                "Anything else",
                `A copy of your data, a correction, or an objection to how we use it: write to ${PRIVACY_EMAIL}. We reply within one month, and may ask you to show the address is yours.`,
              ],
            ].map(([what, how]) => (
              <div key={what} className="grid gap-x-6 gap-y-0.5 border-b border-line py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <dt className="font-medium">{what}</dt>
                <dd className="m-0 text-muted">{how}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="complain" aria-labelledby="complain-h" className={section}>
          <h2 id="complain-h" className={h2}>
            Complaints
          </h2>
          <p className="m-0">
            If you are unhappy with how we handle your data, write to <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> first and we will try to put it
            right. You can also complain to the Information Commissioner&apos;s Office (ICO), the UK&apos;s data protection regulator, at{" "}
            <a href={ICO_COMPLAINTS_URL}>ico.org.uk/make-a-complaint</a> or on {ICO_PHONE}.
          </p>
        </section>

        <section aria-labelledby="faq-h" className={section}>
          <h2 id="faq-h" className={h2}>
            Questions
          </h2>
          <div className="grid gap-5">
            {faq.map(({ q, a }) => (
              <div key={q} className="grid max-w-[62ch] gap-1.5">
                <h3 className={h3}>{q}</h3>
                <p className="m-0 text-muted">{a}</p>
              </div>
            ))}
          </div>
          <p className="m-0 border-t border-line pt-4 text-caption text-muted">
            Last changed {longDate(PRIVACY_UPDATED)}. When the words you agree to before following change, we record which version each person agreed to.
          </p>
        </section>
      </main>
    </>
  );
}
