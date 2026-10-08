import { billKey, splitTitle } from "./bills";
import type { Vote } from "./parliament";

/**
 * An MP's recent votes in plain words. Divisions are named by Parliament
 * ("Health Bill: Report Stage: New Clause 143"); here each one also gets the
 * question it decided, as a question, so "For" and "Against" read plainly.
 * Neutral by design: the same words for every MP and every party.
 */

/** Recorded votes in a row on the same subject (usually one bill on one or two days), shown as one line that opens. */
export interface VoteGroup {
  /** "Health Bill", or a whole title when it has no stage ("Draft … Regulations 2026"). */
  subject: string;
  /** The subject as a bill's name (billKey), or null when the votes were not on a bill. */
  bill: string | null;
  votes: Vote[];
  /** Newest and oldest day in the group. */
  last: string;
  first: string;
  /** How many times the MP was counted for, and against. */
  forCount: number;
  againstCount: number;
}

/** Group a newest-first list of votes: neighbours on the same subject share a line. */
export function groupVotes(votes: Vote[]): VoteGroup[] {
  const groups: VoteGroup[] = [];
  for (const v of votes) {
    const { subject } = splitTitle(v.title);
    const prev = groups.at(-1);
    if (prev && prev.subject === subject) {
      prev.votes.push(v);
      prev.first = v.date < prev.first ? v.date : prev.first;
      prev.last = v.date > prev.last ? v.date : prev.last;
    } else {
      groups.push({ subject, bill: billKey(subject), votes: [v], last: v.date, first: v.date, forCount: 0, againstCount: 0 });
    }
    const g = groups.at(-1)!;
    if (v.side === "aye") g.forCount += 1;
    else g.againstCount += 1;
  }
  return groups;
}

const RULES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^reasoned amendment to second reading$/i, () => "Should the bill be stopped at its second reading?"],
  [/^second reading$/i, () => "Second reading: should the bill go ahead?"],
  [/^third reading$/i, () => "Third reading: should the Commons pass the bill?"],
  [/^(?:report stage|committee of the whole house|committee)\s*:\s*new clause\s+(\S+)$/i, (m) => `Should new clause ${m[1]} be added to the bill?`],
  [/^(?:report stage|committee of the whole house|committee)\s*:\s*amendments?\s+(\S+)$/i, (m) => `Should amendment ${m[1]} be made to the bill?`],
  [/^(?:report stage|committee of the whole house|committee)\s*:\s*new schedule\s+(\S+)$/i, (m) => `Should new schedule ${m[1]} be added to the bill?`],
  [/^(?:motion to )?disagree (?:with|to) lords amendments?\s+(\S+)$/i, (m) => `Should the Commons reject Lords amendment ${m[1]}?`],
  [/^programme motion(?:\s*\(no\.?\s*\d+\))?$/i, () => "Should the timetable for debating the bill be agreed?"],
  [/^money resolution$/i, () => "Should the spending the bill needs be approved?"],
  [/^ways and means resolution$/i, () => "Should the taxes or charges the bill needs be approved?"],
];

/** The question a division decided, in plain words, when its stage is a familiar one; otherwise null (the official title says it all). */
export function plainQuestion(title: string): string | null {
  const { stage } = splitTitle(title);
  if (!stage) return null;
  const s = stage.replace(/\s+/g, " ").trim();
  for (const [re, say] of RULES) {
    const m = re.exec(s);
    if (m) return say(m);
  }
  return null;
}

export type Outcome = "passed" | "not_passed" | "tied";

/** More Ayes than Noes carries the question. A tie is settled by the Speaker's casting vote, which this data does not record. */
export function outcome(v: Pick<Vote, "ayes" | "noes">): Outcome {
  return v.ayes > v.noes ? "passed" : v.ayes < v.noes ? "not_passed" : "tied";
}

/** "Voted for", "Voted against", "Counted the votes for (a teller)". */
export function howTheyVoted(v: Pick<Vote, "side" | "teller">): string {
  const side = v.side === "aye" ? "for" : "against";
  return v.teller ? `Counted the votes ${side} (a teller)` : `Voted ${side}`;
}

/** A group's line: "Voted for", "Voted against all 6", "For 2, against 4". */
export function groupTally(g: Pick<VoteGroup, "forCount" | "againstCount">): string {
  const n = g.forCount + g.againstCount;
  if (n === 1) return g.forCount ? "Voted for" : "Voted against";
  if (!g.againstCount) return `Voted for all ${n}`;
  if (!g.forCount) return `Voted against all ${n}`;
  return `For ${g.forCount}, against ${g.againstCount}`;
}
