import type { PeopleBundle, Range, Variant, VariantChart } from "@ledger/schema";

/**
 * /people view logic, shared by the server page (headline numbers, structured data)
 * and the client explorer (assumption choices in the URL). Pure: every number comes
 * from data/build/people.json; nothing here projects anything.
 */

export type AssumptionId = "fertility" | "migration" | "life_expectancy";
export const ASSUMPTION_IDS: AssumptionId[] = ["fertility", "migration", "life_expectancy"];
export type Choice = Record<AssumptionId, string>;

export const PRINCIPAL: Choice = { fertility: "principal", migration: "principal", life_expectancy: "principal" };
export const BASELINE = "baseline";
/** The URL parameter for the OBR scenario; the assumptions use their own ids (?fertility=low). */
export const SPENDING_PARAM = "spending";

/** The published variant for a mix of assumptions, or undefined when ONS does not publish that mix. */
export function variantFor(variants: Variant[], c: Choice): Variant | undefined {
  return variants.find((v) => v.fertility === c.fertility && v.migration === c.migration && v.life_expectancy === c.life_expectancy);
}

export const choiceOf = (v: Variant): Choice => ({ fertility: v.fertility, migration: v.migration, life_expectancy: v.life_expectancy });

/** Variants that change more than one assumption at once (high population, old age structure, ...). */
export function combinations(variants: Variant[]): Variant[] {
  return variants.filter((v) => ASSUMPTION_IDS.filter((id) => choiceOf(v)[id] !== "principal").length > 1);
}

/** Read the choice from a query string, keeping only values that name a published option. */
export function readChoice(q: URLSearchParams, people: PeopleBundle): { choice: Choice; spending: string } {
  const choice = { ...PRINCIPAL };
  for (const a of people.assumptions) {
    const id = a.id as AssumptionId;
    if (!ASSUMPTION_IDS.includes(id)) continue;
    const v = q.get(id);
    if (v && a.options.some((o) => o.value === v)) choice[id] = v;
  }
  const s = q.get(SPENDING_PARAM);
  return { choice, spending: s && people.spending.scenarios.some((x) => x.id === s) ? s : BASELINE };
}

/** Write the choice into a URL, leaving defaults out so the plain page URL stays canonical. */
export function writeChoice(url: URL, choice: Choice, spending: string): URL {
  for (const id of ASSUMPTION_IDS) {
    if (choice[id] === "principal") url.searchParams.delete(id);
    else url.searchParams.set(id, choice[id]);
  }
  if (spending === BASELINE) url.searchParams.delete(SPENDING_PARAM);
  else url.searchParams.set(SPENDING_PARAM, spending);
  return url;
}

const last = <T,>(xs: T[]) => xs[xs.length - 1]!;

/** Start and end of the principal projection, and the range across variants at the end. */
export function span(c: VariantChart) {
  const ppp = c.variants.ppp!;
  return { firstYear: c.years[0]!, lastYear: last(c.years), first: ppp[0]!, last: last(ppp), range: last(c.range) as Range };
}

/** The first projected year in which the principal projection has more deaths than births, if any. */
export function deathsOvertake(p: PeopleBundle): number | undefined {
  const b = p.charts.births;
  const d = p.charts.deaths;
  return b.years.find((y, i) => {
    const j = d.years.indexOf(y);
    return j >= 0 && d.variants.ppp![j]! > b.variants.ppp![i]!;
  });
}

export function spendingSpan(p: PeopleBundle) {
  const s = p.spending;
  const base = s.scenarios[0]!;
  return { firstYear: s.years[0]!, lastYear: last(s.years), first: base.values[0]!, last: last(base.values), range: last(s.range) as Range };
}

// ------------------------------------------------------------------ formats

const oneDp = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

/** People over pension age per 100 of working age. */
export const per100 = (x: number) => oneDp.format(x);
/** People of working age per person over pension age. */
export const ratio = (x: number) => oneDp.format(x);
/** Thousands of people, rounded to the nearest thousand: 651.9 -> "652,000". */
export const people = (thousands: number) => whole.format(Math.round(thousands) * 1000);
/** Per cent of GDP. */
export const pctGdp = (x: number) => `${oneDp.format(x)}%`;
/** Fiscal year "2075-76" to the year it starts, for a linear time axis. */
export const fyStart = (fy: string) => Number(fy.slice(0, 4));
