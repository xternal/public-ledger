import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { ActorFile, CardView } from "@ledger/schema";
import {
  constituencyBySlug,
  divisionUrl,
  groupTally,
  howTheyVoted,
  memberPortraitUrl,
  memberUrl,
  memberVotesUrl,
  outcome,
  plainQuestion,
  PORTRAIT_LICENCE_URL,
  splitTitle,
  type Mp,
  type Seat,
  type Vote,
} from "@ledger/server/mp";
import { SiteHeader } from "@/components/SiteHeader";
import { PromiseList } from "@/components/PromiseList";
import { CREDIT_COLUMNS, MixBar } from "@/components/CreditTable";
import { QualityBadge } from "@/components/ui";
import { JsonLd } from "@/components/JsonLd";
import { getMpPage, type MpPage, type VoteGroupView } from "@/lib/mp";
import { longDate } from "@/lib/format";
import { shortName, todayIso } from "@/lib/promises";
import { absolute, SITE_NAME } from "@/lib/site";
import { mpPageDescription, mpPageTitle, MP_TITLE, OPL_ATTRIBUTION, OPL_URL } from "@/lib/mp-copy";

type Props = { params: Promise<{ slug: string }> };

/**
 * One page per constituency, rendered the first time someone asks for it and
 * then served from the cache, refreshed at most once a day. Nothing is
 * rendered at build time, so a build never waits on Parliament.
 */
export const revalidate = 86400;
export function generateStaticParams() {
  return [];
}

