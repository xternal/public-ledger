import type { BillTitle } from "./parliament";
import { foldName } from "./names";

/**
 * Which of an MP's votes were on a bill that one of our promise cards cites.
 *
 * A card cites a bill by linking its page on bills.parliament.uk, as a source
 * or as an event's evidence. Commons divisions carry no bill id, only a title
 * ("Social Housing Bill [Lords]: Second Reading"), so both sides are reduced
 * to the bill's name: the Bills API gives the name for an id ("Social
 * Housing Bill [HL]", or "Great British Energy Act 2025" once passed).
 */

const BILL_LINK = /^https?:\/\/bills\.parliament\.uk\/bills\/(\d+)(?=$|[/?#])/i;

/** The bills.parliament.uk bill id in a link, if it is one. */
export function billIdFromUrl(url: string): number | null {
  const m = BILL_LINK.exec(url.trim());
  return m ? Number(m[1]) : null;
}

/** The fields of a card that can cite a bill. */
export interface CitingCard {
  id: string;
  file: { sources: { url: string }[]; events: { evidence_url?: string | undefined }[] };
}

/** Bill id → the cards citing it, in the order given. */
export function citedBills(cards: CitingCard[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const c of cards) {
    const urls = [...c.file.sources.map((s) => s.url), ...c.file.events.flatMap((e) => (e.evidence_url ? [e.evidence_url] : []))];
    for (const url of urls) {
      const id = billIdFromUrl(url);
      if (id === null) continue;
      const ids = out.get(id) ?? [];
      if (!ids.includes(c.id)) ids.push(c.id);
      out.set(id, ids);
    }
  }
  return out;
}

/**
 * A bill's name, reduced so the Bills API and the Commons Votes API agree:
 * the house it started in ("[HL]", "[Lords]") goes, an Act is read as its
 * bill, and case, accents and punctuation are folded. Null when the title is
 * not a bill's (a statutory instrument, an opposition day motion).
 * "Finance (No. 2) Bill" keeps its number: it is a different bill.
 */
export function billKey(title: string): string | null {
  const s = foldName(title.replace(/\[(?:HL|Lords)\]/gi, " ").replace(/\bAct\s+\d{4}\b/i, "Bill"));
  return /\bbill$/.test(s) ? s : null;
}

/** Stages that Parliament sometimes writes after a bill's name without a colon: "Armed Forces Bill Report Stage: New Clause 22". */
const STAGE_AFTER_BILL = /^(?:report stage|remaining stages|committee(?: of the whole house)?|second reading|third reading|consideration of lords amendments)\b/i;

/**
 * "Health Bill: Report Stage: New Clause 143" and "Health Bill Report Stage:
 * New Clause 143" both → subject "Health Bill", stage "Report Stage: New
 * Clause 143". A title with no stage is all subject.
 */
export function splitTitle(title: string): { subject: string; stage: string | null } {
  const t = title.replace(/\s+/g, " ").trim();
  const i = t.indexOf(":");
  const head = (i < 0 ? t : t.slice(0, i)).trim();
  const rest = i < 0 ? null : t.slice(i + 1).trim() || null;
  const m = /^(.*\bBill(?:\s*\[(?:Lords|HL)\])?)\s+(.+)$/i.exec(head);
  if (m && STAGE_AFTER_BILL.test(m[2]!)) return { subject: m[1]!.trim(), stage: rest ? `${m[2]}: ${rest}` : m[2]! };
  return { subject: head, stage: rest };
}

/** Bill name (as billKey) → the cards citing that bill. */
export function billIndex(titles: BillTitle[], cited: Map<number, string[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of titles) {
    const cards = cited.get(t.billId);
    if (!cards?.length) continue;
    for (const name of [t.shortTitle, t.formerShortTitle]) {
      const key = name ? billKey(name) : null;
      if (!key) continue;
      const ids = out.get(key) ?? [];
      for (const id of cards) if (!ids.includes(id)) ids.push(id);
      out.set(key, ids);
    }
  }
  return out;
}

/** The cards citing the bill a division was about; empty when it was not about a cited bill. */
export function cardsForDivision(title: string, index: Map<string, string[]>): string[] {
  const key = billKey(splitTitle(title).subject);
  return key ? (index.get(key) ?? []) : [];
}
