import { describe, expect, it } from "vitest";
import {
  DEADLINE_WINDOWS,
  alertWindows,
  dueInWindow,
  isDeadlineWindow,
  isDueIn,
  monthKey,
  ukDay,
  widestWindow,
  windowPhrase,
  windowRange,
  windowWords,
} from "../src/deadlines";

describe("UK day", () => {
  it("uses UK time, not UTC, on both sides of the clocks changing", () => {
    // 23:30 UTC on 30 September is 00:30 BST on 1 October.
    expect(ukDay(new Date("2026-09-30T23:30:00Z"))).toBe("2026-10-01");
    // After the clocks go back (25 October 2026), 23:30 UTC is 23:30 GMT: still 31 October.
    expect(ukDay(new Date("2026-10-31T23:30:00Z"))).toBe("2026-10-31");
    expect(ukDay(new Date("2026-11-01T00:30:00Z"))).toBe("2026-11-01");
    // Clocks go forward on 28 March 2027: 23:30 UTC on 31 March is 00:30 BST on 1 April.
    expect(ukDay(new Date("2027-03-31T23:30:00Z"))).toBe("2027-04-01");
    // New Year in GMT.
    expect(ukDay(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
  });
});

describe("deadline windows", () => {
  it("are whole calendar months from the 1st of this month", () => {
    expect(windowRange("this-month", "2026-10-08")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(windowRange("next-3-months", "2026-10-08")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(windowRange("next-12-months", "2026-10-08")).toEqual({ from: "2026-10-01", to: "2027-09-30" });
  });

  it("handle month lengths, leap years and the turn of the year", () => {
    expect(windowRange("this-month", "2027-02-14")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(windowRange("this-month", "2028-02-29")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(windowRange("next-3-months", "2026-11-30")).toEqual({ from: "2026-11-01", to: "2027-01-31" });
    expect(windowRange("next-3-months", "2026-12-31")).toEqual({ from: "2026-12-01", to: "2027-02-28" });
    expect(windowRange("next-12-months", "2027-01-01")).toEqual({ from: "2027-01-01", to: "2027-12-31" });
  });

  it("include both edge days, and nothing without a deadline", () => {
    expect(isDueIn("2026-10-01", "this-month", "2026-10-31")).toBe(true);
    expect(isDueIn("2026-10-31", "this-month", "2026-10-01")).toBe(true);
    expect(isDueIn("2026-09-30", "this-month", "2026-10-01")).toBe(false);
    expect(isDueIn("2026-11-01", "this-month", "2026-10-31")).toBe(false);
    expect(isDueIn("2026-12-31", "next-3-months", "2026-10-31")).toBe(true);
    expect(isDueIn("2027-01-01", "next-3-months", "2026-10-31")).toBe(false);
    expect(isDueIn(undefined, "next-12-months", "2026-10-08")).toBe(false);
    expect(isDueIn("2027", "next-12-months", "2026-10-08")).toBe(false);
  });

  it("move on at UK midnight on the 1st, not UTC midnight", () => {
    // 23:30 UTC on 30 September 2026 is already October in the UK (BST).
    const october = ukDay(new Date("2026-09-30T23:30:00Z"));
    expect(isDueIn("2026-10-15", "this-month", october)).toBe(true);
    expect(isDueIn("2026-09-15", "this-month", october)).toBe(false);
  });

  it("are said in words with their months", () => {
    expect(windowWords("this-month", "2026-10-08")).toBe("October 2026");
    expect(windowWords("next-3-months", "2026-10-08")).toBe("October to December 2026");
    expect(windowWords("next-3-months", "2026-12-01")).toBe("December 2026 to February 2027");
    expect(windowWords("next-12-months", "2026-10-08")).toBe("October 2026 to September 2027");
    expect(windowPhrase("this-month", "2026-10-08")).toBe("in October 2026");
    expect(windowPhrase("next-3-months", "2026-10-08")).toBe("between October and December 2026");
    expect(windowPhrase("next-12-months", "2026-10-08")).toBe("between October 2026 and September 2027");
    expect(monthKey("2026-10-08")).toBe("2026-10");
  });

  it("list open promises due, nearest first, leaving finished ones out", () => {
    const cards = [
      { id: "b", deadline: "2026-12-24", status: "promised" },
      { id: "a", deadline: "2026-12-24", status: "in_plan" },
      { id: "c", deadline: "2026-10-01", status: "delivered" },
      { id: "d", deadline: "2026-10-05", status: "funded" },
      { id: "e", deadline: "2027-04-01", status: "promised" },
      { id: "f", status: "promised" },
      { id: "g", deadline: "2026-11-02", status: "quietly_dropped" },
    ];
    expect(dueInWindow(cards, "this-month", "2026-10-08").map((c) => c.id)).toEqual(["d"]);
    expect(dueInWindow(cards, "next-3-months", "2026-10-08").map((c) => c.id)).toEqual(["d", "a", "b"]);
    expect(dueInWindow(cards, "next-12-months", "2026-10-08").map((c) => c.id)).toEqual(["d", "a", "b", "e"]);
  });

  it("alert on outcomes in the window or the month before, so a deadline at a month's end still reaches its followers", () => {
    // Due 31 October, recorded as missed on 1 November: every window still hears it.
    expect(alertWindows("2026-10-31", "2026-11-01")).toEqual(["this-month", "next-3-months", "next-12-months"]);
    // Delivered early: only the windows the deadline falls in.
    expect(alertWindows("2026-12-24", "2026-10-08")).toEqual(["next-3-months", "next-12-months"]);
    expect(alertWindows("2027-09-30", "2026-10-08")).toEqual(["next-12-months"]);
    expect(alertWindows("2027-10-01", "2026-10-08")).toEqual([]);
    // Older than the grace month: no deadline-window alert for a long-past deadline.
    expect(alertWindows("2026-08-31", "2026-10-08")).toEqual([]);
    expect(alertWindows("2026-09-01", "2026-10-08")).toEqual(DEADLINE_WINDOWS);
    // The grace month crosses the turn of the year.
    expect(alertWindows("2026-12-31", "2027-01-02")).toEqual(DEADLINE_WINDOWS);
    expect(alertWindows(undefined, "2026-10-08")).toEqual([]);
  });

  it("validates ids and picks the widest of several", () => {
    expect(isDeadlineWindow("next-3-months")).toBe(true);
    expect(isDeadlineWindow("next-2-months")).toBe(false);
    expect(widestWindow(["this-month", "next-3-months"])).toBe("next-3-months");
    expect(widestWindow([])).toBeNull();
  });
});
