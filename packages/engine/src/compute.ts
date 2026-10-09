import type { Lever, Range, Settings } from "@ledger/schema";
import { fundingKey } from "@ledger/schema";
import { DEBT_INTEREST_LINE, isOn, numberSetting, type Model } from "./model";
import { ZERO, add, ordered, point, scale } from "./range";
import { stepFor } from "./steps";

export const ENGINE_VERSION = "T0-0.1.0";

/** Changes smaller than this are treated as no change (floating-point noise from slider steps). */
const EPSILON = 1e-9;

/** A per-unit lever's coefficients. The schema gives every lever exactly one of per_unit_bn or steps. */
function perUnit(lever: Lever): { y1: Range; y5?: Range | undefined } {
  const per = lever.effect.per_unit_bn;
  if (!per) throw new Error(`lever ${lever.id} has no per_unit_bn`);
  return per;
}

export interface Change {
  /** Lever id; funding rows use the measure's lever id. */
  lever_id: string;
  kind: "lever" | "measure" | "funding";
  /** Units moved from base (sliders), or for a stepped lever the step it stands on. */
  delta?: number;
  funding_id?: string;
  /** Effect on borrowing, year one. Positive = more borrowing. */
  d_borrowing_bn: Range;
}

export interface ScenarioResult {
  engine: "T0";
  engine_version: string;
  /** Central value of every statement line under the scenario. */
  receipts: Record<string, number>;
  spending: Record<string, number>;
  totals: { receipts_bn: number; spending_bn: number; borrowing_bn: number };
  y1: {
    d_borrowing_bn: Range;
    per_household_gbp: Range;
    cpi_pp: Range;
    gdp_pct: Range;
  };
  changes: Change[];
  /**
   * Raw per-coefficient triples (index 0 uses every lever's low coefficient,
   * 2 every high one). The debt path needs them unsorted; display uses y1.
   */
  raw: {
    d_borrowing_bn: Range;
    d_tax_bn: Range;
    d_spending_non_interest_bn: Range;
    rate_y1_bn: Range;
    rate_y5_bn: Range;
  };
  /** Bank Rate (or the model's rate lever) under the scenario, in percent. */
  rate_pct: number;
}

export function compute(model: Model, settings: Settings): ScenarioResult {
  const { statement, sideOf } = model;
  const receipts: Record<string, number> = Object.fromEntries(statement.receipts.map((l) => [l.id, l.bn]));
  const spending: Record<string, number> = Object.fromEntries(statement.spending.map((l) => [l.id, l.bn]));

  let dBorrow: Range = ZERO;
  let dTax: Range = ZERO;
  let dSpendNonInt: Range = ZERO;
  let rateY1: Range = ZERO;
  let rateY5: Range = ZERO;
  let cpi: Range = ZERO;
  const changes: Change[] = [];

  /** Move a statement line by a range; return the effect on borrowing. */
  const move = (target: string, delta: Range): Range => {
    if (sideOf.get(target) === "receipt") {
      receipts[target]! += delta[1];
      dTax = add(dTax, delta);
      return scale(delta, -1);
    }
    spending[target]! += delta[1];
    if (target !== DEBT_INTEREST_LINE) dSpendNonInt = add(dSpendNonInt, delta);
    return delta;
  };

  for (const lever of model.levers) {
    const value = numberSetting(settings, lever.id, lever.base);

    if (lever.unit === "toggle") {
      if (!isOn(value)) continue;
      const db = move(lever.effect.target, perUnit(lever).y1);
      dBorrow = add(dBorrow, db);
      changes.push({ lever_id: lever.id, kind: "measure", d_borrowing_bn: ordered(db) });

      const fundingId = settings[fundingKey(lever.id)];
      const option = lever.funding_options?.find((f) => f.id === fundingId) ?? lever.funding_options?.[0];
      if (option && option.offset_bn > 0 && option.target) {
        // An offset always reduces borrowing: more receipts, or less spending elsewhere.
        const side = sideOf.get(option.target);
        const fb = move(option.target, point(side === "receipt" ? option.offset_bn : -option.offset_bn));
        dBorrow = add(dBorrow, fb);
        changes.push({ lever_id: lever.id, kind: "funding", funding_id: option.id, d_borrowing_bn: fb });
      }
      continue;
    }

    let d: number;
    let delta: Range;
    let delta5: Range | undefined;
    if (lever.effect.steps) {
      // The source's own figure for the step the value stands on: never interpolated or scaled.
      const step = stepFor(lever, value);
      if (!step) continue;
      d = step.at;
      delta = step.y1;
      delta5 = step.y5;
    } else {
      d = value - lever.base;
      if (Math.abs(d) < EPSILON) continue;
      const per = perUnit(lever);
      delta = scale(per.y1, d);
      delta5 = per.y5 && scale(per.y5, d);
    }
    const db = move(lever.effect.target, delta);
    dBorrow = add(dBorrow, db);
    if (lever.effect.target === DEBT_INTEREST_LINE) {
      rateY1 = add(rateY1, delta);
      rateY5 = add(rateY5, delta5 ?? delta);
    }
    // Schema: only per-unit levers carry a price effect per unit.
    if (lever.effect.cpi_pp_per_unit) cpi = add(cpi, scale(lever.effect.cpi_pp_per_unit, d));
    changes.push({ lever_id: lever.id, kind: "lever", delta: d, d_borrowing_bn: ordered(db) });
  }

  const receiptsBn = sum(Object.values(receipts));
  const spendingBn = sum(Object.values(spending));
  const { macro } = statement;

  const ms = model.macroRules.spending_multiplier;
  const mt = model.macroRules.tax_multiplier;
  const gdp = [0, 1, 2].map((i) => ((ms[i]! * dSpendNonInt[1] - mt[i]! * dTax[1]) / macro.nominal_gdp_bn) * 100) as Range;

  const households = macro.households_m * 1e6;
  const dB = ordered(dBorrow);

  return {
    engine: "T0",
    engine_version: ENGINE_VERSION,
    receipts,
    spending,
    totals: { receipts_bn: receiptsBn, spending_bn: spendingBn, borrowing_bn: spendingBn - receiptsBn },
    y1: {
      d_borrowing_bn: dB,
      per_household_gbp: scale(dB, 1e9 / households),
      cpi_pp: ordered(cpi),
      gdp_pct: ordered(gdp),
    },
    changes,
    raw: {
      d_borrowing_bn: dBorrow,
      d_tax_bn: dTax,
      d_spending_non_interest_bn: dSpendNonInt,
      rate_y1_bn: rateY1,
      rate_y5_bn: rateY5,
    },
    rate_pct: model.rateLever ? numberSetting(settings, model.rateLever.id, model.rateLever.base) : macro.bank_rate_pct,
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
