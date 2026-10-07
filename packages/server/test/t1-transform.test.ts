import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REGIONS, T1Result } from "@ledger/schema";
import lookup from "../../../data/seed/lad_region.json";
import { aggregateRegions, decileRelativeToPct, regionOf, toT1Population, TransformError, type T1Population } from "../src/model";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/t1/${name}`, import.meta.url), "utf8"));

// PolicyEngine's real answer for VAT at 21% in 2025 (policy 93107), fetched 7 Oct 2026.
const vat = fixture("pe-economy-vat21-2025.json");
const fetchedAt = new Date("2026-10-07T12:00:00Z");
const { population, warnings } = toT1Population(vat.result, { policyId: 93107, startYear: 2025, fetchedAt });

type Shares = T1Population["winners"]["all"];
const total = (s: Shares) => s.gain_more_5 + s.gain_less_5 + s.no_change + s.lose_less_5 + s.lose_more_5;

describe("T1 transform (VAT 21%, real PolicyEngine result)", () => {
  it("turns the budget into £bn, positive meaning more money for the government", () => {
    expect(population.budget.net_bn).toBeCloseTo(14.99, 2);
    expect(population.budget.tax_bn).toBeCloseTo(14.99, 2);
    expect(population.budget.benefits_bn).toBe(0);
    expect(population.budget.by_programme.vat!.change_bn).toBeCloseTo(14.99, 2);
    expect(population.budget.by_programme.vat!.baseline_bn).toBeCloseTo(304.22, 2);
    expect(population.budget.by_programme.income_tax!.change_bn).toBe(0);
  });

  it("gives each decile's change in £ and %", () => {
    expect(population.deciles.map((d) => d.decile)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(population.deciles[0]!.rel_change_pct).toBeCloseTo(-2.99, 2);
    expect(population.deciles[0]!.avg_change_gbp).toBeCloseTo(-468.02, 2);
    expect(population.deciles[9]!.rel_change_pct).toBeCloseTo(-0.4, 2);
    // A VAT rise takes a bigger share of income from the poorest tenth than from the richest.
    expect(population.deciles[0]!.rel_change_pct).toBeLessThan(population.deciles[9]!.rel_change_pct);
  });

  it("maps winners and losers onto shares that sum to 1", () => {
    expect(total(population.winners.all)).toBeCloseTo(1, 9);
    expect(population.winners.all.lose_less_5).toBeCloseTo(0.72, 2);
    expect(population.winners.all.gain_more_5).toBe(0);
    expect(population.winners.by_decile).toHaveLength(10);
    for (const d of population.winners.by_decile) expect(total(d)).toBeCloseTo(1, 9);
    expect(population.winners.by_decile[0]!.lose_more_5).toBeCloseTo(0.2126, 4);
  });

  it("aggregates 363 local authorities into the regions and nations PolicyEngine covers", () => {
    expect(warnings).toEqual([]);
    // No Northern Irish local authorities in PolicyEngine's results: left out, not shown as zero.
    expect(population.regions.map((r) => r.id)).toEqual(REGIONS.filter((r) => r.id !== "N92000002").map((r) => r.id));
    for (const r of population.regions) {
      expect(r.avg_change_gbp).toBeLessThan(0);
      expect(r.rel_change_pct).toBeLessThan(0);
      expect(r.rel_change_pct).toBeGreaterThan(-5);
    }
    // Population-weighted, by hand for Wales.
    const welsh = (vat.result.local_authority_impact as { local_authority_code: string; population: number; average_household_income_change: number }[]).filter(
      (a) => a.local_authority_code.startsWith("W"),
    );
    expect(welsh).toHaveLength(22);
    const w = welsh.reduce((s, a) => s + a.population, 0);
    const avg = welsh.reduce((s, a) => s + a.population * a.average_household_income_change, 0) / w;
    expect(population.regions.find((r) => r.id === "W92000004")!.avg_change_gbp).toBeCloseTo(avg, 6);
  });

  it("records where the numbers came from", () => {
    expect(population.provenance).toEqual({
      provider: "policyengine_api",
      model_version: "2.102.3",
      data_version: "policyengine-uk-data-1.56.16",
      dataset: "gs://policyengine-uk-data-private/enhanced_frs_2024_25.h5@1.56.16",
      policy_id: 93107,
      url: "https://policyengine.org/uk/policy?reform=93107&focus=policyOutput.policyBreakdown&region=uk&timePeriod=2025",
      fetched_at: "2026-10-07T12:00:00.000Z",
    });
  });

  it("passes poverty and inequality through, and fits the T1Result contract", () => {
    expect(population.poverty.all.baseline).toBeCloseTo(0.197, 3);
    expect(population.inequality.gini.baseline).toBeCloseTo(0.3211, 4);
    const result = T1Result.parse({
      scenario: "x",
      year: "2025-26",
      quality: "modelled",
      modelled: ["vat_standard"],
      not_modelled: [],
      households: [],
      ...population,
    });
    expect(result.deciles).toHaveLength(10);
  });

  it("rejects a result in a shape it does not know", () => {
    expect(() => toT1Population({ status: "computing" }, { policyId: 1, startYear: 2025, fetchedAt })).toThrow(TransformError);
    const noVersions = structuredClone(vat.result);
    delete noVersions.policyengine_bundle;
    delete noVersions.model_version;
    expect(() => toT1Population(noVersions, { policyId: 1, startYear: 2025, fetchedAt })).toThrow(/missing_versions/);
  });
});

describe("decile units", () => {
  const average = { "1": -468, "2": -333, "3": -308, "4": -354, "5": -411, "6": -499, "7": -557, "8": -547, "9": -875, "10": -727 };
  it("reads PolicyEngine's percentages as they are", () => {
    const pct = { "1": -2.99, "2": -1.17, "3": -0.84, "4": -0.79, "5": -0.8, "6": -0.84, "7": -0.8, "8": -0.66, "9": -0.87, "10": -0.4 };
    expect(decileRelativeToPct(average, pct)).toBe(1);
  });
  it("would scale fractions up to percentages", () => {
    const frac = { "1": -0.0299, "2": -0.0117, "3": -0.0084, "4": -0.0079, "5": -0.008, "6": -0.0084, "7": -0.008, "8": -0.0066, "9": -0.0087, "10": -0.004 };
    expect(decileRelativeToPct(average, frac)).toBe(100);
  });
  it("leaves all-zero changes alone", () => {
    const zero = Object.fromEntries(Object.keys(average).map((k) => [k, 0]));
    expect(decileRelativeToPct(zero, zero)).toBe(1);
  });
});

describe("local authority → region lookup", () => {
  it("covers every local authority PolicyEngine reports", () => {
    const codes = (vat.result.local_authority_impact as { local_authority_code: string }[]).map((a) => a.local_authority_code);
    expect(codes).toHaveLength(363);
    expect(codes.filter((c) => regionOf(c) === null)).toEqual([]);
  });

  it("maps nations by their first letter and England by ONS's lookup", () => {
    expect(regionOf("S12000033")).toBe("S92000003");
    expect(regionOf("W06000015")).toBe("W92000004");
    expect(regionOf("N09000003")).toBe("N92000002");
    expect(regionOf("E09000033")).toBe("E12000007"); // Westminster, London
    expect(regionOf("E07000026")).toBe("E12000002"); // Allerdale (abolished 2023), North West
    expect(regionOf("E06000063")).toBe("E12000002"); // Cumberland (from 2023), North West
    expect(regionOf("E99999999")).toBeNull();
  });

  it("records its sources", () => {
    expect(lookup.meta.sources.map((s) => s.edition)).toEqual(["April 2025 (V2)", "April 2021"]);
    for (const s of lookup.meta.sources) {
      expect(s.url).toMatch(/^https:\/\/geoportal\.statistics\.gov\.uk\/datasets\//);
      expect(s.retrieved_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const regionIds = new Set<string>(REGIONS.map((r) => r.id));
    for (const [code, v] of Object.entries(lookup.lad)) {
      expect(code).toMatch(/^E0[6-9]\d{6}$/);
      expect(regionIds.has(v.region), code).toBe(true);
    }
  });

  it("weights by population and reports codes it cannot place", () => {
    const { regions, unmatched } = aggregateRegions([
      { code: "E09000001", population: 1, avg_change_gbp: -100, rel_change: -0.01 },
      { code: "E09000002", population: 3, avg_change_gbp: -200, rel_change: -0.03 },
      { code: "S12000033", population: 2, avg_change_gbp: 50, rel_change: 0.005 },
      { code: "E00000000", population: 5, avg_change_gbp: 1, rel_change: 0 },
    ]);
    expect(unmatched).toEqual(["E00000000"]);
    expect(regions).toEqual([
      { id: "E12000007", name: "London", avg_change_gbp: -175, rel_change_pct: -2.5 },
      { id: "S92000003", name: "Scotland", avg_change_gbp: 50, rel_change_pct: 0.5 },
    ]);
  });
});
