import "server-only";
import type { ActorFile, CardView } from "@ledger/schema";
import {
  billIndex,
  cardsForDivision,
  citedBills,
  constituencyBySlug,
  fetchBillTitle,
  fetchRecentVotes,
  fetchSeat,
  groupVotes,
  type BillTitle,
  type Constituency,
  type FetchLike,
  type Seat,
  type VoteGroup,
} from "@ledger/server/mp";
import { getSeed } from "@/lib/data";
import { ownerOf } from "@/lib/promises";
import { lastChanged } from "@/lib/site";

/**
 * Everything a /mp/<constituency> page shows, put together on the server.
 * Parliament's data is cached for a day (bill names for a week); the page
 * itself is regenerated daily. If Parliament does not answer, this throws:
 * the reader sees a short "try again" note, and a page that was already
 * cached keeps being served rather than being replaced by an error.
 */

const DAY_S = 86_400;
const WEEK_S = 7 * DAY_S;

/** Parliament's answers, shared by every reader and kept for a day. */
const daily: FetchLike = (url, init) => fetch(url, { ...init, next: { revalidate: DAY_S } });
const weekly: FetchLike = (url, init) => fetch(url, { ...init, next: { revalidate: WEEK_S } });

/** A card in a vote's row: the promise it cites the bill for. */
export interface CardLink {
  id: string;
  text: string;
}

export interface VoteGroupView extends VoteGroup {
  /** Our promise cards that cite this group's bill as a source or as evidence. */
  cards: CardLink[];
}

export interface MpPage {
  constituency: Constituency;
  seat: Seat;
  /** The MP (or, for a vacant seat, the last MP) when we track them as a promise-maker. */
  actor: ActorFile | null;
  /** Their own cards, most recently changed first. */
  ownCards: CardView[];
  /** Their party, when we track it. */
  party: ActorFile | null;
  /** The party's cards (as on /promises?party=…), most recently changed first. */
  partyCards: CardView[];
  /** Null for a vacant seat. */
  votes: VoteGroupView[] | null;
  /** When Parliament's data was read, for the "checked" line. */
  checkedAt: string;
}

const recentFirst = (cards: CardView[]) =>
  [...cards].sort((a, b) => (lastChanged(b.file) ?? b.file.made_on).localeCompare(lastChanged(a.file) ?? a.file.made_on) || a.id.localeCompare(b.id));

/** Names of the bills our cards cite, read once a week. A bill Parliament does not answer for is left out: its votes simply show no card link. */
async function citedBillIndex(cards: CardView[]): Promise<Map<string, string[]>> {
  const cited = citedBills(cards);
  const titles = await Promise.all([...cited.keys()].map((id) => fetchBillTitle(weekly, id).catch(() => null)));
  return billIndex(
    titles.filter((t): t is BillTitle => !!t),
    cited,
  );
}

/** Null for a slug that is not a constituency. Throws an UpstreamError when Parliament does not answer. */
export async function getMpPage(slug: string): Promise<MpPage | null> {
  const constituency = constituencyBySlug(slug);
  if (!constituency) return null;
  const seed = getSeed();
  const seat = await fetchSeat(daily, constituency);
  const memberId = seat.mp?.memberId ?? seat.lastMp?.memberId ?? null;
  const partyId = seat.mp?.party?.id ?? null;

  const actor = memberId === null ? null : (seed.actors.find((a) => a.parliament_member_id === memberId) ?? null);
  const party = partyId === null ? null : (seed.actors.find((a) => a.parliament_party_id === partyId) ?? null);
  const ownCards = actor ? recentFirst(seed.cards.filter((c) => c.actor.id === actor.id)) : [];
  const partyCards = party ? recentFirst(seed.cards.filter((c) => ownerOf(c).id === party.id)) : [];

  let votes: VoteGroupView[] | null = null;
  if (seat.mp) {
    const [recent, bills] = await Promise.all([fetchRecentVotes(daily, seat.mp.memberId), citedBillIndex(seed.cards)]);
    const text = new Map(seed.cards.map((c) => [c.id, c.current.text]));
    votes = groupVotes(recent).map((g) => ({
      ...g,
      cards: cardsForDivision(g.votes[0]!.title, bills).map((id) => ({ id, text: text.get(id) ?? id })),
    }));
  }
  return { constituency, seat, actor, ownCards, party, partyCards, votes, checkedAt: new Date().toISOString() };
}
