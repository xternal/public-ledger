import { htmlToText } from "../../intake/text";
import type { SourceDoc, SpeakerSegment } from "../types";
import { cleanPersonName, errorMessage, getJson, squash, type FetchLike } from "./util";

/**
 * Commons Chamber from the Hansard API: oral ministerial statements and Prime
 * Minister's Questions for one sitting day. Every speaker is handled the same
 * way; who counts as a promise-maker is decided later, from roles, not here.
 */

export const HANSARD_API = "https://hansard-api.parliament.uk";

interface TreeItem {
  Id: number;
  ParentId: number | null;
  Title: string | null;
  ExternalId: string | null;
  HRSTag: string | null;
  SortOrder?: number;
}

interface TreeSection {
  Title?: string;
  SectionTreeItems?: TreeItem[];
}

export interface HansardItem {
  ItemType: string;
  MemberId: number | string | null;
  AttributedTo: string | null;
  Value: string | null;
  HRSTag: string | null;
}

export interface HansardDebate {
  Overview: { ExtId: string; Title: string; HRSTag?: string | null };
  Items: HansardItem[] | null;
  ChildDebates?: HansardDebate[] | null;
}

type Errors = { sourceId: string; message: string }[];

// ---------------------------------------------------------------- urls and ids

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hansardId(extId: string): string {
  return `hansard-${extId.slice(0, 8).toLowerCase()}`;
}

