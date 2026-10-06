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

  it("rejects editing a published event", () => {
    const after = card();
    after.events[1]!.text = "Plan published (amended)";
    expect(appendOnlyIssues(card(), after)).toEqual(["events[1] was changed or removed; history is append-only (add a new entry instead)"]);
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
    expect(appendOnlyIssues(card(), after)).toEqual(["versions[0] was changed or removed; history is append-only (add a new entry instead)"]);
  });
});
