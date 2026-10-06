import { describe, expect, it } from "vitest";
import { loadSeed } from "@ledger/schema/seed";
import { fundingKey, type Settings } from "@ledger/schema";
import {
  baseSettings,
  changedSettings,
  compute,
  createModel,
  debtFan,
  mortgageDelta,
  taxOn,
  yourShare,
  type Model,
} from "../src";

const seed = loadSeed();
const model = createModel(seed.statement, seed.levers);
const BALANCE_TOLERANCE_BN = 1e-6;

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

/** Small deterministic PRNG (mulberry32) so failures reproduce. */
function rng(seedValue: number) {
  let a = seedValue;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSettings(m: Model, rand: () => number): Settings {
  const s = baseSettings(m);
  for (const l of m.levers) {
    const steps = Math.round((l.max - l.min) / l.step);
    s[l.id] = l.min + Math.round(rand() * steps) * l.step;
    if (l.funding_options) {
      s[fundingKey(l.id)] = l.funding_options[Math.floor(rand() * l.funding_options.length)]!.id;
    }
  }
  return s;
}

function expectBalanced(settings: Settings) {
  const r = compute(model, settings);
  const base = compute(model, baseSettings(model));
  // Invariant 4: receipts + borrowing == spending.
  expect(Math.abs(sum(r.receipts) + r.totals.borrowing_bn - sum(r.spending))).toBeLessThan(BALANCE_TOLERANCE_BN);
  // The reported change in borrowing is exactly the change in the statement gap.
  expect(r.totals.borrowing_bn - base.totals.borrowing_bn).toBeCloseTo(r.y1.d_borrowing_bn[1], 9);
  // Ranges are ordered.
  for (const range of [r.y1.d_borrowing_bn, r.y1.per_household_gbp, r.y1.cpi_pp, r.y1.gdp_pct]) {
    expect(range[0]).toBeLessThanOrEqual(range[1] + 1e-12);
    expect(range[1]).toBeLessThanOrEqual(range[2] + 1e-12);
  }
}

describe("statement balance (invariant 4)", () => {
  it("balances at base and matches the seed borrowing figure", () => {
    const r = compute(model, baseSettings(model));
    expectBalanced(baseSettings(model));
    expect(r.totals.borrowing_bn).toBeCloseTo(seed.statement.borrowing_bn, 6);
    expect(r.changes).toEqual([]);
  });

  it("balances for 20 random scenarios", () => {
    const rand = rng(20261006);
    for (let i = 0; i < 20; i++) expectBalanced(randomSettings(model, rand));
  });
});

describe("golden tests: +1 unit reproduces each lever's central per_unit_bn", () => {
  for (const lever of seed.levers.levers) {
    it(lever.id, () => {
      const base = compute(model, baseSettings(model));
      const r = compute(model, { ...baseSettings(model), [lever.id]: lever.base + 1 });
      const central = lever.effect.per_unit_bn.y1[1];
      const side = model.sideOf.get(lever.effect.target);
      const line = side === "receipt" ? r.receipts : r.spending;
      const baseLine = side === "receipt" ? base.receipts : base.spending;
      expect(line[lever.effect.target]! - baseLine[lever.effect.target]!).toBeCloseTo(central, 9);
      expect(r.y1.d_borrowing_bn[1]).toBeCloseTo(side === "receipt" ? -central : central, 9);
    });
  }
});

describe("bus fare cap", () => {
  it("funded by climate loans nets to +£0.1bn borrowing", () => {
    const r = compute(model, { ...baseSettings(model), bus_cap_2: 1, [fundingKey("bus_cap_2")]: "climate_loans" });
    expect(r.y1.d_borrowing_bn[1]).toBeCloseTo(0.1, 9);
    expect(r.changes.map((c) => c.kind)).toEqual(["measure", "funding"]);
  });

  it("borrowed in full adds its whole cost", () => {
    const r = compute(model, { ...baseSettings(model), bus_cap_2: 1 });
    expect(r.y1.d_borrowing_bn).toEqual([0.45, 0.5, 0.6]);
  });

  it("matches the card preset", () => {
    const preset = seed.presets.find((p) => p.promise_id === "uk-bus-cap-2-2026")!;
    const r = compute(model, { ...baseSettings(model), ...preset.settings });
    expect(r.y1.d_borrowing_bn[1]).toBeCloseTo(0.1, 9);
  });
});

describe("debt path", () => {
  it("follows the OBR path when nothing changes", () => {
    const fan = debtFan(model, compute(model, baseSettings(model)));
    const obr = Object.values(seed.statement.macro.baseline_psnd_pct_gdp);
    fan.central.forEach((p, i) => expect(p.pct_gdp).toBeCloseTo(obr[i]!, 9));
    fan.baseline.forEach((p, i) => expect(p.pct_gdp).toBe(obr[i]));
  });

  it("rises above baseline when borrowing rises, inside its band", () => {
    const fan = debtFan(model, compute(model, { ...baseSettings(model), defence_gdp: 3.5 }));
    const last = fan.central.length - 1;
    expect(fan.central[last]!.pct_gdp).toBeGreaterThan(fan.baseline[last]!.pct_gdp);
    fan.central.forEach((p, i) => {
      expect(fan.low[i]!.pct_gdp).toBeLessThanOrEqual(p.pct_gdp + 1e-9);
      expect(fan.high[i]!.pct_gdp).toBeGreaterThanOrEqual(p.pct_gdp - 1e-9);
    });
  });
});

describe("your share and mortgage", () => {
  it("computes income tax and NI below the higher-rate threshold", () => {
    const paid = taxOn(seed.tax, 38000, 20, 8);
    expect(paid.income_tax).toBeCloseTo((38000 - 12570) * 0.2, 6);
    expect(paid.ni).toBeCloseTo((38000 - 12570) * 0.08, 6);
  });

  it("tapers the personal allowance above £100k", () => {
    expect(taxOn(seed.tax, 125140, 20, 8).income_tax).toBeGreaterThan(taxOn(seed.tax, 100000, 20, 8).income_tax);
  });

  it("splits the bill in proportion to spending and adds borrowing on top", () => {
    const settings = baseSettings(model);
    const r = compute(model, settings);
    const share = yourShare(model, seed.tax, r, settings, 38000);
    expect(share.by_line.reduce((a, l) => a + l.gbp, 0)).toBeCloseTo(share.scenario.total, 6);
    expect(share.diff).toBe(0);
    expect(share.borrowed_on_top_gbp).toBeCloseTo((share.scenario.total * r.totals.borrowing_bn) / r.totals.receipts_bn, 6);
  });

  it("raises the monthly repayment when Bank Rate rises", () => {
    const ref = model.leverById.get("bank_rate")!.household!;
    expect(mortgageDelta(ref, 3.75, 5.25)).toBeGreaterThan(0);
    expect(mortgageDelta(ref, 3.75, 3.75)).toBe(0);
  });
});

describe("scenario settings", () => {
  it("keeps only what differs from base, and drops funding for a measure that is off", () => {
    const s = { ...baseSettings(model), vat_standard: 22, [fundingKey("bus_cap_2")]: "climate_loans" };
    expect(changedSettings(model, s)).toEqual({ vat_standard: 22 });
  });
});

describe("speed (CLAUDE.md: T0 returns in < 50 ms)", () => {
  it("computes a scenario and its debt fan in well under 50 ms", () => {
    const s = randomSettings(model, rng(1));
    const t0 = performance.now();
    const runs = 100;
    for (let i = 0; i < runs; i++) debtFan(model, compute(model, s));
    expect((performance.now() - t0) / runs).toBeLessThan(50);
  });
});
