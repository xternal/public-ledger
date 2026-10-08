import { z } from "zod";
import { BILLS_API, isoDay, MEMBERS_API, requestJson, UpstreamError, VOTES_API, type FetchLike } from "./http";
import type { Constituency } from "./names";

/**
 * UK Parliament's open APIs (Open Parliament Licence): who holds a seat
 * (Members API), how they voted (Commons Votes API) and what a bill is
 * called (Bills API). Every answer is checked against the fields we use, so a
 * changed API fails loudly instead of showing something wrong.
 */

/** Public pages for people to check what we show. */
export const memberUrl = (id: number) => `https://members.parliament.uk/member/${id}`;
export const memberVotesUrl = (id: number) => `https://members.parliament.uk/member/${id}/voting`;
export const divisionUrl = (id: number) => `https://votes.parliament.uk/votes/commons/division/${id}`;
export const billUrl = (id: number) => `https://bills.parliament.uk/bills/${id}`;

// ---------------------------------------------------------------- Members API

const Party = z.object({ id: z.number(), name: z.string() });
const Membership = z.object({
  membershipFromId: z.number().nullable().optional(),
  house: z.number(),
  membershipStartDate: z.string(),
  membershipEndDate: z.string().nullable().optional(),
});
const Member = z.object({
  id: z.number(),
  nameDisplayAs: z.string(),
  latestParty: Party.nullable(),
  latestHouseMembership: Membership,
  thumbnailUrl: z.string().nullable().optional(),
});
type Member = z.infer<typeof Member>;

const ConstituencyAnswer = z.object({
  value: z.object({
    id: z.number(),
    name: z.string(),
    currentRepresentation: z.object({ member: z.object({ value: Member }) }).nullable(),
  }),
});

const Representations = z.object({
  value: z.array(
    z.object({
      member: z.object({ value: Member }),
      representation: z.object({ membershipStartDate: z.string(), membershipEndDate: z.string().nullable().optional() }),
    }),
  ),
});

const MemberSearch = z.object({ items: z.array(z.object({ value: Member })) });

export interface PartyRef {
  /** The Members API party id: Labour and Labour (Co-op) MPs share one. */
  id: number;
  name: string;
}

export interface Mp {
  memberId: number;
  /** As Parliament displays it, e.g. "Sir Keir Starmer". */
  name: string;
  party: PartyRef | null;
  /** First day of their current, unbroken time as an MP. */
  since: string;
  /** Parliament's official portrait, served to readers through our own server. */
  photoUrl: string | null;
}

export interface FormerMp {
  memberId: number;
  name: string;
  party: PartyRef | null;
  /** Their time as MP for this constituency. */
  from: string;
  to: string;
}

export interface Seat {
  constituency: Constituency;
  /** Null while the seat is vacant. */
  mp: Mp | null;
  /** For a vacant seat: who held it last, if Parliament records anyone. */
  lastMp: FormerMp | null;
}

function parse<T>(schema: z.ZodType<T>, body: unknown, upstream: "members" | "votes" | "bills"): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new UpstreamError(upstream, 200, "unexpected answer");
  return r.data;
}

const party = (m: Member): PartyRef | null => (m.latestParty ? { id: m.latestParty.id, name: m.latestParty.name } : null);

function toMp(m: Member): Mp {
  return {
    memberId: m.id,
    name: m.nameDisplayAs,
    party: party(m),
    since: isoDay(m.latestHouseMembership.membershipStartDate),
    photoUrl: m.thumbnailUrl ?? null,
  };
}

/** Who holds a seat now; for a vacant seat, who held it last. */
export async function fetchSeat(doFetch: FetchLike, c: Constituency): Promise<Seat> {
  const answer = parse(ConstituencyAnswer, await requestJson(doFetch, "members", `${MEMBERS_API}/Location/Constituency/${c.id}`), "members");
  const current = answer.value.currentRepresentation?.member.value;
  if (current) return { constituency: c, mp: toMp(current), lastMp: null };
  const reps = parse(Representations, await requestJson(doFetch, "members", `${MEMBERS_API}/Location/Constituency/${c.id}/Representations`), "members");
  const last = reps.value
    .filter((r) => r.representation.membershipEndDate)
    .sort((a, b) => b.representation.membershipEndDate!.localeCompare(a.representation.membershipEndDate!))[0];
  return {
    constituency: c,
    mp: null,
    lastMp: last
      ? {
          memberId: last.member.value.id,
          name: last.member.value.nameDisplayAs,
          party: party(last.member.value),
          from: isoDay(last.representation.membershipStartDate),
          to: isoDay(last.representation.membershipEndDate!),
        }
      : null,
  };
}