/** "Thirlwall Inquiry: Final Report  and Recommendations" → "ThirlwallInquiryFinalReportAndRecommendations". */
export function titleSlug(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/['‘’ʼ`´]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
}

export function hansardUrl(date: string, extId: string, title: string): string {
  return `https://hansard.parliament.uk/Commons/${date}/debates/${extId}/${titleSlug(title)}`;
}

// ---------------------------------------------------------------- who is speaking

/** Hansard's party abbreviations, as printed after a member's constituency. */
export const HANSARD_PARTIES: Record<string, string> = {
  con: "Conservative",
  lab: "Labour",
  "lab/co-op": "Labour (Co-op)",
  ld: "Liberal Democrat",
  snp: "Scottish National Party",
  reform: "Reform UK",
  "reform uk": "Reform UK",
  ruk: "Reform UK",
  green: "Green Party",
  grn: "Green Party",
  pc: "Plaid Cymru",
  dup: "Democratic Unionist Party",
  sf: "Sinn Féin",
  sdlp: "Social Democratic and Labour Party",
  alliance: "Alliance",
  ind: "Independent",
  independent: "Independent",
  uup: "Ulster Unionist Party",
  tuv: "Traditional Unionist Voice",
  alba: "Alba Party",
  "your party": "Your Party",
  spk: "Speaker",
  speaker: "Speaker",
};

export function partyFromAbbreviation(abbr: string): string | null {
  return HANSARD_PARTIES[squash(abbr).toLowerCase()] ?? null;
}

export interface Attribution {
  /** Plain name, titles removed; null when the attribution gives only a role ("The Prime Minister"). */
  name: string | null;
  role: string | null;
  party: string | null;
  /** True when the name is given in full (in brackets after a role, or with constituency and party). */
  full: boolean;
  /** The Speaker, a Deputy Speaker or a Chair: they keep order and make no promises. */
  chair: boolean;
}

const SPEAKER = /^(?:mr\.?|madam|madame|mister)?\s*(deputy\s+)?speaker(?:-elect)?$/i;
const MR_CHAIR = /^(?:mr\.?|madam|madame)\s+chair(?:man|woman)?$/i;
const CHAIR_ROLE =
  /^(?:(?:deputy\s+)?speaker|(?:temporary\s+)?chair(?:man|woman)?|chairman of ways and means|(?:(?:first|second)\s+)?deputy\s+chairman(?:\s+of\s+ways\s+and\s+means)?)$/i;
const COLLECTIVE = /^(?:several\s+)?hon\.?\s+members\b/i;

/** "The Prime Minister", "Mr Speaker", "Madam Deputy Speaker", "The Chairman of Ways and Means". */
function looksLikeRole(outer: string): boolean {
  return /^the\s/i.test(outer) || SPEAKER.test(outer) || MR_CHAIR.test(outer);
}

function roleOf(outer: string): { role: string; chair: boolean } {
  const speaker = SPEAKER.exec(outer);
  if (speaker) return { role: speaker[1] ? "Deputy Speaker" : "Speaker", chair: true };
  if (MR_CHAIR.test(outer)) return { role: "Chair", chair: true };
  const role = outer.replace(/^the\s+/i, "");
  return { role, chair: CHAIR_ROLE.test(role) };
}

/**
 * Read Hansard's `AttributedTo`:
 * - "The Secretary of State for Health and Social Care (Yvette Cooper)" → role + name
 * - "Kemi Badenoch (North West Essex) (Con)" → name + party
 * - "Madam Deputy Speaker (Ms Nusrat Ghani)" → chair, role "Deputy Speaker"
 * - "Yvette Cooper", "Mrs Badenoch" → name only (filled in later from the member id)
 * - "The Prime Minister", "Mr Speaker" → role only
 */
export function parseAttribution(raw: string): Attribution {
  let s = squash(raw).replace(/[—–:-]+$/, "").trim();
  if (COLLECTIVE.test(s)) return { name: s, role: null, party: null, full: false, chair: false };
  const groups: string[] = [];
  for (let m = /\s*\(([^()]*)\)\s*$/.exec(s); m && m.index > 0; m = /\s*\(([^()]*)\)\s*$/.exec(s)) {
    groups.unshift(squash(m[1]));
    s = s.slice(0, m.index).trim();
  }
  const outer = s;
  if (groups.length >= 2) {
    const abbr = groups[groups.length - 1]!;
    return { name: cleanPersonName(outer), role: null, party: partyFromAbbreviation(abbr) ?? abbr, full: true, chair: false };
  }
  if (groups.length === 1) {
    const inner = groups[0]!;
    if (looksLikeRole(outer)) {
      const { role, chair } = roleOf(outer);
      return { name: cleanPersonName(inner), role, party: null, full: true, chair };
    }
    const party = partyFromAbbreviation(inner);
    // "Name (Party)" or "Name (Constituency)".
    return { name: cleanPersonName(outer), role: null, party, full: true, chair: false };
  }
  if (looksLikeRole(outer)) {
    const { role, chair } = roleOf(outer);
    return { name: null, role, party: null, full: false, chair };
  }
  return { name: cleanPersonName(outer), role: null, party: null, full: false, chair: false };
}

function memberIdOf(v: HansardItem["MemberId"]): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

interface MemberInfo {
  name: string | null;
  fullName: boolean;
  role: string | null;
  party: string | null;
}

/** What each member id is called across a set of debates: the full name, a role and a party when any attribution gives them. */
export function memberDirectory(debates: HansardDebate[]): Map<number, MemberInfo> {
  const dir = new Map<number, MemberInfo>();
  for (const d of debates) {
    for (const it of flatten(d)) {
      const id = memberIdOf(it.MemberId);
      const attr = squash(it.AttributedTo);
      if (id === null || !attr) continue;
      const a = parseAttribution(attr);
      const known = dir.get(id) ?? { name: null, fullName: false, role: null, party: null };
      if (a.name && (!known.name || (a.full && !known.fullName))) {
        known.name = a.name;
        known.fullName = a.full;
      }
      known.role ??= a.role;
      known.party ??= a.party;
      dir.set(id, known);
    }
  }
  return dir;
}

function speakerOf(raw: string, memberId: number | null, local: Map<number, MemberInfo>, day: Map<number, MemberInfo>): Omit<SpeakerSegment, "start" | "end"> {
  const a = parseAttribution(raw);
  // What the rest of this debate (then the rest of the day) says about the same member.
  const infos = memberId === null ? [] : [local.get(memberId), day.get(memberId)].filter((i): i is MemberInfo => !!i);
  const fullName = infos.find((i) => i.fullName && i.name)?.name;
  const name = (a.full ? a.name : (fullName ?? a.name ?? infos.find((i) => i.name)?.name)) ?? a.role ?? squash(raw);
  return {
    name,
    role: a.role ?? infos.find((i) => i.role)?.role ?? null,
    party: a.party ?? infos.find((i) => i.party)?.party ?? null,
    memberId,
  };
}

// ---------------------------------------------------------------- text

/** Items of a debate and its child debates, in order. */
export function flatten(d: HansardDebate): HansardItem[] {
  return [...(d.Items ?? []), ...(d.ChildDebates ?? []).flatMap(flatten)];
}

function paragraphOf(it: HansardItem): string {
  if (it.ItemType !== "Contribution" || it.HRSTag === "hs_ColumnNumber") return "";
  return htmlToText(it.Value ?? "");
}

/**
 * The debate as plain text: for each contribution, the speaker line
 * (`AttributedTo`) then the words, with a blank line between contributions.
 * Each speaker's words get a segment; one speaker's items in a row share one.
 */
export function debateText(debate: HansardDebate, day: Map<number, MemberInfo> = new Map()): { text: string; segments: SpeakerSegment[] } {
  const local = memberDirectory([debate]);
  let text = "";
  const segments: SpeakerSegment[] = [];
  let prevKey: string | null = null;
  for (const it of flatten(debate)) {
    const para = paragraphOf(it);
    if (!para) continue;
    const attr = squash(it.AttributedTo);
    const memberId = memberIdOf(it.MemberId);
    const key = attr ? (memberId !== null ? `m${memberId}` : `a${attr.toLowerCase()}`) : null;
    if (key !== null && key === prevKey) {
      text += "\n" + para;
      segments[segments.length - 1]!.end = text.length;
      continue;
    }
    if (text) text += "\n\n";
    if (attr) text += attr + "\n";
    const start = text.length;
    text += para;
    if (attr) segments.push({ start, end: text.length, ...speakerOf(attr, memberId, local, day) });
    prevKey = key;
  }
  return { text, segments };
}

// ---------------------------------------------------------------- statements

/** "With permission, … I shall make a statement", "I would like to make a statement", "I'll make a statement". */
const STATEMENT_OPENING =
  /\bI(?:['’]ll|['’]d)?(?:\s+(?:shall|will|should|would|wish|want|like|to|now|am|going|intend|hereby|beg))*\s+make\s+(?:a|an\s+oral|this|the\s+following)\s+(?:short\s+|brief\s+|further\s+)?statement\b/i;
const OPENING_CHARS = 1_200;

/** The first contribution with words by someone other than the chair. */
function firstSubstantive(debate: HansardDebate): { attr: string; para: string } | null {
  for (const it of flatten(debate)) {
    const para = paragraphOf(it);
    const attr = squash(it.AttributedTo);
    if (!para || !attr) continue;
    const a = parseAttribution(attr);
    if (a.chair || COLLECTIVE.test(attr)) continue; // the chair, or "Hon. Members: Hear, hear!"
    return { attr, para };
  }
  return null;
}

/** An oral ministerial statement: its first substantive contribution says the speaker will make a statement. */
export function isStatementDebate(debate: HansardDebate): boolean {
  const first = firstSubstantive(debate);
  return !!first && STATEMENT_OPENING.test(first.para.slice(0, OPENING_CHARS));
}

// ---------------------------------------------------------------- the day

/** Top-level items that are never statements: headings, petitions, points of order, divisions and the like. */
const PROCEDURAL_TAGS = new Set([
  "hs_3MainHdg",
  "hs_3cMainHdg",
  "hs_3OralAnswers",
  "hs_6bPetitions",
  "hs_8Petition",
  "hs_2BusinessWODebate",
  "hs_6bBigBoldHdg",
  "hs_2cDeferredDiv",
  "DeferredDivision",
  "Division",
]);
const PROCEDURAL_TITLES =
  /^(?:points? of order|petitions?|bills? presented|business without debate|deferred divisions?|divisions?|prayers|speaker[’']?s statement|royal assent|business of the house|message to attend the lords commissioners|sitting suspended|house of commons|oral answers to questions|backbench business|members sworn|new writs?|preservation of order)$|^(?:opposition day|estimates day)\b/i;

function isFetchable(item: TreeItem): item is TreeItem & { ExternalId: string } {
  return !!item.ExternalId && GUID.test(item.ExternalId);
}

export interface HansardPlan {
  pmqs: (TreeItem & { ExternalId: string })[];
  candidates: (TreeItem & { ExternalId: string })[];
}

/** Which debates to read: PMQs (the Prime Minister's questions in Oral Answers) and every other top-level debate that could be a statement. */
export function planDay(sections: TreeSection[]): HansardPlan {
  const chamber = sections.find((s) => squash(s.Title).toLowerCase() === "commons chamber") ?? sections[0];
  const items = [...(chamber?.SectionTreeItems ?? [])].sort((a, b) => (a.SortOrder ?? 0) - (b.SortOrder ?? 0));
  const root = items.find((i) => i.ParentId === null);
  if (!root) return { pmqs: [], candidates: [] };
  const top = items.filter((i) => i.ParentId === root.Id);
  const oral = top.filter((i) => i.HRSTag === "hs_3OralAnswers" || /^oral answers/i.test(squash(i.Title)));
  const oralIds = new Set(oral.map((i) => i.Id));
  const pmDepts = new Set(items.filter((i) => i.ParentId !== null && oralIds.has(i.ParentId) && squash(i.Title).toLowerCase() === "prime minister").map((i) => i.Id));
  const pmqs = items.filter((i) => i.ParentId !== null && pmDepts.has(i.ParentId)).filter(isFetchable);
  const candidates = top
    .filter((i) => !oralIds.has(i.Id))
    .filter((i) => !(i.HRSTag && PROCEDURAL_TAGS.has(i.HRSTag)))
    .filter((i) => !PROCEDURAL_TITLES.test(squash(i.Title)))
    .filter(isFetchable);
  return { pmqs, candidates };
}

function debateUrl(extId: string): string {
  return `${HANSARD_API}/debates/debate/${extId}.json`;
}

/** One sitting day of the Commons Chamber. Errors for single debates are reported, not thrown. */
export async function fetchHansardDay(date: string, doFetch: FetchLike): Promise<{ docs: SourceDoc[]; errors: Errors }> {
  const errors: Errors = [];
  const q = `date=${date}&house=Commons`;
  const sitting = await getJson<unknown>(doFetch, `${HANSARD_API}/overview/sectionsforday.json?${q}`);
  if (!Array.isArray(sitting)) throw new Error("sectionsforday: unexpected answer");
  if (!sitting.length || !sitting.includes("Debate")) return { docs: [], errors }; // no sitting in the Chamber
  const tree = await getJson<TreeSection[]>(doFetch, `${HANSARD_API}/overview/sectiontrees.json?${q}&section=Debate`);
  if (!Array.isArray(tree)) throw new Error("sectiontrees: unexpected answer");
  const plan = planDay(tree);

  const fetched: { kind: "pmqs" | "candidate"; item: TreeItem & { ExternalId: string }; debate: HansardDebate }[] = [];
  for (const [kind, list] of [
    ["pmqs", plan.pmqs],
    ["candidate", plan.candidates],
  ] as const) {
    for (const item of list) {
      try {
        const debate = await getJson<HansardDebate>(doFetch, debateUrl(item.ExternalId));
        if (!debate?.Overview) throw new Error("debate: unexpected answer");
        fetched.push({ kind, item, debate });
      } catch (e) {
        errors.push({ sourceId: hansardId(item.ExternalId), message: errorMessage(e) });
      }
    }
  }

  const day = memberDirectory(fetched.map((f) => f.debate));
  const docs: SourceDoc[] = [];
  for (const { kind, item, debate } of fetched) {
    const statement = kind === "candidate" && isStatementDebate(debate);
    if (kind === "candidate" && !statement) continue;
    const extId = debate.Overview.ExtId || item.ExternalId;
    const title = squash(debate.Overview.Title || item.Title);
    const { text, segments } = debateText(debate, day);
    if (!text) continue;
    docs.push({
      id: hansardId(extId),
      kind: statement ? "hansard_statement" : "hansard_pmqs",
      url: hansardUrl(date, extId, title),
      title,
      date,
      venue: "parliament",
      venueLabel: statement ? "Commons statement" : "Prime Minister's Questions",
      text,
      segments,
      people: [],
    });
  }
  return { docs, errors };
}
