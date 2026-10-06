import type { CardView, PolicyArea, Range, Status } from "@ledger/schema";
import { gbpBn, rangeText } from "./format";

/** Shared, server-safe helpers for promise cards. */

export const TERMINAL: Status[] = ["delivered", "failed", "quietly_dropped", "unscoreable"];

export const isOverdue = (c: CardView, today: string | null) =>
  !!today && !!c.file.deadline && c.file.deadline < today && !TERMINAL.includes(c.file.status);

/**
 * Cards store cost to the public purse: positive costs money, negative raises
 * it (a wealth tax). Readers see "Costs £0.5bn" or "Raises £15bn", never a
 * negative cost.
 */
export function costSense(r: Range): { raises: boolean; abs: Range } {
  const raises = r[1] < 0;
  const abs = r.map(Math.abs).sort((a, b) => a - b) as Range;
  return { raises, abs: [abs[0], Math.abs(r[1]), abs[2]] };
}

export function costText(c: CardView): string {
  const p = c.current.parameters;
  const r = p?.how_much_bn_per_year;
  if (r) {
    const { raises, abs } = costSense(r);
    return `${raises ? "Raises" : "Costs"} ${rangeText(abs, gbpBn)} a year`;
  }
  if (p === null) return "Not costable";
  return "Cost not stated";
}

export const AREA_LABEL: Record<PolicyArea, string> = {
  taxes: "Taxes",
  social_protection: "Social protection",
  health: "Health",
  education: "Education",
  economic_affairs: "Transport & economy",
  defence: "Defence",
  public_order: "Police, courts, prisons",
  general_services: "Running government",
  housing_env: "Housing & environment",
  culture: "Culture & sport",
};

/** Ladder position for sorting: delivered last among live, then off-ladder states. */
export const STATUS_ORDER: Status[] = ["promised", "in_plan", "legislated", "funded", "delivering", "delivered", "failed", "quietly_dropped", "unscoreable"];

/** Actor line for a card: "Labour Party, 2024 manifesto" or "Andy Burnham, Prime Minister". */
export function whoLine(c: CardView): string {
  if (c.actor.kind === "party") return [c.actor.name, c.file.venue_label].filter(Boolean).join(", ");
  return [c.actor.name, c.role].filter(Boolean).join(", ");
}

/** Today's date in UK time as YYYY-MM-DD (deadline checks are day-level). */
export const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