export interface MemberHit {
  memberId: number;
  name: string;
  party: string | null;
  constituencyId: number;
}

/** Sitting MPs whose name matches, at most ten. */
export async function searchMps(doFetch: FetchLike, name: string): Promise<MemberHit[]> {
  const q = new URLSearchParams({ Name: name, House: "1", IsCurrentMember: "true", skip: "0", take: "10" });
  const answer = parse(MemberSearch, await requestJson(doFetch, "members", `${MEMBERS_API}/Members/Search?${q}`), "members");
  return answer.items.flatMap(({ value: m }) =>
    m.latestHouseMembership.house === 1 && m.latestHouseMembership.membershipFromId
      ? [{ memberId: m.id, name: m.nameDisplayAs, party: m.latestParty?.name ?? null, constituencyId: m.latestHouseMembership.membershipFromId }]
      : [],
  );
}

// ---------------------------------------------------------------- Commons Votes API

const Teller = z.object({ MemberId: z.number() });
const MemberVoting = z.array(
  z.object({
    MemberVotedAye: z.boolean(),
    MemberVotedNo: z.boolean(),
    MemberWasTeller: z.boolean(),
    PublishedDivision: z.object({
      DivisionId: z.number(),
      Date: z.string(),
      Title: z.string(),
      AyeCount: z.number(),
      NoCount: z.number(),
      AyeTellers: z.array(Teller).nullable().optional(),
      NoTellers: z.array(Teller).nullable().optional(),
    }),
  }),
);

export interface Vote {
  divisionId: number;
  date: string;
  /** The division's official title, e.g. "Health Bill: Report Stage: New Clause 143". */
  title: string;
  ayes: number;
  noes: number;
  /** Which lobby the MP was counted in. */
  side: "aye" | "no";
  /** They counted the votes for that side rather than voting (a teller). */
  teller: boolean;
}

/** How many recent votes the page lists. */
export const RECENT_VOTES = 10;

export function memberVotingUrl(memberId: number, take = RECENT_VOTES): string {
  return `${VOTES_API}/divisions.json/membervoting?queryParameters.memberId=${memberId}&queryParameters.take=${take}`;
}

/** An MP's most recent recorded votes in the Commons, newest first. */
export async function fetchRecentVotes(doFetch: FetchLike, memberId: number, take = RECENT_VOTES): Promise<Vote[]> {
  const rows = parse(MemberVoting, await requestJson(doFetch, "votes", memberVotingUrl(memberId, take)), "votes");
  return rows
    .flatMap((r): Vote[] => {
      const d = r.PublishedDivision;
      const tellerAye = !!d.AyeTellers?.some((t) => t.MemberId === memberId);
      const tellerNo = !!d.NoTellers?.some((t) => t.MemberId === memberId);
      const side = r.MemberVotedAye || tellerAye ? "aye" : r.MemberVotedNo || tellerNo ? "no" : null;
      if (!side) return [];
      return [{ divisionId: d.DivisionId, date: isoDay(d.Date), title: d.Title.replace(/\s+/g, " ").trim(), ayes: d.AyeCount, noes: d.NoCount, side, teller: r.MemberWasTeller }];
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.divisionId - a.divisionId);
}

// ---------------------------------------------------------------- Bills API

const Bill = z.object({ billId: z.number(), shortTitle: z.string(), formerShortTitle: z.string().nullable().optional() });

export interface BillTitle {
  billId: number;
  shortTitle: string;
  /** A bill's name before it changed (most often, before it became an Act). */
  formerShortTitle: string | null;
}

/** A bill's names, or null when Parliament has no bill with that id. */
export async function fetchBillTitle(doFetch: FetchLike, billId: number): Promise<BillTitle | null> {
  const body = await requestJson(doFetch, "bills", `${BILLS_API}/Bills/${billId}`, { allow404: true });
  if (body === null) return null;
  const b = parse(Bill, body, "bills");
  return { billId: b.billId, shortTitle: b.shortTitle, formerShortTitle: b.formerShortTitle ?? null };
}
