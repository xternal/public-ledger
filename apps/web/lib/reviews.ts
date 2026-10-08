import type { PromiseFile, Review } from "@ledger/schema";

/** The card's latest review, if any. */
export const latestReview = (f: PromiseFile): Review | null => f.reviews.at(-1) ?? null;

/** Our automated reviewer. It was called "Junior Editor" until 8 Oct 2026. */
export const AI_JOURNALIST = "AI Journalist";

/**
 * Reviews are append-only, so stored ones keep the name they were given;
 * readers see the reviewer's current name.
 */
const RENAMED: Record<string, string> = { "Junior Editor": AI_JOURNALIST };
export const reviewerName = (by: string) => RENAMED[by] ?? by;

/** "AI Journalist (automated)", "Jane Smith (editor)", for the card. */
export const reviewerLabel = (r: Review) => `${reviewerName(r.by)} (${r.kind === "automated" ? "automated" : r.kind === "legal" ? "legal review" : "editor"})`;

/** What AI Journalist is, in one line, wherever its name appears. */
export const AI_JOURNALIST_NOTE =
  "AI Journalist is our automated reviewer: it re-reads every card against its live sources (the quote word for word, dates, evidence, status, cost, neutral wording, legal risk). Human editors review next.";
