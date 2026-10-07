import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DraftFile } from "@ledger/schema";
import { checkDrafts, draftFromCandidate, draftYaml, knownQuotes, prBody, writeDrafts } from "../src/harvest/drafts";
import type { Candidate, HarvestReport, SourceDoc } from "../src/harvest/types";

const DATE = "2026-10-06";

// Characters that catch byte/offset slips: an emoji (two UTF-16 units), CRLF, a non-breaking space, curly quotes.
const HANSARD_TEXT = [
  "Mr Speaker 🙂, with permission, I will make a statement on buses.\r\n",
  "We will cap bus fares at £2 from January for every route in England outside London.\r\n",
  "Hon. Members: Hear, hear!\n\n",
  "That’s why we will also build 1.5 million homes by the end of this Parliament — no ifs, no buts. ",
].join("");
const PRESS_TEXT =
  "The Department for Transport today announced funding. The Secretary of State said: “We will invest £400 million a year in new bus routes from April 2027.” Notes to editors follow.";

const doc = (over: Partial<SourceDoc>): SourceDoc => ({
  id: "hansard-19e8c247",
  kind: "hansard_statement",
  url: "https://hansard.parliament.uk/Commons/2026-10-06/debates/19E8C247-AAAA-BBBB-CCCC-DDDDEEEEFFFF/Buses",
  title: "Buses",
  date: DATE,
  venue: "parliament",
  venueLabel: "Commons statement",
  text: HANSARD_TEXT,
  segments: [],
  people: [],
  ...over,
});

const DOCS: SourceDoc[] = [
  doc({}),
  doc({
    id: "govuk-new-bus-routes",
    kind: "govuk_press_release",
    url: "https://www.gov.uk/government/news/new-bus-routes",
    title: "New bus routes",
    venue: "press_release",
    venueLabel: "Press release (Department for Transport)",
    text: PRESS_TEXT,
  }),
];

function cand(sourceId: string, quote: string, over: Partial<Candidate> = {}): Candidate {
  const text = DOCS.find((d) => d.id === sourceId)!.text;
  const start = text.indexOf(quote);
  if (start < 0) throw new Error(`test quote not in source: ${quote}`);
  return {
    sourceId,
    quote,
    span: [start, start + quote.length],
    speaker: { name: "Alex Minister", role: "Secretary of State for Transport", party: "Labour", memberId: 4321, actorId: null, check: "segment" },
    suggested: { policy_area: "economic_affairs", who: "Bus passengers", how_much: null, when: "from January", funded_by: null, deadline: null },
    why: "A future, checkable cap on fares with a start date.",
    confidence: 0.82,
    model: "claude-opus-5-5",
    ...over,
  };
}

const Q_BUS = "We will cap bus fares at £2 from January for every route in England outside London.";
const Q_HOMES = "we will also build 1.5 million homes by the end of this Parliament — no ifs, no buts.";
const Q_PRESS = "We will invest £400 million a year in new bus routes from April 2027.";

function report(candidates: Candidate[], extra: Partial<HarvestReport> = {}): HarvestReport {
  return {
    date: DATE,
    sources: DOCS.map((d) => ({ id: d.id, kind: d.kind, title: d.title, url: d.url, candidates: candidates.filter((c) => c.sourceId === d.id).length })),
    candidates,
    dropped: [],
    errors: [],
    ...extra,
  };
}

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ledger-drafts-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const DAY = `content/drafts/${DATE}`;

