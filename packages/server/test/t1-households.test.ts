import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARCHETYPES, type ArchetypeId } from "@ledger/schema";
import { ARCHETYPE_SPENDING, SPENDING_VARIABLES, annualSpending, archetypeSituation, fullNewStatePension, householdRows, readNetIncomes } from "../src/model";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/t1/${name}`, import.meta.url), "utf8"));
// Real /uk/calculate answers for the six archetypes in 2025, fetched 7 Oct 2026 (PolicyEngine UK 2.102.3).
const baseline = fixture("pe-households-baseline-2025.json");
const vat21 = fixture("pe-households-vat21-2025.json");
const fuel5 = fixture("pe-households-fuel5-2025.json");
const pension5 = fixture("pe-households-pension5-2025.json");

const CONSUMPTION = SPENDING_VARIABLES.filter((v) => v.endsWith("_consumption"));
/** £ a year a household spends on the twelve COICOP groups. */
const consumption = (id: ArchetypeId) => CONSUMPTION.reduce((sum, v) => sum + annualSpending(id)[v], 0);
// PolicyEngine UK's pump prices for 2025 (household.consumption.fuel.prices, £ a litre) and fuel duty (gov.hmrc.fuel_duty.petrol_and_diesel).
const PETROL_PRICE = 1.44;
const DIESEL_PRICE = 1.52;
const FUEL_DUTY = 0.5295;
const litres = (id: ArchetypeId) => annualSpending(id).petrol_spending / PETROL_PRICE + annualSpending(id).diesel_spending / DIESEL_PRICE;
const rows = (reform: { response: { result: unknown } }) => householdRows(readNetIncomes(baseline.response.result, 2025), readNetIncomes(reform.response.result, 2025));

describe("T1 example households", () => {
  it("builds one situation holding every archetype as its own household in England", () => {
    const s = archetypeSituation(2025);
    expect(Object.keys(s.households)).toEqual(ARCHETYPES.map((a) => a.id));
    for (const h of Object.values(s.households)) {
      expect(h.region).toEqual({ "2025": "EAST_MIDLANDS" });
      expect(h.household_net_income).toEqual({ "2025": null });
    }
    expect(s.households.couple_two_children!.members).toHaveLength(4);
    expect(s.people.couple_two_children_1!.employment_income).toEqual({ "2025": 35_000 });
    expect(s.people.couple_two_children_2!.employment_income).toEqual({ "2025": 15_000 });
    expect(s.people.lone_parent_2!.age).toEqual({ "2025": 5 });
  });

  it("gives every household its ONS spending a year: the weekly average × 52", () => {
    const s = archetypeSituation(2025);
    for (const { id } of ARCHETYPES) {
      for (const v of SPENDING_VARIABLES) expect(s.households[id]![v]).toEqual({ "2025": annualSpending(id)[v] });
    }
    // A26, second gross income quintile, transport: £48.90 a week.
    expect(s.households.single_25k!.transport_consumption).toEqual({ "2025": 2_542.8 });
    // A23, retired couple mainly on State Pension: ONS ":" for education (nobody recorded any).
    expect(s.households.pensioner_couple!.education_consumption).toEqual({ "2025": 0 });
  });

  it("keeps the spending seed sourced and consistent", () => {
    const { meta, archetypes } = ARCHETYPE_SPENDING;
    expect(meta.edition).toBe("Family spending in the UK: April 2024 to March 2025");
    for (const s of meta.sources) expect(s.url).toMatch(/^https:\/\/www\.ons\.gov\.uk\//);
    for (const { id } of ARCHETYPES) {
      const a = archetypes[id];
      // The twelve groups add up to ONS's published 1-12 total for the row (suppressed groups are its remainder).
      const weekly = CONSUMPTION.reduce((sum, v) => sum + a.weekly[v].gbp, 0);
      expect(weekly).toBeCloseTo(a.total_1_12_week, 2);
      // Every derived value says how it was derived.
      for (const v of SPENDING_VARIABLES) if (a.weekly[v].quality === "approx") expect(a.weekly[v].note).toBeTruthy();
      expect(a.weekly.petrol_spending.quality).toBe("approx");
      expect(a.weekly.petrol_spending.gbp).toBeGreaterThan(a.weekly.diesel_spending.gbp);
    }
    // Composition and income where ONS publishes both; composition alone otherwise.
    expect(archetypes.single_120k.row).toMatchObject({ table: "A26", column: "Highest twenty per cent" });
    expect(archetypes.lone_parent.row).toMatchObject({ table: "A23", column: "One adult with one child" });
  });

  it("gives the pensioners the full new State Pension for the year, so a pension change reaches them", () => {
    expect(fullNewStatePension(2025)).toBe(11_973); // £230.25 a week
    expect(fullNewStatePension(2026)).toBe(12_547.6); // £241.30 a week
    const s = archetypeSituation(2025);
    expect(s.people.pensioner_couple_1).toMatchObject({ state_pension_type: { "2025": "NEW" }, state_pension_reported: { "2025": 11_973 } });
  });

  it("matches the situation the fixtures were fetched with", () => {
    for (const f of [baseline, vat21, fuel5, pension5]) expect(f.request.household).toEqual(archetypeSituation(2025));
    expect(baseline.request.policy).toEqual({});
  });

  it("reads plausible net incomes under current law: earnings and benefits less tax, including the fuel duty paid", () => {
    const net = readNetIncomes(baseline.response.result, 2025);
    // PolicyEngine's net income takes off all fuel duty paid, but VAT only as a change from current law.
    const less = (id: ArchetypeId, beforeFuel: number) => expect(net[id]).toBeCloseTo(beforeFuel - litres(id) * FUEL_DUTY, 1);
    // Single £25k: 25,000 − income tax 2,486 − NI 994.40 − TV licence 174.50.
    less("single_25k", 21_345.05);
    less("single_45k", 35_745.05);
    // £120k: personal allowance tapered to £2,570.
    less("single_120k", 75_982.86);
    // £50k between them, two children: Child Benefit £2,251.60, no Universal Credit.
    less("couple_two_children", 45_116.25);
    // £18k and one child: Universal Credit and Child Benefit on top of earnings.
    less("lone_parent", 21_425.67);
    // Two full new State Pensions (£23,946) plus the Winter Fuel Payment, less the TV licence.
    less("pensioner_couple", 23_971.46);
    expect(net.single_25k).toBeCloseTo(21_106.74, 2);
  });

  it("moves every household when VAT rises to 21%: 1 point on half its spending, grossed up by 1/0.38", () => {
    for (const r of rows(vat21)) {
      expect(r.change_gbp).toBeLessThan(0);
      expect(r.change_gbp).toBeCloseTo((-consumption(r.id as ArchetypeId) * 0.5 * 0.01) / 0.38, 1);
    }
    const byId = Object.fromEntries(rows(vat21).map((r) => [r.id, r.change_gbp]));
    expect(byId.single_25k).toBeCloseTo(-228.46, 2);
    // More spending, more VAT: the £120k single spends most of the singles, the family most of all.
    expect(byId.single_120k!).toBeLessThan(byId.single_45k!);
    expect(byId.single_45k!).toBeLessThan(byId.single_25k!);
    expect(byId.couple_two_children!).toBeLessThan(byId.single_120k!);
  });

  it("moves every household when fuel duty rises 5p: 5p on each litre of petrol and diesel", () => {
    for (const r of rows(fuel5)) {
      expect(r.change_gbp).toBeLessThan(0);
      expect(r.change_gbp).toBeCloseTo(-litres(r.id as ArchetypeId) * 0.05, 1);
    }
    expect(rows(fuel5).find((r) => r.id === "couple_two_children")!.change_gbp).toBeCloseTo(-55.53, 2);
  });

  it("moves the pensioners, and only them, when the State Pension rises 5%", () => {
    const byId = Object.fromEntries(rows(pension5).map((r) => [r.id, r]));
    expect(byId.pensioner_couple!.change_gbp).toBeGreaterThan(1_000);
    expect(byId.pensioner_couple!.change_gbp).toBeCloseTo(1_196.64, 2);
    for (const r of rows(pension5).filter((r) => r.id !== "pensioner_couple")) expect(r.change_gbp).toBe(0);
    expect(rows(pension5).map((r) => r.label)).toEqual(ARCHETYPES.map((a) => a.label));
  });

  it("refuses an answer without a household's net income", () => {
    expect(() => readNetIncomes({ households: {} }, 2025)).toThrow(/bad_household_result/);
  });
});
