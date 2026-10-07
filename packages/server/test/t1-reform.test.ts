import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T1_LEVERS, type Settings } from "@ledger/schema";
import { PE_PARAMETERS, periodKey, startYearOf, toPolicyEngineReform, type LeverModel } from "../src/model";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

// The real levers (data/build/levers.json) and PolicyEngine's metadata, trimmed (test/fixtures/t1).
const model: LeverModel = read("data/build/levers.json");
const meta: { model_version: string; parameters: string[]; values: Record<string, { values: Record<string, unknown> }> } = read(
  "packages/server/test/fixtures/t1/pe-meta-parameters.json",
);
const base = (): Settings => Object.fromEntries(model.levers.map((l) => [l.id, l.base]));
const with_ = (changes: Settings) => ({ ...base(), ...changes });
const P = periodKey(2025);

/** PolicyEngine's value of a parameter in force on a date (latest dated value on or before it). */
function peValueOn(path: string, date: string): unknown {
  const values = meta.values[path]?.values ?? {};
  const latest = Object.keys(values)
    .filter((d) => d <= date)
    .sort()
    .at(-1);
  return latest === undefined ? undefined : values[latest];
}

describe("T1 reform mapping", () => {
  it("uses the fiscal year's first calendar year, open-ended", () => {
    expect(startYearOf("2025-26")).toBe(2025);
    expect(periodKey(2025)).toBe("2025-01-01.2100-12-31");
    expect(() => startYearOf("2025")).toThrow();
  });

  it("sends nothing when no lever moved", () => {
    expect(toPolicyEngineReform(base(), model, 2025)).toEqual({ data: {}, modelled: [], not_modelled: [] });
  });

  it("maps each rate in percentage points to PolicyEngine's /1", () => {
    const cases: [string, number, string, number][] = [
      ["income_tax_basic", 21, "gov.hmrc.income_tax.rates.uk[0].rate", 0.21],
      ["income_tax_higher", 42, "gov.hmrc.income_tax.rates.uk[1].rate", 0.42],
      ["nics_main", 6, "gov.hmrc.national_insurance.class_1.rates.employee.main", 0.06],
      ["vat_standard", 21, "gov.hmrc.vat.standard_rate", 0.21],
    ];
    for (const [lever, value, path, expected] of cases) {
      const r = toPolicyEngineReform(with_({ [lever]: value }), model, 2025);
      expect(r.data).toEqual({ [path]: { [P]: expected } });
      expect(r.modelled).toEqual([lever]);
    }
  });

  it("sets the additional rate on uk[2] and on the £10m placeholder band uk[3]", () => {
    const r = toPolicyEngineReform(with_({ income_tax_additional: 50 }), model, 2025);
    expect(r.data).toEqual({
      "gov.hmrc.income_tax.rates.uk[2].rate": { [P]: 0.5 },
      "gov.hmrc.income_tax.rates.uk[3].rate": { [P]: 0.5 },
    });
    // uk[3] really is a placeholder: it starts at £10m and charges the additional rate.
    expect(peValueOn("gov.hmrc.income_tax.rates.uk[3].threshold", "2025-01-01")).toBe(10_000_000);
    expect(peValueOn("gov.hmrc.income_tax.rates.uk[3].rate", "2025-01-01")).toBe(0.45);
  });

  it("keeps the personal allowance in pounds", () => {
    const r = toPolicyEngineReform(with_({ personal_allowance: 13_570 }), model, 2025);
    expect(r.data).toEqual({ "gov.hmrc.income_tax.allowances.personal_allowance.amount": { [P]: 13_570 } });
  });

  it("turns fuel duty pence per litre into pounds, without floating-point dust", () => {
    const r = toPolicyEngineReform(with_({ fuel_duty: 52.95 + 1 }), model, 2025);
    expect(r.data).toEqual({ "gov.hmrc.fuel_duty.petrol_and_diesel": { [P]: 0.5395 } });
  });

  it("raises every State Pension payment by the lever's percentage", () => {
    expect(toPolicyEngineReform(with_({ state_pension_change: 5 }), model, 2025).data).toEqual({
      "gov.contrib.cec.state_pension_increase": { [P]: 0.05 },
    });
    expect(toPolicyEngineReform(with_({ state_pension_change: -10 }), model, 2025).data).toEqual({
      "gov.contrib.cec.state_pension_increase": { [P]: -0.1 },
    });
  });

  it("lists changed levers T1 cannot model and leaves them out of the reform", () => {
    const r = toPolicyEngineReform(with_({ vat_standard: 21, bank_rate: 4, bus_cap_2: 1, "bus_cap_2.funding": "x" }), model, 2025);
    expect(r.modelled).toEqual(["vat_standard"]);
    expect(r.not_modelled).toEqual(["bank_rate", "bus_cap_2"]);
    expect(Object.keys(r.data)).toEqual(["gov.hmrc.vat.standard_rate"]);
    expect(toPolicyEngineReform(with_({ corp_tax: 26 }), model, 2025)).toEqual({ data: {}, modelled: [], not_modelled: ["corp_tax"] });
  });

  it("uses the year it is given", () => {
    const r = toPolicyEngineReform(with_({ vat_standard: 21 }), model, 2026);
    expect(r.data).toEqual({ "gov.hmrc.vat.standard_rate": { "2026-01-01.2100-12-31": 0.21 } });
  });

  it("covers every T1 lever, and every T1 lever is a lever", () => {
    expect(Object.keys(PE_PARAMETERS).sort()).toEqual([...T1_LEVERS].sort());
    const ids = new Set(model.levers.map((l) => l.id));
    for (const id of T1_LEVERS) expect(ids.has(id), id).toBe(true);
  });

  it("only names parameters that exist in PolicyEngine's metadata", () => {
    const known = new Set(meta.parameters);
    expect(known.size).toBeGreaterThan(1000);
    for (const targets of Object.values(PE_PARAMETERS)) for (const t of targets) expect(known.has(t.path), t.path).toBe(true);
  });

  it("starts from the same values as PolicyEngine's current law in 2025", () => {
    // A lever moved to X sets PolicyEngine's parameter to X, so the lever's base must equal PolicyEngine's baseline.
    for (const id of T1_LEVERS) {
      const lever = model.levers.find((l) => l.id === id)!;
      for (const t of PE_PARAMETERS[id]) {
        const pe = peValueOn(t.path, "2025-01-01");
        expect(t.convert(lever.base), `${id} → ${t.path}`).toBeCloseTo(pe as number, 8);
      }
    }
  });
});
