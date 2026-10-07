import { describe, expect, it } from "vitest";
import { DraftFile, draftViolations, quoteWords } from "../src/drafts";

const SOURCE =
  "Mr Speaker, with permission I will make a statement. We will cap bus fares at £2 from January for every route in England. I commend this statement to the House.";
const QUOTE = "We will cap bus fares at £2 from January for every route in England.";
const START = SOURCE.indexOf(QUOTE);

const draft = (): DraftFile => ({
  draft: "llm_intake",
  intake_date: "2026-10-06",
  source: {
    id: "hansard-19e8c247",
    kind: "hansard_statement",
    url: "https://hansard.parliament.uk/Commons/2026-10-06/debates/19E8C247-0000-0000-0000-000000000000/BusFares",
    title: "Bus Fares",
    date: "2026-10-06",
    venue_label: "Commons statement",
  },
  quote: QUOTE,
  source_span: [START, START + QUOTE.length],
  speaker: { name: "A Minister", role: "Secretary of State for Transport", party: null, member_id: 1234, actor_id: null, check: "segment" },
  suggested: { policy_area: "economic_affairs", who: "Bus passengers in England", how_much: null, when: "from January", funded_by: null, deadline: null },
  why: "A future, checkable cap on bus fares with a start date.",
  confidence: 0.8,
  model: "claude-opus-5-5",
  status: "to_review",
});

describe("DraftFile schema", () => {
  it("accepts a valid draft, and its quote passes the exact-match check", () => {
    expect(DraftFile.safeParse(draft()).success).toBe(true);
    expect(draftViolations(draft(), SOURCE)).toEqual([]);
  });

  it("rejects unknown fields, a wrong status and a confidence over 1", () => {
    expect(DraftFile.safeParse({ ...draft(), extra: 1 }).success).toBe(false);
    expect(DraftFile.safeParse({ ...draft(), status: "published" }).success).toBe(false);
    expect(DraftFile.safeParse({ ...draft(), confidence: 1.2 }).success).toBe(false);
    expect(DraftFile.safeParse({ ...draft(), draft: "manual" }).success).toBe(false);
  });

  it("rejects a source id that is not filesystem-safe", () => {
    const d = draft();
    d.source.id = "../../etc/passwd";
    expect(DraftFile.safeParse(d).success).toBe(false);
  });
});

describe("draftViolations", () => {
  it("fails a quote one character off the source", () => {
    const d = draft();
    d.quote = QUOTE.replace("£2", "£3");
    const v = draftViolations(d, SOURCE);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/does not match the source text/);
    expect(v[0]).toMatch(/first difference at character 26/);
  });

  it("fails a quote with a curly apostrophe where the source has a straight one", () => {
    const src = "We won't raise income tax, national insurance or VAT on working people.";
    const d = { quote: "We won’t raise income tax, national insurance or VAT on working people.", source_span: [0, src.length] as [number, number] };
    expect(draftViolations(d, src)).toHaveLength(1);
  });

  it("fails a span shifted by one character", () => {
    const d = draft();
    d.source_span = [START + 1, START + QUOTE.length + 1];
    expect(draftViolations(d, SOURCE)).toHaveLength(1);
  });

  it("fails a short quote even when it matches", () => {
    const quote = "We will cap bus fares.";
    const src = `Today: ${quote}`;
    const v = draftViolations({ quote, source_span: [7, 7 + quote.length] }, src);
    expect(v).toEqual(["quote has 5 word(s); a promise quote needs at least 6"]);
  });

  it("fails a span outside the text, empty or reversed", () => {
    for (const span of [
      [START, SOURCE.length + 1],
      [-1, 10],
      [10, 10],
      [20, 10],
    ] as [number, number][]) {
      const v = draftViolations({ quote: QUOTE, source_span: span }, SOURCE);
      expect(v[0]).toMatch(/not inside the source text/);
    }
  });

  it("counts words the way the matcher does", () => {
    expect(quoteWords("We'll build 1.5 million homes — £2 caps!")).toBe(8);
    expect(quoteWords("naïve café")).toBe(2);
    expect(quoteWords("  ")).toBe(0);
  });
});
