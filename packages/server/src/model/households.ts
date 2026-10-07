import { z } from "zod";
import { ARCHETYPES, type ArchetypeId } from "@ledger/schema";
import seed from "../../../../data/seed/archetype_spending.json";
import type { T1Household } from "./provider";
import { TransformError } from "./transform";

/**
 * "People like me" (invariant 7): fixed example households, the same for every
 * reader, computed on the server. Nothing about a reader is ever sent.
 *
 * Inputs, kept deliberately plain so the numbers are easy to check by hand:
 * - England (East Midlands), adults of working age, children of school age;
 * - earnings are employment income; no rent, mortgage, council tax, childcare
 *   or pension contributions;
 * - benefits are claimed where due (PolicyEngine's default), so the lone
 *   parent receives Universal Credit and both families Child Benefit;
 * - the pensioners each get the full new State Pension for the year, as a
 *   reported amount: PolicyEngine UK takes State Pension from what a pensioner
 *   reports, so without it their pension would be zero;
 * - spending is ONS's average for the closest household type (Family spending
 *   in the UK, data/seed/archetype_spending.json, which records the table, row
 *   and quality of every value): the twelve COICOP groups VAT falls on, and the
 *   petrol and diesel fuel duty falls on. Held at the edition's cash level for
 *   every year, like the earnings.
 *
 * How PolicyEngine UK (2.102) taxes that spending, checked 7 Oct 2026:
 * - VAT: the standard rate on half of spending (its default
 *   full_rate_vat_expenditure_rate) and the reduced rate on 2.5%, divided by
 *   0.38 (gov.simulation.microdata_vat_coverage) so survey spending adds up to
 *   national VAT receipts. A 1-point rise therefore costs a household spending
 *   £C a year C × 0.5 × 0.01 / 0.38, about 1.3% of C.
 * - Net income takes off only a change in VAT (vat_change), but all fuel duty
 *   paid: litres (spending ÷ PolicyEngine's pump price) × the duty rate. So the
 *   current-law net incomes are lower by each household's fuel duty and no more.
 */
export type Situation = {
  people: Record<string, Record<string, Record<string, number | string | null>>>;
  benunits: Record<string, { members: string[] }>;
  households: Record<string, { members: string[] } & Record<string, Record<string, number | string | null> | string[]>>;
};

export const ARCHETYPE_REGION = "EAST_MIDLANDS";

interface Person {
  age: number;
  employment_income?: number;
  pensioner?: true;
}

const PEOPLE: Record<ArchetypeId, Person[]> = {
  single_25k: [{ age: 40, employment_income: 25_000 }],
  single_45k: [{ age: 40, employment_income: 45_000 }],
  single_120k: [{ age: 40, employment_income: 120_000 }],
  couple_two_children: [{ age: 40, employment_income: 35_000 }, { age: 38, employment_income: 15_000 }, { age: 9 }, { age: 6 }],
  lone_parent: [{ age: 32, employment_income: 18_000 }, { age: 5 }],
  pensioner_couple: [
    { age: 72, pensioner: true },
    { age: 70, pensioner: true },
  ],
};

/**
 * Full new State Pension, £ a week, from PolicyEngine UK's parameter
 * gov.dwp.state_pension.new_state_pension.amount (metadata of model 2.102.3,
 * read 7 Oct 2026). Dated values; the archetype uses the one in force at the
 * start of the fiscal year (6 April).
 */
export const NEW_STATE_PENSION_WEEKLY: Record<string, number> = {
  "2023-01-01": 203.85,
  "2024-01-01": 221.2,
  "2025-04-01": 230.25,
  "2026-04-01": 241.3,
  "2027-01-01": 249.50404447309054,
  "2028-01-01": 255.74178444822982,
  "2029-01-01": 262.1350513328116,
  "2030-01-01": 268.6875481484891,
};

export function fullNewStatePension(startYear: number): number {
  const on = `${startYear}-04-06`;
  const dates = Object.keys(NEW_STATE_PENSION_WEEKLY)
    .filter((d) => d <= on)
    .sort();
  const latest = dates.at(-1);
  if (!latest) throw new Error(`no State Pension rate for ${startYear}`);
  return Math.round(NEW_STATE_PENSION_WEEKLY[latest]! * 52 * 100) / 100;
}

