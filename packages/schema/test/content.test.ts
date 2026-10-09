import { describe, expect, it } from "vitest";
import { appendOnlyIssues } from "../src/content";

const card = () => ({
  versions: [{ version: 1, text: "We will do X." }],
  events: [
    { date: "2026-01-01", type: "promised", text: "Said it" },
    { date: "2026-06-01", type: "in_plan", text: "Plan published", evidence_url: "https://example.org/plan" },
  ],
  replies: [],
});

describe("append-only promise history (invariant 5)", () => {
  it("allows appending events, versions and replies", () => {
    const after = card();
    after.events.push({ date: "2026-09-01", type: "funded", text: "Budget line", evidence_url: "https://example.org/budget" } as never);
    after.versions.push({ version: 2, text: "We will do Y." });
    expect(appendOnlyIssues(card(), after)).toEqual([]);
  });

  it("refuses a correction path that would write to Object.prototype", () => {
    const after = card();
    after.events[1]!.text = "Plan published (amended)";
    (after as Record<string, unknown>).corrections = [
      { date: "2026-10-08", path: "events[1].__proto__.polluted", was: null, now: "yes", reason: "test" },
    ];
    expect(() => appendOnlyIssues(card(), after)).toThrow(/unsafe correction path/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects editing a published event", () => {
    const after = card();
    after.events[1]!.text = "Plan published (amended)";
    expect(appendOnlyIssues(card(), after)).toEqual(["events[1] was changed or removed; history is append-only (add a new entry, or record a correction)"]);
  });

  it("rejects removing or reordering entries", () => {
    const removed = card();
    removed.events.splice(0, 1);
    expect(appendOnlyIssues(card(), removed).length).toBeGreaterThan(0);
    const reordered = card();
    reordered.events.reverse();
    expect(appendOnlyIssues(card(), reordered).length).toBe(2);
  });

  it("rejects rewriting a published quote", () => {
    const after = card();
    after.versions[0]!.text = "We will do something else.";
    expect(appendOnlyIssues(card(), after)).toEqual(["versions[0] was changed or removed; history is append-only (add a new entry, or record a correction)"]);
  });

  it("allows a change to history when a new correction records it exactly", () => {
    const after = card() as ReturnType<typeof card> & { corrections?: unknown[] };
    after.events[1]!.date = "2026-06-02";
    after.corrections = [{ date: "2026-10-07", path: "events[1].date", was: "2026-06-01", now: "2026-06-02", reason: "The plan was published a day later." }];
    expect(appendOnlyIssues(card(), after)).toEqual([]);
  });

  it("rejects a change that goes beyond what the correction records", () => {
    const after = card() as ReturnType<typeof card> & { corrections?: unknown[] };
    after.events[1]!.date = "2026-06-02";
    after.events[1]!.text = "Plan published (amended)";
    after.corrections = [{ date: "2026-10-07", path: "events[1].date", was: "2026-06-01", now: "2026-06-02", reason: "Date." }];
    expect(appendOnlyIssues(card(), after)).toEqual(["events[1] changed in ways its corrections do not record"]);
  });

  it("records a field that was added (was: null) and keeps existing corrections append-only", () => {
    const before = { ...card(), corrections: [{ date: "2026-10-07", path: "events[1].text", was: "Plan", now: "Plan published", reason: "x" }] };
    const after = structuredClone(before) as typeof before & { events: Record<string, unknown>[] };
    (after.events[0] as Record<string, unknown>).evidence_url = "https://example.org/said";
    after.corrections.push({ date: "2026-10-08", path: "events[0].evidence_url", was: null as never, now: "https://example.org/said", reason: "Link added." });
    expect(appendOnlyIssues(before, after)).toEqual([]);
    const tampered = structuredClone(after);
    tampered.corrections[0]!.reason = "changed";
    expect(appendOnlyIssues(before, tampered)).toEqual(["corrections[0] was changed or removed; corrections are append-only too"]);
  });

  it("lets a field added to the standard later (costed_by) be filled in once, then treats it as history", () => {
    const costed = () => ({ ...card(), versions: [{ version: 1, text: "We will do X.", parameters: { how_much_bn_per_year: [0.9, 1, 1.1] } }] });
    const filled = costed() as ReturnType<typeof costed> & { versions: { parameters: Record<string, unknown> }[] };
    filled.versions[0]!.parameters.costed_by = { kind: "official", name: "OBR" };
    expect(appendOnlyIssues(costed(), filled)).toEqual([]);
    // Filling it in does not open the rest of the entry: the cost itself still needs a correction.
    const sneaky = structuredClone(filled);
    sneaky.versions[0]!.parameters.how_much_bn_per_year = [1.8, 2, 2.2];
    expect(appendOnlyIssues(costed(), sneaky)).toEqual(["versions[0] was changed or removed; history is append-only (add a new entry, or record a correction)"]);
    // Once published, changing who made the figure is a correction like any other.
    const changed = structuredClone(filled);
    changed.versions[0]!.parameters.costed_by = { kind: "party", name: "Labour Party" };
    expect(appendOnlyIssues(filled, changed)).toEqual(["versions[0] was changed or removed; history is append-only (add a new entry, or record a correction)"]);
    const corrected = { ...structuredClone(changed), corrections: [{ date: "2026-10-09", path: "versions[0].parameters.costed_by", was: { kind: "official", name: "OBR" }, now: { kind: "party", name: "Labour Party" }, reason: "The figure is the party's." }] };
    expect(appendOnlyIssues(filled, corrected)).toEqual([]);
  });

  it("keeps reviews append-only: a new review is added, an old one never edited", () => {
    const review = { by: "Junior Editor", kind: "automated", on: "2026-10-06" };
    const before = { ...card(), reviews: [review] };
    const added = { ...card(), reviews: [review, { by: "A. Editor", kind: "editor", on: "2026-10-20" }] };
    expect(appendOnlyIssues(before, added)).toEqual([]);
    const edited = { ...card(), reviews: [{ ...review, on: "2026-10-07" }] };
    expect(appendOnlyIssues(before, edited)).toEqual(["reviews[0] was changed or removed; reviews are append-only (add a new review instead)"]);
  });
});
