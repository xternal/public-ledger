import { describe, expect, it } from "vitest";
import { loadSeed } from "@ledger/schema/seed";
import { fundingKey, stepValues, type Settings } from "@ledger/schema";
import {
  baseSettings,
  changedSettings,
  compute,
  createModel,
  debtFan,
  decodeScenario,
  encodeScenario,
  mortgageDelta,
  snapToStep,
  stepFor,
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
    if (l.effect.steps) {
      // A stepped lever offers today's value and the source's steps, nothing between.
      const values = stepValues(l);
      s[l.id] = values[Math.floor(rand() * values.length)]!;
      continue;
    }
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
  for (const lever of seed.levers.levers.filter((l) => l.effect.per_unit_bn)) {
    it(lever.id, () => {
      const base = compute(model, baseSettings(model));
      const r = compute(model, { ...baseSettings(model), [lever.id]: lever.base + 1 });
      const central = lever.effect.per_unit_bn!.y1[1];
      const side = model.sideOf.get(lever.effect.target);
      const line = side === "receipt" ? r.receipts : r.spending;
      const baseLine = side === "receipt" ? base.receipts : base.spending;
      expect(line[lever.effect.target]! - baseLine[lever.effect.target]!).toBeCloseTo(central, 9);
      expect(r.y1.d_borrowing_bn[1]).toBeCloseTo(side === "receipt" ? -central : central, 9);
    });
  }
});

