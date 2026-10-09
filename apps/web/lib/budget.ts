import type { CardView } from "@ledger/schema";
import { TERMINAL, standingOf } from "@/lib/promises";

/**
 * The next (or latest) Budget, with the source that gives its date. Change
 * this when the next one is announced; /budget follows it.
 */
export const BUDGET = {
  name: "Autumn Budget 2026",
  date: "2026-10-28",
  source: {
    title: "House of Commons Library: Budget 2026 representations, reading list (8 Oct 2026)",
    url: "https://commonslibrary.parliament.uk/research-briefings/cbp-12226/",
  },
} as const;

/** "28 October": the Budget's day and month, for links that already name the year. */
export const budgetDay = () => new Date(`${BUDGET.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" });

/** The link to /budget from other pages: what to watch before the day, what it did from the day. */
export const budgetLinkText = (today: string | null) =>
  today && today >= BUDGET.date ? `${BUDGET.name}: what it did to the promises` : `${BUDGET.name} on ${budgetDay()}: the promises it could fund or break`;

/** Statuses a Budget can still move a promise out of: money, a plan or a law can come; delivery has not started. */
const BEFORE_MONEY = new Set(["promised", "in_plan", "legislated"]);

const costCentral = (c: CardView) => c.current.parameters?.how_much_bn_per_year?.[1] ?? null;
const byCostThenDeadline = (a: CardView, b: CardView) =>
  (Math.abs(costCentral(b) ?? 0) - Math.abs(costCentral(a) ?? 0)) || (a.file.deadline ?? "9999").localeCompare(b.file.deadline ?? "9999");

export interface BudgetWatch {
  /** Government promises with a stated cost that are not yet funded. */
  needMoney: CardView[];
  /** Open government promises about tax, which a Budget keeps or breaks. */
  tax: CardView[];
  /** Every other open government promise the Budget could move. */
  other: CardView[];
  /** Opposition promises with a stated cost, for comparison: the Budget cannot fund them. */
  opposition: CardView[];
  /** Cards with an event dated on Budget day: what the Budget did. */
  moved: CardView[];
}

/**
 * Sorts the cards for /budget. Government means the cards' owner is in
 * government (a factual label on the actor, the same rule for every party);
 * only the government sets a Budget.
 */
export function budgetWatch(cards: CardView[]): BudgetWatch {
  const open = (c: CardView) => BEFORE_MONEY.has(c.file.status);
  const gov = cards.filter((c) => standingOf(c) === "government" && open(c));
  const costed = (c: CardView) => costCentral(c) !== null;
  const needMoney = gov.filter((c) => costed(c) && c.file.policy_area !== "taxes").sort(byCostThenDeadline);
  const tax = gov.filter((c) => c.file.policy_area === "taxes").sort(byCostThenDeadline);
  const other = gov.filter((c) => !needMoney.includes(c) && !tax.includes(c)).sort(byCostThenDeadline);
  const opposition = cards.filter((c) => standingOf(c) === "opposition" && !TERMINAL.includes(c.file.status) && costed(c)).sort(byCostThenDeadline);
  const moved = cards.filter((c) => c.file.events.some((e) => e.date === BUDGET.date && e.type !== "deadline_missed"));
  return { needMoney, tax, other, opposition, moved };
}

/**
 * Questions readers bring to this Budget. A topic lists every card whose
 * headline, words or status note name its subject: the same rule for every
 * party. The intro is framing only; every figure stays on the cards, with its
 * source.
 */
export const BUDGET_TOPICS = [
  {
    id: "capital-gains-tax",
    title: "Capital gains tax",
    match: /capital gains/i,
    intro:
      "Ministers have been asked in Parliament whether capital gains tax will rise to match income tax. The Treasury's answer is that decisions on tax are taken by the Chancellor at the Budget. HMRC's own estimates show that large rises can lose money rather than raise it, because people sell fewer assets. These are the promises parties have made on it, with what each would cost or raise.",
    sources: [
      { title: "Treasury answer to HL2381 (30 Jul 2026)", url: "https://questions-statements.parliament.uk/written-questions/detail/2026-07-21/HL2381" },
      {
        title: "HMRC: Direct effects of illustrative tax changes",
        url: "https://www.gov.uk/government/statistics/direct-effects-of-illustrative-tax-changes/direct-effects-of-illustrative-tax-changes-bulletin-january-2025",
      },
    ],
  },
] as const;

export type BudgetTopic = (typeof BUDGET_TOPICS)[number];

/** The cards on a topic: the government's first, as only it sets a Budget, then the largest cost first. */
export function topicCards(cards: CardView[], topic: BudgetTopic): CardView[] {
  const names = (c: CardView) =>
    [c.file.headline ?? "", c.file.status_note ?? "", ...c.file.versions.map((v) => v.text)].some((t) => topic.match.test(t));
  const gov = (c: CardView) => (standingOf(c) === "government" ? 0 : 1);
  return cards.filter(names).sort((a, b) => gov(a) - gov(b) || byCostThenDeadline(a, b));
}

/** The events on Budget day for one card, for the "What the Budget did" list. */
export const budgetDayEvents = (c: CardView) => c.file.events.filter((e) => e.date === BUDGET.date && e.type !== "deadline_missed");
