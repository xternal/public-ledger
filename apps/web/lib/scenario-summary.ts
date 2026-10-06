import type { Range, Seed } from "@ledger/schema";
import { compute, createModel, debtFan, decodeScenario, type DecodedScenario, type Model, type ScenarioResult } from "@ledger/engine";
import { changeLabel } from "./levers";
import { direction, gbpBn } from "./format";

/** Everything the share page and its image show for one scenario code. Server-safe, no React. */
export interface ScenarioSummary {
  code: string;
  model: Model;
  decoded: DecodedScenario;
  result: ScenarioResult;
  headline: string;
  tone: "up" | "down" | "flat";
  changes: { label: string; d_borrowing_bn: Range }[];
  debt: { period: string; central: number; low: number; high: number; obr: number };
}

export function summarise(seed: Seed, code: string): ScenarioSummary | null {
  const model = createModel(seed.statement, seed.levers);
  const decoded = decodeScenario(model, code);
  if (!decoded) return null;
  const result = compute(model, decoded.settings);
  if (result.changes.length === 0) return null;
  const d = result.y1.d_borrowing_bn;
  const tone = direction(d[1]);
  const headline =
    tone === "up" ? `Borrowing up ${gbpBn(d[1])} a year` : tone === "down" ? `Borrowing down ${gbpBn(-d[1])} a year` : "Borrowing unchanged";
  const fan = debtFan(model, result);
  const last = fan.central.length - 1;
  return {
    code,
    model,
    decoded,
    result,
    headline,
    tone,
    changes: result.changes.map((c) => ({ label: changeLabel(model, c), d_borrowing_bn: c.d_borrowing_bn })),
    debt: {
      period: fan.central[last]!.period,
      central: fan.central[last]!.pct_gdp,
      low: fan.low[last]!.pct_gdp,
      high: fan.high[last]!.pct_gdp,
      obr: fan.baseline[last]!.pct_gdp,
    },
  };
}
