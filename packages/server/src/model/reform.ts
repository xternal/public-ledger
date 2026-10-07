import { T1_LEVERS, type Settings, type T1Lever } from "@ledger/schema";

/**
 * Sandbox settings → a PolicyEngine UK reform (docs/MODEL.md, T1).
 *
 * A reform is PolicyEngine's own format: parameter path → { "<from>.<to>": value }.
 * The same format works for a self-hosted policyengine-uk, so it is the
 * provider-neutral input of T1Provider too.
 */
export type Reform = Record<string, Record<string, number>>;

/** The fields of the engine's Model that the mapping reads (kept structural so the server does not depend on @ledger/engine). */
export interface LeverModel {
  levers: readonly { id: string; base: number }[];
}

export interface ReformMapping {
  /** PolicyEngine reform data, `{}` when no T1 lever changed. */
  data: Reform;
  /** Changed levers T1 sends to PolicyEngine. */
  modelled: T1Lever[];
  /** Changed levers T1 cannot model (they stay T0-only). */
  not_modelled: string[];
}

interface Target {
  path: string;
  /** Lever value → parameter value. */
  convert: (value: number) => number;
}

const fraction = (v: number) => v / 100; // percentage points → PolicyEngine rate (/1)
const same = (v: number) => v;

/**
 * Each T1 lever and the PolicyEngine parameters it sets. Every path is checked
 * against PolicyEngine's metadata in test/t1-reform.test.ts.
 */
export const PE_PARAMETERS: Record<T1Lever, Target[]> = {
  income_tax_basic: [{ path: "gov.hmrc.income_tax.rates.uk[0].rate", convert: fraction }],
  income_tax_higher: [{ path: "gov.hmrc.income_tax.rates.uk[1].rate", convert: fraction }],
  // uk[3] is a placeholder top band starting at £10m with the additional rate.
  // Left alone, income above £10m would stay at 45%.
  income_tax_additional: [
    { path: "gov.hmrc.income_tax.rates.uk[2].rate", convert: fraction },
    { path: "gov.hmrc.income_tax.rates.uk[3].rate", convert: fraction },
  ],
  personal_allowance: [{ path: "gov.hmrc.income_tax.allowances.personal_allowance.amount", convert: same }],
  nics_main: [{ path: "gov.hmrc.national_insurance.class_1.rates.employee.main", convert: fraction }],
  vat_standard: [{ path: "gov.hmrc.vat.standard_rate", convert: fraction }],
  // The lever is in pence per litre; PolicyEngine's parameter is £ per litre.
  fuel_duty: [{ path: "gov.hmrc.fuel_duty.petrol_and_diesel", convert: fraction }],
  // A % change in every State Pension payment. Not the weekly amounts
  // (gov.dwp.state_pension.{new,basic}_state_pension.amount): PolicyEngine UK
  // pays each pensioner their reported pension uprated by the triple lock, so
  // changing those amounts moves nothing (checked 7 Oct 2026: a 5% rise in both
  // gave a budget impact of −£3,346, against −£4.27bn for this parameter).
  state_pension_change: [{ path: "gov.contrib.cec.state_pension_increase", convert: fraction }],
};

/** PolicyEngine's period key: from 1 January of the fiscal year's first calendar year, open-ended. */
export function periodKey(startYear: number): string {
  return `${startYear}-01-01.2100-12-31`;
}

/** "2025-26" → 2025, the calendar year PolicyEngine UK simulates for that fiscal year. */
export function startYearOf(fiscalYear: string): number {
  const y = Number(fiscalYear.slice(0, 4));
  if (!/^\d{4}-\d{2}$/.test(fiscalYear) || !Number.isInteger(y)) throw new Error(`not a fiscal year: ${fiscalYear}`);
  return y;
}

const EPSILON = 1e-9;
const T1_SET = new Set<string>(T1_LEVERS);
/** Round away floating-point dust, so the same scenario always maps to the same reform (PolicyEngine reuses the policy id). */
const clean = (v: number) => Number(v.toFixed(8));

export function toPolicyEngineReform(settings: Settings, model: LeverModel, startYear: number): ReformMapping {
  const data: Reform = {};
  const modelled: T1Lever[] = [];
  const not_modelled: string[] = [];
  const period = periodKey(startYear);
  for (const lever of model.levers) {
    const raw = settings[lever.id];
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : lever.base;
    if (Math.abs(value - lever.base) < EPSILON) continue;
    if (!T1_SET.has(lever.id)) {
      not_modelled.push(lever.id);
      continue;
    }
    const id = lever.id as T1Lever;
    modelled.push(id);
    for (const t of PE_PARAMETERS[id]) data[t.path] = { [period]: clean(t.convert(value)) };
  }
  return { data, modelled, not_modelled };
}