describe("stepped levers: capital gains tax at HMRC's own steps only", () => {
  // HMRC, Direct effects of illustrative tax changes (June 2025), £ million, change made in April 2026:
  // { step: [2026-27, 2028-29] }. Minus = the Treasury collects less.
  const HMRC_CGT: Record<string, Record<number, [number, number]>> = {
    cgt_lower: { 1: [-5, 5], 5: [-40, -10], 10: [-130, -135] },
    cgt_higher: { 1: [-15, -30], 5: [-170, -870], 10: [-540, -3565] },
  };
  const base = baseSettings(model);
  const baseResult = compute(model, base);
  const cgtChange = (r: ReturnType<typeof compute>) => r.receipts.cgt! - baseResult.receipts.cgt!;

  for (const [id, figures] of Object.entries(HMRC_CGT)) {
    const lever = model.leverById.get(id)!;

    it(`${id}: offers only HMRC's steps, from today's rate`, () => {
      expect(lever.effect.per_unit_bn).toBeUndefined();
      expect(lever.effect.steps!.map((s) => s.at)).toEqual([1, 5, 10]);
      expect(lever.effect.target).toBe("cgt");
      expect(lever.min).toBe(lever.base);
      expect(lever.max).toBe(lever.base + 10);
      lever.effect.steps!.forEach((s) => expect(s.y5![1]).toBeCloseTo(figures[s.at]![1] / 1000, 9));
    });

    for (const [at, [y1]] of Object.entries(figures)) {
      it(`${id} +${at}: reproduces HMRC's year-one figure`, () => {
        const r = compute(model, { ...base, [id]: lever.base + Number(at) });
        expect(cgtChange(r)).toBeCloseTo(y1 / 1000, 9);
        // Receipts fall, so borrowing rises: a rise in the rate that loses money reads as more borrowing.
        expect(r.y1.d_borrowing_bn[1]).toBeCloseTo(-y1 / 1000, 9);
        expect(r.changes).toEqual([{ lever_id: id, kind: "lever", delta: Number(at), d_borrowing_bn: r.y1.d_borrowing_bn }]);
        expectBalanced({ ...base, [id]: lever.base + Number(at) });
      });
    }

    it(`${id}: a value between steps takes the step below, never a blend`, () => {
      const at = (v: number) => compute(model, { ...base, [id]: lever.base + v });
      expect(cgtChange(at(3))).toBeCloseTo(figures[1]![0] / 1000, 9);
      expect(at(3).changes[0]!.delta).toBe(1);
      expect(cgtChange(at(9.5))).toBeCloseTo(figures[5]![0] / 1000, 9);
      expect(cgtChange(at(1 + 1e-12))).toBeCloseTo(figures[1]![0] / 1000, 9);
      // Beyond the last step: the last step, not a scaled-up figure.
      expect(cgtChange(at(25))).toBeCloseTo(figures[10]![0] / 1000, 9);
      // Below the first step, or below today's rate: no change.
      expect(at(0.5).changes).toEqual([]);
      expect(at(-3).changes).toEqual([]);
    });
  }

  it("a big rise in the higher rate adds about half a billion to borrowing in year one", () => {
    const lever = model.leverById.get("cgt_higher")!;
    const r = compute(model, { ...base, cgt_higher: lever.base + 10 });
    expect(r.y1.d_borrowing_bn[1]).toBeCloseTo(0.54, 9);
    expect(r.y1.d_borrowing_bn[0]).toBeGreaterThan(0);
    expect(r.y1.d_borrowing_bn[0]).toBeLessThan(r.y1.d_borrowing_bn[2]);
  });

  it("snap an old link's value onto the step at or below it, and say so", () => {
    const lever = model.leverById.get("cgt_higher")!;
    for (const [value, want] of [
      [lever.base + 7, lever.base + 5],
      [lever.base + 0.5, lever.base],
      [lever.base + 40, lever.base + 10],
      [lever.base - 4, lever.base],
    ] as const) {
      const code = btoa(JSON.stringify({ v: 1, y: seed.baseYear, s: { cgt_higher: value } })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const d = decodeScenario(model, code)!;
      expect(d.settings.cgt_higher).toBe(want);
      expect(d.adjusted).toEqual(["cgt_higher"]);
    }
    const onStep = encodeScenario(model, { ...base, cgt_higher: lever.base + 5 }, seed.baseYear);
    expect(decodeScenario(model, onStep)!.adjusted).toEqual([]);
  });

  it("stepFor and snapToStep agree with the steps", () => {
    const lever = model.leverById.get("cgt_lower")!;
    expect(stepFor(lever, lever.base)).toBeUndefined();
    expect(stepFor(lever, lever.base + 5)!.at).toBe(5);
    expect(snapToStep(lever, lever.base + 6)).toBe(lever.base + 5);
    expect(stepValues(lever)).toEqual([lever.base, lever.base + 1, lever.base + 5, lever.base + 10]);
  });
});

describe("bus fare cap", () => {
  // Official figures (DfT written statement and No 10 press release, 22 Jul 2026): £400m of extra funding for
  // England, paid for by switching climate finance into loans. The M0 handover's +£0.1bn came from a press
  // figure ("over £500m") that no official source gives.
  it("funded by climate loans, as announced, nets to about zero", () => {
    const r = compute(model, { ...baseSettings(model), bus_cap_2: 1, [fundingKey("bus_cap_2")]: "climate_loans" });
    expect(r.y1.d_borrowing_bn[1]).toBeCloseTo(0, 9);
    expect(r.y1.d_borrowing_bn[0]).toBeLessThan(0);
    expect(r.y1.d_borrowing_bn[2]).toBeGreaterThan(0);
    expect(r.changes.map((c) => c.kind)).toEqual(["measure", "funding"]);
  });

  it("borrowed in full adds its whole cost", () => {
    const r = compute(model, { ...baseSettings(model), bus_cap_2: 1 });
    expect(r.y1.d_borrowing_bn).toEqual([0.36, 0.4, 0.44]);
  });

  it("matches the card preset", () => {
    const preset = seed.presets.find((p) => p.promise_id === "uk-bus-cap-2-2026")!;
    const r = compute(model, { ...baseSettings(model), ...preset.settings });
    expect(r.y1.d_borrowing_bn[1]).toBeCloseTo(0, 9);
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
    const paid = taxOn(seed.tax, 38000, { basicRatePct: 20, niMainRatePct: 8 });
    expect(paid.income_tax).toBeCloseTo((38000 - 12570) * 0.2, 6);
    expect(paid.ni).toBeCloseTo((38000 - 12570) * 0.08, 6);
  });

  it("tapers the personal allowance above £100k", () => {
    const r = { basicRatePct: 20, niMainRatePct: 8 };
    expect(taxOn(seed.tax, 125140, r).income_tax).toBeGreaterThan(taxOn(seed.tax, 100000, r).income_tax);
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

describe("scenario links (M2)", () => {
  const year = seed.baseYear;

  it("round-trip 20 random scenarios to the same settings and the same result", () => {
    const rand = rng(424242);
    for (let i = 0; i < 20; i++) {
      const s = randomSettings(model, rand);
      const code = encodeScenario(model, s, year);
      const decoded = decodeScenario(model, code)!;
      expect(decoded.dropped).toEqual([]);
      expect(decoded.adjusted).toEqual([]);
      const want = changedSettings(model, s);
      const got = changedSettings(model, decoded.settings);
      expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
      for (const [k, v] of Object.entries(want)) {
        if (typeof v === "number") expect(got[k] as number).toBeCloseTo(v, 9);
        else expect(got[k]).toBe(v);
      }
      expect(compute(model, decoded.settings).y1.d_borrowing_bn[1]).toBeCloseTo(compute(model, s).y1.d_borrowing_bn[1], 9);
    }
  });

  it("give the same code for the same scenario, whatever the key order", () => {
    const a = { ...baseSettings(model), vat_standard: 22, bank_rate: 5.25 };
    const b = { ...baseSettings(model), bank_rate: 5.25, vat_standard: 22 };
    expect(encodeScenario(model, a, year)).toBe(encodeScenario(model, b, year));
    expect(encodeScenario(model, baseSettings(model), year)).toBe("");
  });

  it("stay short enough for a URL", () => {
    const code = encodeScenario(model, { ...baseSettings(model), bus_cap_2: 1, [fundingKey("bus_cap_2")]: "climate_loans", vat_standard: 22 }, year);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(160);
  });

  it("carry the base year", () => {
    const code = encodeScenario(model, { ...baseSettings(model), vat_standard: 21 }, "2025-26");
    expect(decodeScenario(model, code)!.baseYear).toBe("2025-26");
  });

  it("reject codes that are not scenarios", () => {
    for (const bad of ["", "%%%", "bm90IGpzb24", btoa('{"v":99,"y":"2025-26","s":{}}'), btoa("[1,2,3]")]) {
      expect(decodeScenario(model, bad.replace(/=+$/, ""))).toBeNull();
    }
  });

  it("drop unknown levers and bad options, and pull values back into range", () => {
    const payload = { v: 1, y: year, s: { nonsense_lever: 3, vat_standard: 99, "bus_cap_2.funding": "magic_money", bank_rate: 4.1 } };
    const code = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const d = decodeScenario(model, code)!;
    const vat = model.leverById.get("vat_standard")!;
    expect(d.dropped.sort()).toEqual(["bus_cap_2.funding", "nonsense_lever"]);
    expect(d.settings.vat_standard).toBe(vat.max);
    expect(d.adjusted).toContain("vat_standard");
    expect(d.adjusted).toContain("bank_rate"); // 4.1 is off the 0.25 step grid
  });
});
