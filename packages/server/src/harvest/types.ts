/**
 * Promise intake from published sources (M4). Shared shapes for the three
 * parts: sources (fetch a day's Hansard, written statements and GOV.UK press
 * releases, or an uploaded transcript), extraction (Claude proposes candidate
 * promises; we keep only quotes found verbatim in the source) and drafts
 * (one YAML per candidate in content/drafts/<date>/, opened as a PR labelled
 * `intake`, never merged automatically).
 */

export type SourceKind = "hansard_statement" | "hansard_pmqs" | "hansard_wms" | "govuk_press_release" | "upload";

/** Matches the Venue enum in @ledger/schema. */
export type Venue = "manifesto" | "speech" | "debate" | "tv" | "interview" | "press_release" | "parliament" | "social";

/** Who is speaking over [start, end) of SourceDoc.text. Hansard gives this as data; press releases and uploads usually do not. */
export interface SpeakerSegment {
  start: number;
  end: number;
  /** "Yvette Cooper" */
  name: string;
  /** "Secretary of State for Health and Social Care", or null */
  role: string | null;
  /** "Labour", "Conservative", … when the source says, else null */
  party: string | null;
  /** UK Parliament member id, when known */
  memberId: number | null;
}

export interface SourceDoc {
  /** Stable and filesystem-safe, e.g. "hansard-19e8c247", "wms-hcws353", "govuk-new-pm-cuts-tax". */
  id: string;
  kind: SourceKind;
  /** Public page a reader can open (hansard.parliament.uk, questions-statements.parliament.uk, gov.uk). */
  url: string;
  title: string;
  /** The day the words were said or published (UK date, ISO). */
  date: string;
  venue: Venue;
  /** "Commons statement", "Prime Minister's Questions", "Written ministerial statement", "Press release (HM Treasury)" */
  venueLabel: string;
  /** Plain text. Quotes and spans refer to exactly this string. */
  text: string;
  segments: SpeakerSegment[];
  /** People named in the source's metadata (GOV.UK `people`), to check press-release attributions. */
  people: string[];
}

export interface CandidateSpeaker {
  name: string;
  role: string | null;
  party: string | null;
  memberId: number | null;
  /** The content/actors id when the speaker (or, failing that, their party) is a known actor. */
  actorId: string | null;
  /**
   * How we know who said it: "segment" = Hansard says this person spoke these
   * exact words; "nearby" = the name appears just before the quote in the text;
   * "unverified" = only the model says so (editors must check).
   */
  check: "segment" | "nearby" | "unverified";
}

/** Fields the model suggests from the source. Unverified; editors confirm each one. */
export interface CandidateSuggestion {
  policy_area: string | null;
  who: string | null;
  how_much: string | null;
  when: string | null;
  funded_by: string | null;
  deadline: string | null;
}

export interface Candidate {
  sourceId: string;
  /** Exactly SourceDoc.text.slice(span[0], span[1]). */
  quote: string;
  span: [number, number];
  speaker: CandidateSpeaker;
  suggested: CandidateSuggestion;
  /** One sentence: why this is a future, checkable commitment. */
  why: string;
  /** 0–1, the model's own estimate that editors will accept it. */
  confidence: number;
  model: string;
}

/** What one day's run produced, for the PR body and the run log. */
export interface HarvestReport {
  date: string;
  sources: { id: string; kind: SourceKind; title: string; url: string; candidates: number }[];
  candidates: Candidate[];
  /** Candidates dropped and why: quote not verbatim, duplicate of a card, speaker not a promise-maker… */
  dropped: { sourceId: string; reason: string; quote: string }[];
  errors: { sourceId: string; message: string }[];
}
