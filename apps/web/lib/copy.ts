import type { ControlledBy, EventType, LeverGroup, Quality, Status } from "@ledger/schema";

/** Plain-English labels. Internal names stay in data; readers see these. */

export const QUALITY_LABEL: Record<Quality | "plug", string> = {
  sourced: "Sourced",
  approx: "Estimate",
  modelled: "Modelled",
  training: "To check",
  plug: "Balancing figure",
};

export const QUALITY_HELP: Record<Quality | "plug", string> = {
  sourced: "Taken from an official release, linked.",
  approx: "Derived or scaled from official figures; the method is shown.",
  modelled: "Produced by our model, shown as a range.",
  training: "A working figure not yet checked against an official source or by an economist. Please don't quote it yet.",
  plug: "A residual that makes the statement balance. It must be broken down before launch.",
};

export const CONTROLLED_BY_LABEL: Record<ControlledBy, string> = {
  government: "Set by the government",
  central_bank: "Set by the Bank of England",
  demography: "Driven by population change",
  external: "Outside UK control",
};

export const GROUP_LABEL: Record<LeverGroup, string> = {
  rates: "Interest rates, not set by ministers",
  taxes: "Taxes",
  spending: "Spending",
  measures: "Announced measures",
};

export const GROUP_ORDER: LeverGroup[] = ["taxes", "spending", "rates", "measures"];

/** Under a stepped lever (capital gains tax): why there is no slider. */
export const STEPPED_LEVER_NOTE = "Official estimates exist only for these steps.";

export const STATUS_LABEL: Record<Status, string> = {
  promised: "Promised",
  in_plan: "In plan",
  legislated: "Legislated",
  funded: "Funded",
  delivering: "Delivering",
  delivered: "Delivered",
  failed: "Not met",
  quietly_dropped: "Undone",
  unscoreable: "Unscoreable",
};

export const EVENT_LABEL: Record<EventType | "today", string> = {
  promised: "Promised",
  reworded: "Reworded",
  in_plan: "In plan",
  legislated: "Legislated",
  funded: "Funded",
  delivering: "Delivering",
  delivered: "Delivered",
  failed: "Not met",
  deadline: "Deadline",
  deadline_missed: "Deadline passed",
  reply: "Reply",
  today: "Today",
};

export const EVIDENCE_OPTIONS = [
  { id: "reworded", label: "It was reworded" },
  { id: "in_plan", label: "A plan or bill names it" },
  { id: "funded", label: "It was funded in a Budget or Estimates" },
  { id: "delivering", label: "It started" },
  { id: "delivered", label: "It was delivered" },
  { id: "failed", label: "It was not met, or was abandoned" },
] as const;

/**
 * Method notes are written for editors ("TODO(source): …", "(review B1)").
 * Readers see the same note without the internal markers.
 */
export const readerNote = (note: string) =>
  note
    .replace(/TODO\(source\):\s*/g, "")
    .replace(/\s*\((?:review|see review)[^)]*\)/gi, "")
    .replace(/^./, (c) => c.toUpperCase());