describe("writeDrafts", () => {
  it("writes one draft per candidate and the source text byte for byte", () => {
    const root = tempRoot();
    const r = report([cand("hansard-19e8c247", Q_HOMES), cand("govuk-new-bus-routes", Q_PRESS, { speaker: { name: "Alex Minister", role: null, party: null, memberId: null, actorId: null, check: "nearby" } }), cand("hansard-19e8c247", Q_BUS)]);
    const paths = writeDrafts(r, DOCS, { root, date: DATE });
    expect(paths).toEqual([
      `${DAY}/sources/govuk-new-bus-routes.txt`,
      `${DAY}/${DATE}-govuk-new-bus-routes-1.yaml`,
      `${DAY}/sources/hansard-19e8c247.txt`,
      // Numbered in the order the quotes appear in the source.
      `${DAY}/${DATE}-hansard-19e8c247-1.yaml`,
      `${DAY}/${DATE}-hansard-19e8c247-2.yaml`,
    ]);
    expect(readFileSync(join(root, DAY, "sources/hansard-19e8c247.txt"))).toEqual(Buffer.from(HANSARD_TEXT, "utf8"));
    expect(readFileSync(join(root, DAY, "sources/govuk-new-bus-routes.txt"), "utf8")).toBe(PRESS_TEXT);

    const yaml = readFileSync(join(root, DAY, `${DATE}-hansard-19e8c247-2.yaml`), "utf8");
    expect(yaml.startsWith("# Draft from automatic intake. Not published.\n# Editors: check the quote against the source")).toBe(true);
    const back = DraftFile.parse(parse(yaml));
    expect(back).toEqual(draftFromCandidate(cand("hansard-19e8c247", Q_HOMES), DOCS[0]!, DATE));
    expect(HANSARD_TEXT.slice(back.source_span[0], back.source_span[1])).toBe(back.quote);
    expect(r.candidates).toHaveLength(3);
    expect(r.dropped).toEqual([]);
  });

  it("is deterministic: the same report gives the same files, long strings folded", () => {
    const a = tempRoot();
    const b = tempRoot();
    writeDrafts(report([cand("hansard-19e8c247", Q_BUS), cand("hansard-19e8c247", Q_HOMES)]), DOCS, { root: a, date: DATE });
    writeDrafts(report([cand("hansard-19e8c247", Q_HOMES), cand("hansard-19e8c247", Q_BUS)]), DOCS, { root: b, date: DATE });
    const files = readdirSync(join(a, DAY)).filter((f) => f.endsWith(".yaml"));
    expect(files).toHaveLength(2);
    for (const f of files) expect(readFileSync(join(a, DAY, f), "utf8")).toBe(readFileSync(join(b, DAY, f), "utf8"));
    const yaml = readFileSync(join(a, DAY, files[0]!), "utf8");
    expect(yaml).toMatch(/^quote: >-\n {2}We will cap bus fares/m);
    expect(yaml).toMatch(/^intake_date: "2026-10-06"$/m);
    expect(yaml).toMatch(/^source_span: \[\d+, \d+\]$/m);
    const keys = Object.keys(parse(yaml) as object);
    expect(keys).toEqual(["draft", "intake_date", "source", "quote", "source_span", "speaker", "suggested", "why", "confidence", "model", "status"]);
  });

  it("keeps quotes that YAML folding would change exactly as they are", () => {
    const text = "  Leading spaces, then we will build a new hospital in every county by the end of 2030 and keep it open.   ";
    const d = doc({ id: "upload-0123456789", kind: "upload", text });
    const c = { ...cand("hansard-19e8c247", Q_BUS), sourceId: d.id, quote: text, span: [0, text.length] as [number, number] };
    const draft = draftFromCandidate(c, d, DATE);
    expect((parse(draftYaml(draft)) as { quote: string }).quote).toBe(text);
  });

  it("drops a candidate whose quote is not exactly its span, and never writes it", () => {
    const root = tempRoot();
    const bad = { ...cand("hansard-19e8c247", Q_BUS), quote: Q_BUS.replace("£2", "£3") };
    const r = report([bad, cand("govuk-new-bus-routes", Q_PRESS)]);
    const paths = writeDrafts(r, DOCS, { root, date: DATE });
    expect(paths.some((p) => p.includes("hansard"))).toBe(false);
    expect(r.candidates).toHaveLength(1);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]!.reason).toMatch(/failed the draft check: quote does not match the source text/);
    expect(r.sources.find((s) => s.id === "hansard-19e8c247")!.candidates).toBe(0);
  });

  it("continues numbering after earlier drafts, and leaves a source alone if its text changed", () => {
    const root = tempRoot();
    writeDrafts(report([cand("hansard-19e8c247", Q_BUS)]), DOCS, { root, date: DATE });
    const paths = writeDrafts(report([cand("hansard-19e8c247", Q_HOMES)]), DOCS, { root, date: DATE });
    expect(paths).toEqual([`${DAY}/${DATE}-hansard-19e8c247-2.yaml`]);

    const changed = DOCS.map((d) => (d.id === "hansard-19e8c247" ? { ...d, text: `${d.text} [Interruption.]` } : d));
    const r = report([cand("hansard-19e8c247", Q_BUS)]);
    expect(writeDrafts(r, changed, { root, date: DATE })).toEqual([]);
    expect(r.errors[0]!.message).toMatch(/source text changed/);
    expect(checkDrafts(root).errors).toEqual([]);
  });
});

