import type { PromiseFile, Review } from "@ledger/schema";

/** The card's latest review, if any. */
export const latestReview = (f: PromiseFile): Review | null => f.reviews.at(-1) ?? null;

/** "Junior Editor (automated)", "Jane Smith (editor)", for the card. */
export const reviewerLabel = (r: Review) => `${r.by} (${r.kind === "automated" ? "automated" : r.kind === "legal" ? "legal review" : "editor"})`;

/** What Junior Editor is, in one line, wherever its name appears. */
export const JUNIOR_EDITOR_NOTE =
  "Junior Editor is our automated reviewer: it re-reads every card against its live sources (the quote word for word, dates, evidence, status, cost, neutral wording, legal risk). Human editors review next.";
