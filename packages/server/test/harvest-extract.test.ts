import { describe, expect, it } from "vitest";
import type { ActorFile } from "@ledger/schema";
import { DEFAULT_INTAKE_MODEL, actorFor, chunks, extractFromSources, locate, type ExtractClient } from "../src/harvest/extract";
import type { SourceDoc } from "../src/harvest/types";

const actors: ActorFile[] = [
  { id: "andy-burnham", name: "Andy Burnham", kind: "person", party_id: "labour", roles: [{ title: "Prime Minister" }] },
  { id: "labour", name: "Labour Party", kind: "party", roles: [] },
  { id: "conservatives", name: "Conservative Party", kind: "party", roles: [] },
  { id: "hm-government", name: "HM Government", kind: "government", roles: [] },
];

/** A Hansard-like source: speaker lines, then each contribution's words as a segment. */
function hansard(): SourceDoc {
  const parts: [string, string, { name: string; role: string | null; party: string | null; memberId: number | null }][] = [
    ["The Prime Minister (Andy Burnham)", "We will cap bus fares at £2 across England from 1 January 2027, and we’ll pay for it in full. That is a promise to every passenger.", { name: "Andy Burnham", role: "Prime Minister", party: null, memberId: 1 }],
    ["Madam Deputy Speaker (Ms Nusrat Ghani)", "Order. I will call the Leader of the Opposition next and we will finish by four o'clock today.", { name: "Nusrat Ghani", role: "Deputy Speaker", party: null, memberId: 2 }],
    ["Kemi Badenoch (North West Essex) (Con)", "A Conservative government will abolish stamp duty on main homes in its first Budget.", { name: "Kemi Badenoch", role: null, party: "Conservative", memberId: 3 }],
  ];
  let text = "";
  const segments: SourceDoc["segments"] = [];
  for (const [line, words, who] of parts) {
    text += `${line}\n`;
    segments.push({ start: text.length, end: text.length + words.length, ...who });
    text += `${words}\n\n`;
  }
  return { id: "hansard-0000abcd", kind: "hansard_pmqs", url: "https://hansard.parliament.uk/x", title: "Engagements", date: "2026-09-16", venue: "parliament", venueLabel: "Prime Minister's Questions", text, segments, people: [] };
}

function pressRelease(): SourceDoc {
  const text = [
    "New PM sets out energy plan",
    "The government will remove VAT from household electricity bills from 1 October 2026 for six months.",
    "Prime Minister Andy Burnham said: “We will bring bills down this winter and keep them down for every family in Britain.”",
    "Officials added that a consultation on the next steps opens next spring for anyone to answer online.",
  ].join("\n");
  return { id: "govuk-energy-plan", kind: "govuk_press_release", url: "https://www.gov.uk/x", title: "New PM sets out energy plan", date: "2026-07-21", venue: "press_release", venueLabel: "Press release (HM Treasury)", text, segments: [], people: ["Andy Burnham"] };
}

type Proposal = Partial<{ quote: string; speaker_name: string; why: string; policy_area: string | null; who: string | null; how_much: string | null; when: string | null; funded_by: string | null; deadline: string | null; confidence: number }>;
const proposal = (p: Proposal) => ({ why: "A future, checkable change.", policy_area: null, who: null, how_much: null, when: null, funded_by: null, deadline: null, confidence: 0.8, speaker_name: "", quote: "", ...p });

/** A stand-in client that answers each call with the next canned body and records the requests. */
function fakeClient(answers: (object | { stop_reason: string; text?: string; category?: string })[]) {
  const requests: Record<string, unknown>[] = [];
  const client: ExtractClient = {
    beta: {
      messages: {
        async create(body) {
          requests.push(body as unknown as Record<string, unknown>);
          const a = answers.shift() ?? { candidates: [] };
          const special = a as { stop_reason?: string; text?: string; category?: string };
          if (special.stop_reason)
            return { content: [{ type: "text", text: special.text ?? "" }], stop_reason: special.stop_reason, stop_details: { category: special.category ?? null } } as never;
          return { content: [{ type: "text", text: JSON.stringify(a) }], stop_reason: "end_turn", stop_details: null, model: DEFAULT_INTAKE_MODEL } as never;
        },
      },
    },
  };
  return { client, requests };
}