describe("knownQuotes", () => {
  it("reads every version of every card and every draft's quote", () => {
    const root = tempRoot();
    mkdirSync(join(root, "content/promises"), { recursive: true });
    writeFileSync(
      join(root, "content/promises/uk-test-2026.yaml"),
      "id: uk-test-2026\nversions:\n  - version: 1\n    text: We will do the first thing for everyone.\n  - version: 2\n    text: We will do the second thing for everyone.\n",
    );
    writeFileSync(join(root, "content/promises/broken.yaml"), "versions: [unclosed\n");
    writeDrafts(report([cand("govuk-new-bus-routes", Q_PRESS)]), DOCS, { root, date: DATE });
    expect(knownQuotes(root)).toEqual(["We will do the first thing for everyone.", "We will do the second thing for everyone.", Q_PRESS]);
  });

  it("is empty for a tree with no cards or drafts", () => {
    expect(knownQuotes(tempRoot())).toEqual([]);
  });
});

describe("checkDrafts (pnpm validate)", () => {
  function written(): string {
    const root = tempRoot();
    writeDrafts(report([cand("hansard-19e8c247", Q_BUS), cand("govuk-new-bus-routes", Q_PRESS)]), DOCS, { root, date: DATE });
    return root;
  }
  const draftPath = (root: string) => join(root, DAY, `${DATE}-hansard-19e8c247-1.yaml`);

  it("passes drafts as written, with one warning each", () => {
    const res = checkDrafts(written());
    expect(res.errors).toEqual([]);
    expect(res.drafts).toBe(2);
    expect(res.warnings).toEqual([
      `${DAY}/${DATE}-govuk-new-bus-routes-1.yaml: draft awaiting editors`,
      `${DAY}/${DATE}-hansard-19e8c247-1.yaml: draft awaiting editors`,
    ]);
  });

  it("flags a doctored quote", () => {
    const root = written();
    const path = draftPath(root);
    writeFileSync(path, readFileSync(path, "utf8").replace("£2 from January", "£1 from January"));
    const { errors } = checkDrafts(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/hansard-19e8c247-1\.yaml: quote does not match the source text/);
  });

  it("flags a doctored source text, a shifted span and a missing source", () => {
    const root = written();
    const src = join(root, DAY, "sources/govuk-new-bus-routes.txt");
    writeFileSync(src, PRESS_TEXT.replace("£400 million", "£500 million"));
    const path = draftPath(root);
    writeFileSync(path, readFileSync(path, "utf8").replace(/source_span: \[(\d+), (\d+)\]/, (_, a, b) => `source_span: [${Number(a) + 1}, ${Number(b) + 1}]`));
    expect(checkDrafts(root).errors).toHaveLength(2);
    rmSync(join(root, DAY, "sources/hansard-19e8c247.txt"));
    expect(checkDrafts(root).errors.some((e) => /sources\/hansard-19e8c247\.txt is missing/.test(e))).toBe(true);
  });

  it("flags a draft that fails the schema or sits in the wrong place", () => {
    const root = written();
    const path = draftPath(root);
    writeFileSync(path, readFileSync(path, "utf8").replace("status: to_review", "status: published"));
    mkdirSync(join(root, "content/drafts/2026-10-07"), { recursive: true });
    writeFileSync(join(root, "content/drafts/2026-10-07/moved.yaml"), readFileSync(join(root, DAY, `${DATE}-govuk-new-bus-routes-1.yaml`)));
    const { errors } = checkDrafts(root);
    expect(errors.some((e) => /hansard-19e8c247-1\.yaml: status:/.test(e))).toBe(true);
    expect(errors.some((e) => /moved\.yaml: a draft lives in content\/drafts\/<intake_date>\//.test(e))).toBe(true);
  });

  it("finds nothing when there are no drafts", () => {
    expect(checkDrafts(tempRoot())).toEqual({ errors: [], warnings: [], drafts: 0 });
  });
});

describe("prBody", () => {
  const NOW = new Date("2026-10-07T06:16:00Z");

  it("summarises the day with a table per source, in UK time", () => {
    const root = tempRoot();
    const r = report(
      [
        cand("hansard-19e8c247", Q_BUS),
        cand("govuk-new-bus-routes", Q_PRESS, { speaker: { name: "Alex Minister", role: null, party: null, memberId: null, actorId: null, check: "unverified" } }),
      ],
      {
        dropped: [
          { sourceId: "hansard-19e8c247", reason: "quote not found verbatim in the source", quote: "We shall fight on the beaches." },
          { sourceId: "hansard-19e8c247", reason: "quote not found verbatim in the source", quote: "Another invented line." },
          { sourceId: "govuk-new-bus-routes", reason: "low confidence", quote: "We are proud of our record." },
        ],
        errors: [{ sourceId: "wms-hcws353", message: "HTTP 503 from the written statements API" }],
      },
    );
    writeDrafts(r, DOCS, { root, date: DATE });
    const md = prBody(r, { now: NOW });
    expect(md).toContain("## Intake for Tuesday 6 October 2026");
    expect(md).toContain("**2 candidate promises** from 2 of 2 sources; 3 dropped by the checks; 1 error.");
    expect(md).toContain("Run finished 7 October 2026 at 07:16 BST");
    expect(md).toContain(`| \`${DATE}-hansard-19e8c247-1\` | ✓ Alex Minister, Secretary of State for Transport (Labour) | “We will cap bus fares at £2`);
    expect(md).toContain("| ? Alex Minister |");
    expect(md).toContain("| 0.82 | [open](https://hansard.parliament.uk/Commons/2026-10-06/debates/19E8C247-AAAA-BBBB-CCCC-DDDDEEEEFFFF/Buses#:~:text=We%20will%20cap%20bus%20fares,route%20in%20England%20outside%20London.) |");
    expect(md).toContain("| quote not found verbatim in the source | 2 |\n| low confidence | 1 |");
    expect(md).toContain("- `wms-hcws353`: HTTP 503 from the written statements API");
    expect(md).toContain("1. **Two editors** review this pull request");
    expect(md).toContain("Nothing is published from drafts.");
    expect(md).toContain("never merged automatically");
    expect(prBody(r, { now: new Date("2026-11-07T06:16:00Z") })).toContain("at 06:16 GMT");
  });

  it("escapes | and newlines in table cells, shortens quotes to 160 characters and blocks @mentions", () => {
    const long = `We will | split this cell\nonto a new line and mention @someone, then keep going ${"and going ".repeat(20)}until the end.`;
    const d = doc({ id: "upload-abcdef0123", kind: "upload", text: long });
    const c = { ...cand("hansard-19e8c247", Q_BUS), sourceId: d.id, quote: long, span: [0, long.length] as [number, number] };
    const r: HarvestReport = { date: DATE, sources: [{ id: d.id, kind: "upload", title: "A | title", url: d.url, candidates: 1 }], candidates: [c], dropped: [], errors: [] };
    const md = prBody(r, { now: NOW });
    const row = md.split("\n").find((l) => l.startsWith("| `1` |"))!;
    expect(row).toContain("“We will \\| split this cell onto a new line and mention @​someone, then");
    expect(row).not.toContain("\n");
    // Cells: draft, speaker, quote, confidence, source; only escaped pipes inside them.
    expect(row.split(/(?<!\\)\|/).length).toBe(7);
    const quoteCell = row.split(/(?<!\\)\|/)[3]!.trim();
    expect(Array.from(quoteCell.replace(/\\/g, "").replace(/​/g, "")).length).toBe(160 + 2);
    expect(quoteCell.endsWith("…”")).toBe(true);
    expect(md).toContain("### A \\| title");
  });

  it("says so when there is nothing to review", () => {
    const md = prBody(report([]), { now: NOW });
    expect(md).toContain("**0 candidate promises** from 0 of 2 sources");
    expect(md).toContain("No candidate promises.");
  });
});