/** PolicyEngine UK's household spending inputs (£ a year): the twelve COICOP groups VAT falls on, then the motor fuel fuel duty falls on. */
export const SPENDING_VARIABLES = [
  "food_and_non_alcoholic_beverages_consumption",
  "alcohol_and_tobacco_consumption",
  "clothing_and_footwear_consumption",
  "housing_water_and_electricity_consumption",
  "household_furnishings_consumption",
  "health_consumption",
  "transport_consumption",
  "communication_consumption",
  "recreation_consumption",
  "education_consumption",
  "restaurants_and_hotels_consumption",
  "miscellaneous_consumption",
  "petrol_spending",
  "diesel_spending",
] as const;
export type SpendingVariable = (typeof SPENDING_VARIABLES)[number];

const ArchetypeSpending = z.object({
  row: z.object({ source: z.string(), table: z.string(), title: z.string(), column: z.string(), years: z.string() }),
  gross_income_week: z.number().positive(),
  income: z.string(),
  income_decile: z.number().int().min(1).max(10),
  /** ONS's published total of groups 1 to 12 for the row: the twelve inputs add up to it. */
  total_1_12_week: z.number().positive(),
  weekly: z.record(
    z.enum(SPENDING_VARIABLES),
    z.object({ gbp: z.number().min(0), quality: z.enum(["sourced", "approx"]), note: z.string().optional() }),
  ),
});

/** The spending seed, checked when the module loads: every archetype has every input, with its quality. */
export const ARCHETYPE_SPENDING = z
  .object({
    meta: z.object({ edition: z.string(), published_on: z.iso.date(), sources: z.array(z.object({ id: z.string(), url: z.url() })).min(1) }),
    archetypes: z.record(z.enum(ARCHETYPES.map((a) => a.id) as [ArchetypeId, ...ArchetypeId[]]), ArchetypeSpending),
  })
  .parse(seed);

const WEEKS_PER_YEAR = 52;
const pennies = (v: number) => Math.round(v * 100) / 100;

/** £ a year of each spending input: ONS's weekly average × 52. */
export function annualSpending(id: ArchetypeId): Record<SpendingVariable, number> {
  const weekly = ARCHETYPE_SPENDING.archetypes[id].weekly;
  return Object.fromEntries(SPENDING_VARIABLES.map((v) => [v, pennies(weekly[v].gbp * WEEKS_PER_YEAR)])) as Record<SpendingVariable, number>;
}

/** One PolicyEngine situation holding every archetype as its own household, so one request computes them all. */
export function archetypeSituation(startYear: number): Situation {
  const y = String(startYear);
  const at = <T>(v: T) => ({ [y]: v });
  const situation: Situation = { people: {}, benunits: {}, households: {} };
  const pension = fullNewStatePension(startYear);
  for (const { id } of ARCHETYPES) {
    const members: string[] = [];
    PEOPLE[id].forEach((p, i) => {
      const pid = `${id}_${i + 1}`;
      members.push(pid);
      situation.people[pid] = {
        age: at(p.age),
        ...(p.employment_income ? { employment_income: at(p.employment_income) } : {}),
        ...(p.pensioner ? { state_pension_type: at("NEW"), state_pension_reported: at(pension) } : {}),
      };
    });
    situation.benunits[id] = { members };
    const spending = Object.fromEntries(Object.entries(annualSpending(id)).map(([v, gbp]) => [v, at(gbp)]));
    situation.households[id] = { members, region: at(ARCHETYPE_REGION), ...spending, household_net_income: at(null) };
  }
  return situation;
}

/** Household net income (£ a year) of each archetype from a /uk/calculate result. */
export function readNetIncomes(result: unknown, startYear: number): Record<ArchetypeId, number> {
  const households = (result as { households?: Record<string, { household_net_income?: Record<string, unknown> }> } | null)?.households;
  const out = {} as Record<ArchetypeId, number>;
  for (const { id } of ARCHETYPES) {
    const v = households?.[id]?.household_net_income?.[String(startYear)];
    if (typeof v !== "number" || !Number.isFinite(v)) throw new TransformError("bad_household_result");
    out[id] = v;
  }
  return out;
}

export function householdRows(baseline: Record<ArchetypeId, number>, reform: Record<ArchetypeId, number>): T1Household[] {
  return ARCHETYPES.map(({ id, label }) => ({
    id,
    label,
    baseline_net_gbp: pennies(baseline[id]),
    reform_net_gbp: pennies(reform[id]),
    change_gbp: pennies(reform[id] - baseline[id]),
  }));
}
