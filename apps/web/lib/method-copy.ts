import type { BacktestSummary, ForecastMaker } from "@ledger/schema";
import { fixed, gbpBn, grouped, longDate, monthYear } from "./format";

/**
 * Words for /method, /method/backtest and /method/api. Plain British English,
 * numbers first; every figure in a sentence comes from the data passed in.
 */

export const METHOD_TITLE = "How the numbers are made";
export const METHOD_DESCRIPTION =
  "Where every number on Public Ledger comes from: the official sources and their editions, the quality labels, why model results are ranges, who checks the promise cards, and a changelog of every data edition.";

export const BACKTEST_TITLE = "Forecasts against what happened";
export const BACKTEST_DESCRIPTION =
  "Every forecast Public Ledger shows is recorded on the day it is shown and checked when the official outturn arrives: how often the outturn landed inside the range, and every miss, above or below.";

export const API_TITLE = "Open data API";
export const API_DESCRIPTION =
  "Public Ledger's data as JSON or CSV, free and with no key: the statement for every year, every promise card, actors, forecasts and how they scored, contracts and data editions. Every number carries its source, edition and quality.";

/** The three method pages, for the sub-menu. */
export const METHOD_PAGES = [
  { href: "/method", label: "How the numbers are made" },
  { href: "/method/backtest", label: "Forecasts against outturn" },
  { href: "/method/api", label: "Open data API" },
] as const;

export const MAKER_LABEL: Record<ForecastMaker, string> = {
  public_ledger: "Public Ledger",
  obr: "OBR",
  ons: "ONS",
};

export const MAKER_LONG: Record<ForecastMaker, string> = {
  public_ledger: "Public Ledger (our own)",
  obr: "Office for Budget Responsibility",
  ons: "Office for National Statistics",
};

export const RESULT_LABEL = {
  hit: "Inside the range",
  miss_above: "Higher than forecast",
  miss_below: "Lower than forecast",
} as const;

/** A forecast or outturn value in its unit: "£115.5bn", "94.8% of GDP", "653,015 people". */
export function inUnit(x: number, unit: string): string {
  if (unit === "gbp_bn") return gbpBn(x);
  if (unit === "pct_gdp") return `${fixed(x, 1)}% of GDP`;
  if (unit === "persons_k") return `${grouped(x * 1000)}`;
  return `${fixed(x, 1)} ${unit}`;
}

/** The size of a miss in the forecast's unit, never signed: "£1.6bn", "1.0 points of GDP", "12,545 people". */
export function missSize(x: number, unit: string): string {
  if (unit === "gbp_bn") return gbpBn(Math.abs(x));
  if (unit === "pct_gdp") return `${fixed(Math.abs(x), 1)} points of GDP`;
  if (unit === "persons_k") return `${grouped(Math.abs(x) * 1000)} people`;
  return `${fixed(Math.abs(x), 1)} ${unit}`;
}

/** "2026-27" stays; "2026" (ONS years to 30 June) reads "year to mid-2026". */
export const periodLabel = (p: string) => (/^\d{4}$/.test(p) ? `year to mid-${p}` : p);

/** "2027-04" → "Apr 2027" */
export const dueMonth = (m: string) => monthYear(`${m}-01`);

export const pctText = (x: number | null) => (x === null ? "" : `${fixed(Math.abs(x), 1)}%`);

/** The lead sentence for the backtest page: the one thing most readers want first. */
export function backtestLead(shown: BacktestSummary, firstRecorded: string | null): string {
  if (shown.ranged.scored) {
    const pct = Math.round((shown.hit_rate ?? 0) * 100);
    return `${shown.ranged.hit} of ${shown.ranged.scored} ranged forecasts this site has shown landed inside their range (${pct}%).`;
  }
  const since = firstRecorded ? ` since ${longDate(firstRecorded)}` : "";
  const due = shown.next_due ? ` The first outturn is due in ${dueMonth(shown.next_due.month)}.` : "";
  return `${grouped(shown.recorded)} forecasts recorded${since}. None can be checked yet: their years have not ended, or the official figures are not out.${due}`;
}

export function backtestFaq(s: { shown: BacktestSummary; context: BacktestSummary }): { q: string; a: string }[] {
  return [
    {
      q: "Does Public Ledger make forecasts?",
      a: "Mostly it shows other people's: the OBR's forecasts of the public finances and the ONS's population projections. Our own are few and simple, such as splitting the OBR's total spending by function in years with no published split. Sandbox results and promise costs are what-ifs, not forecasts.",
    },
    {
      q: "What counts as a hit?",
      a: "A forecast with a range hits when the official outturn lands inside it, edges included. Otherwise it misses above or below, and the size of the miss is measured from the nearer edge of the range.",
    },
    {
      q: "Why are the OBR's forecasts never hits?",
      a: "The OBR publishes single numbers in the tables we use, so they can only hit by matching exactly. We do not make up a range for them; instead we show how far off each one was. The hit rate counts forecasts with a range only.",
    },
    {
      q: "Why are promise costs not checked?",
      a: "A cost on a promise card is a costing of a policy, not a forecast of an official figure. No outturn measures what a single promise cost, so there is nothing fair to score it against yet.",
    },
    {
      q: "Can a score change?",
      a: "Yes. Official outturn is revised, so every score is worked out again when a new release comes in, and the table names the release it used. The forecasts themselves never change once recorded.",
    },
    {
      q: "How many forecasts are waiting?",
      a: `${grouped(s.shown.waiting + s.context.waiting)} are waiting for their outturn.${s.shown.next_due ? ` The next are due in ${dueMonth(s.shown.next_due.month)}.` : ""}`,
    },
  ];
}