/** How many cards to show before "see all": a few, never a wall. */
const OWN_CARDS = 3;
const PARTY_CARDS = 3;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = constituencyBySlug(slug);
  if (!c) return {};
  // The MP's name comes from the cached page data; if Parliament is down the description falls back to the constituency alone.
  const page = await getMpPage(slug).catch(() => null);
  const title = mpPageTitle(c.name);
  const description = mpPageDescription(c.name, page?.seat.mp?.name ?? null);
  return {
    title: `${title} | Public Ledger`,
    description,
    alternates: { canonical: `/mp/${c.slug}` },
    openGraph: { title, description, type: "profile", url: `/mp/${c.slug}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

function structuredData(p: MpPage) {
  const { constituency: c, seat } = p;
  const url = absolute(`/mp/${c.slug}`);
  const place = { "@type": "AdministrativeArea", name: `${c.name} (UK Parliament constituency)` };
  const person = (mp: Mp) => ({
    "@type": "Person",
    name: mp.name,
    jobTitle: `Member of Parliament for ${c.name}`,
    ...(mp.photoUrl ? { image: mp.photoUrl } : {}),
    sameAs: [memberUrl(mp.memberId)],
    memberOf: [
      { "@type": "GovernmentOrganization", name: "House of Commons", url: "https://www.parliament.uk/business/commons/" },
      ...(mp.party ? [{ "@type": "Organization", name: mp.party.name }] : []),
    ],
    workLocation: place,
  });
  return [
    {
      "@context": "https://schema.org",
      "@type": seat.mp ? "ProfilePage" : "WebPage",
      url,
      name: mpPageTitle(c.name),
      description: mpPageDescription(c.name, seat.mp?.name ?? null),
      inLanguage: "en-GB",
      dateModified: p.checkedAt,
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absolute("/") },
      mainEntity: seat.mp ? person(seat.mp) : place,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: absolute("/") },
        { "@type": "ListItem", position: 2, name: MP_TITLE, item: absolute("/mp") },
        { "@type": "ListItem", position: 3, name: c.name, item: url },
      ],
    },
  ];
}

/** "15:20 BST, 8 Oct 2026": when Parliament's data was read, in UK time. */
function checkedText(iso: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(d);
  return `${time.replace("GMT+1", "BST")}, ${longDate(d.toLocaleDateString("en-CA", { timeZone: "Europe/London" }))}`;
}

export default async function MpPageView({ params }: Props) {
  const { slug } = await params;
  const p = await getMpPage(slug);
  if (!p) notFound();
  const { constituency: c, seat } = p;

  return (
    <>
      <JsonLd data={structuredData(p)} />
      <SiteHeader current="/mp" />
      <main className="mx-auto grid max-w-[860px] grid-cols-[minmax(0,1fr)] gap-12 px-4 pb-20 pt-8 sm:px-6">
        <div className="grid gap-5">
          <a href="/mp" className="justify-self-start text-label font-medium">
            Find another MP
          </a>
          {seat.mp ? <Who mp={seat.mp} constituency={c.name} /> : <Vacant seat={seat} actor={p.actor} />}
        </div>

        {seat.mp && <Promises page={p} mp={seat.mp} />}
        {seat.mp && p.votes && <Votes mp={seat.mp} groups={p.votes} />}

        <section aria-labelledby="mp-about-h" className="grid max-w-[66ch] gap-3 border-t border-line pt-8 text-sm text-muted">
          <h2 id="mp-about-h" className="m-0 text-body font-semibold text-ink">
            About this page
          </h2>
          {seat.mp ? (
            <p className="m-0">
              Who represents {c.name} in the House of Commons, the promises we track for them and their party, and their most recent votes. MPs and votes
              come from UK Parliament&apos;s Members and Commons Votes APIs, checked once a day; this page last checked at {checkedText(p.checkedAt)}. Promises
              come from our <a href="/promises">promise ledger</a>, where every party is held to the same standard.
            </p>
          ) : (
            <p className="m-0">
              Who represents {c.name} in the House of Commons. While the seat is vacant, the page names the last MP; once a new MP is elected it shows them,
              the promises we track for them and their party, and how they vote. The data comes from UK Parliament&apos;s Members API, checked once a day; this
              page last checked at {checkedText(p.checkedAt)}.
            </p>
          )}
          <p className="m-0 text-caption">
            <a href={OPL_URL}>{OPL_ATTRIBUTION}</a>
            {seat.mp?.photoUrl && (
              <>
                {" "}
                Portrait: <a href={memberPortraitUrl(seat.mp.memberId)}>official UK Parliament portrait</a>, <a href={PORTRAIT_LICENCE_URL}>CC BY 3.0</a>,
                resized.
              </>
            )}
          </p>
        </section>
      </main>
    </>
  );
}

function Who({ mp, constituency }: { mp: Mp; constituency: string }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-3">
      {mp.photoUrl ? (
        <Image
          src={mp.photoUrl}
          alt={`Official portrait of ${mp.name}`}
          width={104}
          height={104}
          preload
          className="size-[84px] rounded-panel bg-sunk object-cover sm:size-[104px]"
        />
      ) : (
        <span aria-hidden className="size-[84px] rounded-panel bg-sunk sm:size-[104px]" />
      )}
      <div className="grid min-w-0 gap-1.5">
        <h1 className="m-0 grid gap-1">
          <span className="text-label font-medium text-muted">Your MP in {constituency}</span>
          <span className="text-[clamp(28px,4.4vw,40px)] font-semibold leading-[1.06] tracking-[-0.035em]">{mp.name}</span>
        </h1>
        <p className="m-0 text-[15px] text-ink">
          {mp.party?.name ?? "No party"}
          <span className="text-muted"> · MP since {longDate(mp.since)}</span>
        </p>
      </div>
      <p className="col-span-2 m-0 flex flex-wrap gap-x-5 gap-y-1 text-label">
        <a href={memberUrl(mp.memberId)} rel="noopener noreferrer" target="_blank">
          Profile and contact details on parliament.uk
        </a>
      </p>
    </div>
  );
}

function Vacant({ seat, actor }: { seat: Seat; actor: ActorFile | null }) {
  const last = seat.lastMp;
  return (
    <div className="grid gap-3">
      <h1 className="m-0 grid gap-1">
        <span className="text-label font-medium text-muted">Your MP in {seat.constituency.name}</span>
        <span className="text-[clamp(28px,4.4vw,40px)] font-semibold leading-[1.06] tracking-[-0.035em]">This seat is vacant</span>
      </h1>
      <p className="m-0 max-w-[60ch] text-lead text-muted">
        {seat.constituency.name} has no MP until a by-election.
        {last && (
          <>
            {" "}
            The last MP was <span className="text-ink">{last.name}</span>
            {last.party ? ` (${last.party.name})` : ""}, from {longDate(last.from)} to {longDate(last.to)}.
          </>
        )}
      </p>
      {(actor || last) && (
        <p className="m-0 flex flex-wrap gap-x-5 gap-y-1 text-label">
          {actor && <a href={`/actor/${actor.id}`}>Promises we track for {actor.name}</a>}
          {last && (
            <a href={memberUrl(last.memberId)} rel="noopener noreferrer" target="_blank">
              {last.name} on parliament.uk
            </a>
          )}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- promises

function Promises({ page, mp }: { page: MpPage; mp: Mp }) {
  const { actor, ownCards, party, partyCards } = page;
  const today = todayIso();
  const shown = new Set(ownCards.slice(0, OWN_CARDS).map((c) => c.id));
  const partyRest = partyCards.filter((c) => !shown.has(c.id));
  return (
    <section aria-labelledby="mp-promises-h" className="grid gap-8">
      <h2 id="mp-promises-h" className="m-0 text-title font-semibold">
        Their promises
      </h2>

      {actor && ownCards.length > 0 && (
        <div className="grid gap-3">
          <h3 className="m-0 text-body font-semibold">
            Made by {actor.name}: {ownCards.length} {ownCards.length === 1 ? "promise" : "promises"}
          </h3>
          <PromiseList cards={ownCards.slice(0, OWN_CARDS)} today={today} />
          {ownCards.length > OWN_CARDS && (
            <a href={`/actor/${actor.id}`} className="justify-self-start text-label font-medium">
              See all {ownCards.length} promises by {actor.name}
            </a>
          )}
        </div>
      )}

      {party ? (
        <PartyPromises party={party} cards={partyCards} rest={partyRest} limit={PARTY_CARDS} today={today} />
      ) : (
        <p className="m-0 max-w-[62ch] text-sm text-muted">{noPartyText(mp)}</p>
      )}
    </section>
  );
}

/** Why there is no party summary. Facts only, the same words for any MP in the same position. */
function noPartyText(mp: Mp): string {
  const name = mp.party?.name;
  if (name === "Speaker") return `As Speaker, ${mp.name} stands apart from party politics, so there are no party promises to show.`;
  if (!name || name === "Independent") return `${mp.name} sits as an independent MP, so there are no party promises to show.`;
  return `We do not track promises by ${name} yet. If you know of one, you can send it in from the home page.`;
}

function PartyPromises({ party, cards, rest, limit, today }: { party: ActorFile; cards: CardView[]; rest: CardView[]; limit: number; today: string }) {
  const counts = CREDIT_COLUMNS.map((col) => cards.filter((c) => col.statuses.includes(c.file.status)).length);
  const name = shortName(party);
  const href = `/promises?party=${encodeURIComponent(party.id)}`;
  if (!cards.length) return <p className="m-0 text-sm text-muted">We do not track any promises by {party.name} yet.</p>;
  return (
    <div className="grid gap-3">
      <h3 className="m-0 text-body font-semibold">{name}&apos;s promises</h3>
      <div className="grid gap-2 border-y border-line py-4">
        <p className="m-0 flex items-baseline gap-2">
          <span className="text-figure font-semibold tracking-figure tabular-nums">{cards.length}</span>
          <span className="text-label text-muted">tracked promises by the {party.name} and its politicians</span>
        </p>
        <MixBar counts={counts} total={cards.length} />
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-label text-muted">
          {CREDIT_COLUMNS.map((col, i) =>
            counts[i] ? (
              <li key={col.label} className="inline-flex items-center gap-1.5">
                <i className="size-2 rounded-full" style={{ background: col.color }} aria-hidden />
                {col.label}: <b className="font-semibold text-ink">{counts[i]}</b>
              </li>
            ) : null,
          )}
        </ul>
      </div>
      {rest.length > 0 && (
        <>
          <p className="m-0 text-label text-muted">Most recently updated:</p>
          <PromiseList cards={rest.slice(0, limit)} today={today} />
        </>
      )}
      <a href={href} className="justify-self-start text-label font-medium">
        See all {cards.length} {name} promises
      </a>
    </div>
  );
}

// ---------------------------------------------------------------- votes

function Votes({ mp, groups }: { mp: Mp; groups: VoteGroupView[] }) {
  const count = groups.reduce((n, g) => n + g.votes.length, 0);
  const linked = groups.filter((g) => g.cards.length).length;
  return (
    <section aria-labelledby="mp-votes-h" className="grid gap-4">
      <div className="grid gap-1.5">
        <h2 id="mp-votes-h" className="m-0 text-title font-semibold">
          How they voted recently
        </h2>
        {count ? (
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>
              Their last {count} recorded {count === 1 ? "vote" : "votes"} in the Commons, newest first.
              {linked ? ` ${linked === 1 ? "One is" : `${linked} are`} on a bill our promise cards cite.` : ""}
            </span>
            <QualityBadge quality="sourced" />
          </p>
        ) : null}
      </div>
      {count ? (
        <ul className="m-0 grid list-none border-t border-line p-0">
          {groups.map((g) => (
            <li key={g.votes[0]!.divisionId} className={`border-b border-line ${g.cards.length ? "bg-rec/6" : ""}`}>
              {g.votes.length === 1 ? <OneVote v={g.votes[0]!} group={g} /> : <VoteGroupRow group={g} />}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 border-y border-line py-5 text-sm text-muted">
          No recorded votes. The Speaker and Deputy Speakers do not vote, and Sinn Féin MPs do not take their seats.
        </p>
      )}
      <a href={memberVotesUrl(mp.memberId)} rel="noopener noreferrer" target="_blank" className="justify-self-start text-label font-medium">
        Every vote by {mp.name} on parliament.uk
      </a>
    </section>
  );
}

function resultText(v: Vote): string {
  const o = outcome(v);
  const tally = `${v.ayes} for, ${v.noes} against`;
  return o === "passed" ? `Passed: ${tally}` : o === "not_passed" ? `Not passed: ${tally}` : `Tied: ${tally}`;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded-full bg-sunk px-2 py-0.5 text-caption font-semibold text-ink shadow-[inset_0_0_0_1px_var(--line)]">{children}</span>
  );
}

function CardLinks({ group }: { group: VoteGroupView }) {
  if (!group.cards.length) return null;
  return (
    <p className="m-0 grid gap-1 text-label">
      <span className="font-medium text-rec">On a bill our promise cards cite:</span>
      {group.cards.map((c) => (
        <a key={c.id} href={`/promise/${c.id}`} className="line-clamp-2">
          “{c.text}”
        </a>
      ))}
    </p>
  );
}

/** Dates as "8 Sep 2026" or "7 to 8 Sep 2026". */
function dayRange(first: string, last: string): string {
  if (first === last) return longDate(first);
  const [a, b] = [longDate(first), longDate(last)];
  const [ad, am, ay] = a.split(" ");
  const [, bm, by] = b.split(" ");
  if (ay === by && am === bm) return `${ad} to ${b}`;
  if (ay === by) return `${ad} ${am} to ${b}`;
  return `${a} to ${b}`;
}

function OneVote({ v, group }: { v: Vote; group: VoteGroupView }) {
  const { subject, stage } = splitTitle(v.title);
  const question = plainQuestion(v.title);
  return (
    <div className="grid gap-1.5 px-3 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <a href={divisionUrl(v.divisionId)} rel="noopener noreferrer" target="_blank" className="min-w-0 text-[15px] font-medium text-ink">
          {subject}
        </a>
        <Pill>{howTheyVoted(v)}</Pill>
      </div>
      <p className="m-0 text-label text-muted">
        {question ?? stage ?? ""}
        {question || stage ? " · " : ""}
        {longDate(v.date)} · {resultText(v)}
      </p>
      <CardLinks group={group} />
    </div>
  );
}

function VoteGroupRow({ group: g }: { group: VoteGroupView }) {
  return (
    <details className="group">
      <summary className="grid cursor-pointer list-none gap-1.5 px-3 py-3.5 hover:bg-sunk [&::-webkit-details-marker]:hidden">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 text-[15px] font-medium text-ink">
            <span aria-hidden className="mr-1.5 inline-block text-muted transition-transform group-open:rotate-90">
              ›
            </span>
            {g.subject}
          </span>
          <Pill>{groupTally(g)}</Pill>
        </span>
        <span className="pl-4 text-label text-muted">
          {g.votes.length} votes · {dayRange(g.first, g.last)}
          <span className="group-open:hidden"> · Show each vote</span>
        </span>
      </summary>
      <div className="grid gap-3 px-3 pb-4 pl-7">
        <CardLinks group={g} />
        <ul className="m-0 grid list-none gap-2.5 p-0">
          {g.votes.map((v) => {
            const { stage } = splitTitle(v.title);
            const question = plainQuestion(v.title);
            return (
              <li key={v.divisionId} className="grid gap-0.5 border-l-2 border-line pl-3">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <a href={divisionUrl(v.divisionId)} rel="noopener noreferrer" target="_blank" className="text-sm text-ink">
                    {question ?? stage ?? v.title}
                  </a>
                  <span className="text-label font-semibold text-ink">{howTheyVoted(v)}</span>
                </span>
                <span className="text-caption text-muted">
                  {question && stage ? `${stage} · ` : ""}
                  {longDate(v.date)} · {resultText(v)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
