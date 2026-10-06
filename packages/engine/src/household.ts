import type { MortgageReference, Settings, TaxSeed } from "@ledger/schema";
import { numberSetting, type Model } from "./model";
import type { ScenarioResult } from "./compute";

export interface TaxPaid {
  income_tax: number;
  ni: number;
  total: number;
}

const MONTHS_PER_YEAR = 12;

/**
 * Income tax and employee NI on a salary (England, Wales and NI rules).
 * Runs client-side only; the salary is never sent or stored (invariant 7).
 */
export function taxOn(tax: TaxSeed, salary: number, basicRatePct: number, niMainRatePct: number): TaxPaid {
  const it = tax.income_tax;
  const ni = tax.employee_ni;
  const over = Math.max(0, salary - it.allowance_taper_threshold_gbp);
  const allowance = Math.max(0, it.personal_allowance_gbp - over * it.allowance_taper_rate);
  const taxable = Math.max(0, salary - allowance);
  const basicTop = it.basic_band_gbp;
  const higherTop = it.additional_threshold_gbp - allowance;
  const incomeTax =
    (Math.min(taxable, basicTop) * basicRatePct) / 100 +
    (Math.max(0, Math.min(taxable, higherTop) - basicTop) * it.higher_rate_pct) / 100 +
    (Math.max(0, taxable - Math.max(higherTop, basicTop)) * it.additional_rate_pct) / 100;
  const niPaid =
    (Math.max(0, Math.min(salary, ni.upper_earnings_limit_gbp) - ni.primary_threshold_gbp) * niMainRatePct) / 100 +
    (Math.max(0, salary - ni.upper_earnings_limit_gbp) * ni.upper_rate_pct) / 100;
  return { income_tax: incomeTax, ni: niPaid, total: incomeTax + niPaid };
}

export interface YourShare {
  today: TaxPaid;
  scenario: TaxPaid;
  /** Scenario minus today. */
  diff: number;
  /** The scenario bill split in proportion to spending by line, largest first. */
  by_line: { id: string; gbp: number }[];
  /** Borrowing per pound of tax, applied to this bill. */
  borrowed_on_top_gbp: number;
}

export function yourShare(model: Model, tax: TaxSeed, r: ScenarioResult, settings: Settings, salary: number): YourShare {
  const basic = model.leverById.get(tax.income_tax.basic_rate_lever)!;
  const niMain = model.leverById.get(tax.employee_ni.main_rate_lever)!;
  const today = taxOn(tax, salary, basic.base, niMain.base);
  const scenario = taxOn(
    tax,
    salary,
    numberSetting(settings, basic.id, basic.base),
    numberSetting(settings, niMain.id, niMain.base),
  );
  const { spending_bn, receipts_bn, borrowing_bn } = r.totals;
  const by_line = Object.entries(r.spending)
    .map(([id, bn]) => ({ id, gbp: (scenario.total * bn) / spending_bn }))
    .sort((a, b) => b.gbp - a.gbp);
  return {
    today,
    scenario,
    diff: scenario.total - today.total,
    by_line,
    borrowed_on_top_gbp: (scenario.total * Math.max(0, borrowing_bn)) / receipts_bn,
  };
}

/** Monthly repayment on the reference mortgage at a given Bank Rate. */
export function mortgagePayment(ref: MortgageReference, bankRatePct: number): number {
  const i = (bankRatePct + ref.spread_over_bank_rate_pp) / 100 / MONTHS_PER_YEAR;
  const n = ref.term_years * MONTHS_PER_YEAR;
  if (Math.abs(i) < 1e-12) return ref.reference_loan_gbp / n;
  return (ref.reference_loan_gbp * i) / (1 - Math.pow(1 + i, -n));
}

/** Change in the reference monthly repayment when Bank Rate moves from base to the scenario value. */
export function mortgageDelta(ref: MortgageReference, baseRatePct: number, scenarioRatePct: number): number {
  return mortgagePayment(ref, scenarioRatePct) - mortgagePayment(ref, baseRatePct);
}
