import type { Range } from "@ledger/schema";
import type { Model } from "./model";
import type { ScenarioResult } from "./compute";

export interface DebtPoint {
  period: string;
  pct_gdp: number;
}

export interface DebtFan {
  /** OBR's own PSND % GDP path (sourced). */
  baseline: DebtPoint[];
  /** Scenario path with every lever at its central coefficient. */
  central: DebtPoint[];
  /** Pointwise lowest and highest of the low- and high-coefficient paths. */
  low: DebtPoint[];
  high: DebtPoint[];
}

/** Year in which a rate change reaches its steady-state (y5) cost, counted from the first scenario year. */
const RATE_PASS_THROUGH_YEARS = 4;

/**
 * Debt path to the end of the OBR horizon (MODEL.md T0). The baseline is the
 * OBR path; the scenario adds cumulative extra borrowing on top, which itself
 * carries interest. The first year is outturn-year 2025-26 and stays at
 * baseline; the scenario starts the year after.
 *
 * v0 charges extra debt at the scenario Bank Rate. v1 should use the
 * effective interest rate on the gilt stock (review H4).
 */
export function debtPath(model: Model, r: ScenarioResult, which: 0 | 1 | 2 | "baseline"): DebtPoint[] {
  const { macro } = model.statement;
  const periods = Object.keys(macro.baseline_psnd_pct_gdp);
  const base = Object.values(macro.baseline_psnd_pct_gdp);
  let gdp = macro.nominal_gdp_bn;
  let extra = 0;
  const out: DebtPoint[] = [{ period: periods[0]!, pct_gdp: base[0]! }];
  for (let t = 1; t < periods.length; t++) {
    gdp *= 1 + macro.baseline_nominal_growth_pct / 100;
    if (which !== "baseline") {
      const k = Math.min(t - 1, RATE_PASS_THROUGH_YEARS) / RATE_PASS_THROUGH_YEARS;
      const rateY1 = r.raw.rate_y1_bn[which];
      const rate = rateY1 + (r.raw.rate_y5_bn[which] - rateY1) * k;
      const nonRate = r.raw.d_borrowing_bn[which] - rateY1;
      extra += nonRate + rate + extra * (r.rate_pct / 100);
    }
    out.push({ period: periods[t]!, pct_gdp: base[t]! + (extra / gdp) * 100 });
  }
  return out;
}

export function debtFan(model: Model, r: ScenarioResult): DebtFan {
  const a = debtPath(model, r, 0);
  const b = debtPath(model, r, 2);
  return {
    baseline: debtPath(model, r, "baseline"),
    central: debtPath(model, r, 1),
    low: a.map((p, i) => ({ period: p.period, pct_gdp: Math.min(p.pct_gdp, b[i]!.pct_gdp) })),
    high: a.map((p, i) => ({ period: p.period, pct_gdp: Math.max(p.pct_gdp, b[i]!.pct_gdp) })),
  };
}

/** DATA_MODEL.md ScenarioResult.horizon: debt % GDP as a range per year. */
export function horizon(fan: DebtFan): { period: string; debt_pct_gdp: Range }[] {
  return fan.central.map((p, i) => ({
    period: p.period,
    debt_pct_gdp: [fan.low[i]!.pct_gdp, p.pct_gdp, fan.high[i]!.pct_gdp],
  }));
}