describe("locate", () => {
  it("finds the source's own characters despite quote-mark, case and spacing differences", () => {
    const text = "He said: We’ll  build 1.5 million homes in England by 2029. Then he sat down.";
    const [span] = locate("we'll build 1.5 million homes in England by 2029.", text);
    expect(text.slice(span![0], span![1])).toBe("We’ll  build 1.5 million homes in England by 2029.");
  });

  it("refuses changed, added or dropped words and partial words", () => {
    const text = "We will build 1.5 million homes in England by 2029.";
    expect(locate("We will build 2 million homes in England by 2029.", text)).toEqual([]);
    expect(locate("We will build homes in England by 2029.", text)).toEqual([]);
    expect(locate("We will build 1.5 million homes in England by 2029 at least.", text)).toEqual([]);
    expect(locate("ill build 1.5 million", text)).toEqual([]);
  });
});

describe("extractFromSources", () => {
  it("keeps verbatim quotes with exact spans and Hansard's own speaker; drops everything else, with reasons", async () => {
    const doc = hansard();
    const { client } = fakeClient([
      {
        candidates: [
          // Exact apart from a straight apostrophe: kept, stored as the source's characters.
          proposal({ quote: "We will cap bus fares at £2 across England from 1 January 2027, and we'll pay for it in full.", speaker_name: "Andy Burnham", how_much: "£2 cap", deadline: "2027-01-01", policy_area: "economic_affairs" }),
          // A paraphrase: the words are not in the source.
          proposal({ quote: "We will cap all bus fares at £2 from January next year.", speaker_name: "Andy Burnham" }),
          // The chair speaking.
          proposal({ quote: "I will call the Leader of the Opposition next and we will finish by four o'clock today.", speaker_name: "Nusrat Ghani" }),
          // Opposition promise, attributed by Hansard; the actor falls back to the party.
          proposal({ quote: "A Conservative government will abolish stamp duty on main homes in its first Budget.", speaker_name: "Kemi Badenoch", confidence: 0.9 }),
          // Low confidence.
          proposal({ quote: "That is a promise to every passenger.", speaker_name: "Andy Burnham", confidence: 0.1 }),
          // Crosses from one speaker into the next.
          proposal({ quote: "That is a promise to every passenger. Madam Deputy Speaker (Ms Nusrat Ghani) Order.", speaker_name: "Andy Burnham" }),
        ],
      },
    ]);
    const report = await extractFromSources([doc], { client, actors, known: [] });

    expect(report.errors).toEqual([]);
    expect(report.candidates).toHaveLength(2);
    // Zero hallucinated quotes: every stored quote is exactly the source at its span.
    for (const c of report.candidates) expect(doc.text.slice(c.span[0], c.span[1])).toBe(c.quote);

    const [bus, stamp] = report.candidates;
    expect(bus!.quote).toBe("We will cap bus fares at £2 across England from 1 January 2027, and we’ll pay for it in full.");
    expect(bus!.speaker).toEqual({ name: "Andy Burnham", role: "Prime Minister", party: null, memberId: 1, actorId: "andy-burnham", check: "segment" });
    expect(bus!.suggested).toMatchObject({ how_much: "£2 cap", deadline: "2027-01-01", policy_area: "economic_affairs" });
    expect(stamp!.speaker).toMatchObject({ name: "Kemi Badenoch", party: "Conservative", actorId: "conservatives", check: "segment" });

    expect(report.dropped.map((d) => d.reason).sort()).toEqual([
      "low confidence",
      "quote crosses speakers or sits outside a contribution",
      "quote not found verbatim in the source",
      "the chair does not make promises",
    ]);
  });

  it("checks press-release attributions against the text and lets a department speak for itself", async () => {
    const doc = pressRelease();
    const { client } = fakeClient([
      {
        candidates: [
          proposal({ quote: "We will bring bills down this winter and keep them down for every family in Britain.", speaker_name: "Andy Burnham" }),
          proposal({ quote: "The government will remove VAT from household electricity bills from 1 October 2026 for six months.", speaker_name: "HM Government" }),
          proposal({ quote: "a consultation on the next steps opens next spring for anyone to answer online.", speaker_name: "Rachel Reeves" }),
        ],
      },
    ]);
    const report = await extractFromSources([doc], { client, actors, known: [] });
    expect(report.candidates.map((c) => [c.speaker.name, c.speaker.check, c.speaker.actorId])).toEqual([
      ["Andy Burnham", "nearby", "andy-burnham"],
      ["HM Government", "segment", "hm-government"],
      ["Rachel Reeves", "unverified", null],
    ]);
    expect(report.candidates[1]!.speaker.role).toBe("HM Treasury");
  });

  it("skips quotes already on a card, in a draft, or earlier in the same run", async () => {
    const doc = hansard();
    const quote = "A Conservative government will abolish stamp duty on main homes in its first Budget.";
    const { client } = fakeClient([{ candidates: [proposal({ quote, speaker_name: "Kemi Badenoch" })] }, { candidates: [proposal({ quote, speaker_name: "Kemi Badenoch" })] }]);
    const known = await extractFromSources([doc], { client, actors, known: ["a conservative government will abolish stamp duty on main homes in its first budget"] });
    expect(known.candidates).toEqual([]);
    expect(known.dropped[0]!.reason).toBe("already on a card or in a draft");

    const twice = fakeClient([{ candidates: [proposal({ quote, speaker_name: "Kemi Badenoch" })] }, { candidates: [proposal({ quote, speaker_name: "Kemi Badenoch" })] }]);
    const run = await extractFromSources([doc, { ...doc, id: "hansard-0000beef" }], { client: twice.client, actors, known: [] });
    expect(run.candidates).toHaveLength(1);
    expect(run.dropped.map((d) => d.reason)).toEqual(["already on a card or in a draft"]);
  });

  it("asks Claude Opus 5.5 at high effort for schema-bound JSON, with the cached instructions and the refusal fallback", async () => {
    const { client, requests } = fakeClient([{ candidates: [] }]);
    await extractFromSources([hansard()], { client, actors, known: [] });
    const body = requests[0] as {
      model: string;
      system: { cache_control?: unknown }[];
      output_config: { effort: string; format: { type: string } };
      betas: string[];
      fallbacks: string;
      messages: { content: string }[];
    };
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.output_config.effort).toBe("high");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(body.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(body.fallbacks).toBe("default");
    expect(body.messages[0]!.content).toContain("<source>");
    expect(body.messages[0]!.content).toContain("Kind: Prime Minister's Questions");
  });

  it("reports refusals, cut-off output and malformed output as errors, never as candidates", async () => {
    const docs = [hansard(), { ...hansard(), id: "b" }, { ...hansard(), id: "c" }, { ...hansard(), id: "d" }];
    const { client } = fakeClient([
      { stop_reason: "refusal", category: "general_harms" },
      { stop_reason: "max_tokens", text: '{"candidates": [' },
      { stop_reason: "end_turn", text: "not json" },
      { candidates: [{ quote: "x" }] },
    ]);
    const report = await extractFromSources(docs, { client, actors, known: [] });
    expect(report.candidates).toEqual([]);
    expect(report.errors.map((e) => e.message)).toEqual([
      "model declined (general_harms)",
      "model output cut off (max_tokens)",
      "model output was not JSON",
      expect.stringMatching(/^model output did not match the schema/),
    ]);
  });

  it("without an API key extracts nothing and says why", async () => {
    const report = await extractFromSources([hansard()], { client: null, actors, known: [] });
    expect(report.candidates).toEqual([]);
    expect(report.errors).toEqual([{ sourceId: "hansard-0000abcd", message: "extraction skipped: ANTHROPIC_API_KEY not set" }]);
  });
});

describe("helpers", () => {
  it("splits long sources at paragraph breaks and loses nothing", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} ${"x".repeat(80)}`).join("\n\n");
    const parts = chunks(text, 1000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("")).toBe(text);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
  });

  it("maps speakers to actors by name, then party, the same way for every party", () => {
    expect(actorFor(actors, "Andy Burnham", "Labour")).toBe("andy-burnham");
    expect(actorFor(actors, "Someone New", "Labour")).toBe("labour");
    expect(actorFor(actors, "Someone New", "Conservative")).toBe("conservatives");
    expect(actorFor(actors, "Someone New", null)).toBeNull();
  });
});
