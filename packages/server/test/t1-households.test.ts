import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "@ledger/schema";
import { archetypeSituation, fullNewStatePension, householdRows, readNetIncomes } from "../src/model";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/t1/${name}`, import.meta.url), "utf8"));
// Real /uk/calculate answers for the six archetypes in 2025, fetched 7 Oct 2026.
const baseline = fixture("pe-households-baseline-2025.json");
const vat21 = fixture("pe-households-vat21-2025.json");
const pension5 = fixture("pe-households-pension5-2025.json");

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

  it("gives the pensioners the full new State Pension for the year, so a pension change reaches them", () => {
    expect(fullNewStatePension(2025)).toBe(11_973); // £230.25 a week
    expect(fullNewStatePension(2026)).toBe(12_547.6); // £241.30 a week
    const s = archetypeSituation(2025);
    expect(s.people.pensioner_couple_1).toMatchObject({ state_pension_type: { "2025": "NEW" }, state_pension_reported: { "2025": 11_973 } });
  });

  it("matches the situation the fixtures were fetched with", () => {
    expect(baseline.request.household).toEqual(archetypeSituation(2025));
    expect(baseline.request.policy).toEqual({});
  });

  it("reads plausible net incomes under current law", () => {
    const net = readNetIncomes(baseline.response.result, 2025);
    // Single £25k: 25,000 − income tax 2,486 − NI 994.40 − TV licence 174.50.
    expect(net.single_25k).toBeCloseTo(21_345.05, 2);
    expect(net.single_45k).toBeCloseTo(35_745.05, 2);
    // £120k: personal allowance tapered to £2,570.
    expect(net.single_120k).toBeCloseTo(75_982.86, 2);
    // £50k between them, two children: Child Benefit £2,251.60, no Universal Credit.
    expect(net.couple_two_children).toBeCloseTo(45_116.25, 2);
    // £18k and one child: Universal Credit and Child Benefit on top of earnings.
    expect(net.lone_parent).toBeGreaterThan(18_000);
    // Two full new State Pensions (£23,946) plus the Winter Fuel Payment, less the TV licence.
    expect(net.pensioner_couple).toBeCloseTo(23_971.46, 2);
  });

  it("moves the pensioners, and only them, when the State Pension rises 5%", () => {
    const rows = householdRows(readNetIncomes(baseline.response.result, 2025), readNetIncomes(pension5.response.result, 2025));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.pensioner_couple!.change_gbp).toBeGreaterThan(1_000);
    expect(byId.pensioner_couple!.change_gbp).toBeCloseTo(1_196.64, 2);
    for (const r of rows.filter((r) => r.id !== "pensioner_couple")) expect(r.change_gbp).toBe(0);
    expect(rows.map((r) => r.label)).toEqual(ARCHETYPES.map((a) => a.label));
  });

  it("shows no change for VAT: the example households have no spending inputs (known gap)", () => {
    const rows = householdRows(readNetIncomes(baseline.response.result, 2025), readNetIncomes(vat21.response.result, 2025));
    for (const r of rows) expect(r.change_gbp).toBe(0);
  });

  it("refuses an answer without a household's net income", () => {
    expect(() => readNetIncomes({ households: {} }, 2025)).toThrow(/bad_household_result/);
  });
});
