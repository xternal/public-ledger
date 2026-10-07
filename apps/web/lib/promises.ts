import type { ActorFile, CardView, PolicyArea, Range, Status } from "@ledger/schema";
import { STATUS_LABEL } from "./copy";
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

/** Who a card counts towards: the speaker's party, or the speaker when it is a party or has none (HM Government). */
export const ownerOf = (c: CardView): ActorFile => c.party ?? c.actor;

/** "Labour" rather than "Labour Party", where space is tight. */
export const shortName = (a: ActorFile) => a.short_name ?? a.name;

/** Who, for lists: "Blair McDougall · Labour", "Conservative Party", "HM Government". The role is on the card page. */
export function whoShort(c: CardView): string {
  if (c.actor.kind === "person" && c.party) return `${c.actor.name} · ${shortName(c.party)}`;
  return c.actor.name;
}

/** The cost cell of a list row: the one-year range in bold, then what it is. */
export function costCell(c: CardView): { amount: string | null; label: string } {
  const p = c.current.parameters;
  const r = p?.how_much_bn_per_year;
  if (r) {
    const { raises, abs } = costSense(r);
    return { amount: rangeText(abs, gbpBn), label: raises ? "raised a year" : "cost a year" };
  }
  return { amount: null, label: p === null ? "Not costable" : "Cost not stated" };
}

const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Every word of the query appears in the card's quote, people, party, role, area, status or venue. */
export function matchesQuery(c: CardView, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(
    [c.current.text, c.actor.name, c.party?.name, c.party?.short_name, c.role, c.file.venue_label, AREA_LABEL[c.file.policy_area], STATUS_LABEL[c.file.status], c.id]
      .filter(Boolean)
      .join(" "),
  );
  return words.every((w) => hay.includes(w));
}

/** Today's date in UK time as YYYY-MM-DD (deadline checks are day-level). */
export const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
