import { ARCHETYPES, type ArchetypeId } from "@ledger/schema";
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
 *   reports, so without it their pension would be zero.
 *
 * Known gap: no spending inputs (PolicyEngine's consumption variables and
 * petrol_spending), so VAT and fuel duty changes leave these households
 * unchanged. Adding sourced spending per household fixes it (checked 7 Oct
 * 2026: with spending given, VAT at 21% and fuel duty +1p move net income).
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
    situation.households[id] = { members, region: at(ARCHETYPE_REGION), household_net_income: at(null) };
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

const pennies = (v: number) => Math.round(v * 100) / 100;

export function householdRows(baseline: Record<ArchetypeId, number>, reform: Record<ArchetypeId, number>): T1Household[] {
  return ARCHETYPES.map(({ id, label }) => ({
    id,
    label,
    baseline_net_gbp: pennies(baseline[id]),
    reform_net_gbp: pennies(reform[id]),
    change_gbp: pennies(reform[id] - baseline[id]),
  }));
}
