import { describe, expect, it } from "vitest";
import peopleRaw from "../../../data/build/people.json";
import { loadPeople } from "../src/people-data";
import { PeopleBundle } from "../src/people";

const clone = () => structuredClone(peopleRaw) as any;

describe("people.json (M6)", () => {
  it("parses", () => {
    const p = loadPeople();
    expect(p.variants.map((v) => v.code)).toContain("ppp");
    expect(p.spending.scenarios[0]!.id).toBe("baseline");
  });

  it("cites only sources it lists, with a vintage on every series", () => {
    const p = loadPeople();
    const ids = new Set(p.sources.map((s) => s.id));
    const provs = [
      ...Object.values(p.charts).map((c) => c.provenance),
      p.charts.births.past.provenance!,
      p.charts.deaths.past.provenance!,
      p.spending.provenance,
      ...p.spending.scenarios,
    ];
    for (const prov of provs) {
      expect(ids.has(prov.source_id)).toBe(true);
      expect(prov.vintage).toBeTruthy();
    }
  });

  it("shows projections as ranges around the principal projection (invariant 2)", () => {
    const p = loadPeople();
    for (const c of Object.values(p.charts)) {
      c.range.forEach(([lo, mid, hi], i) => {
        expect(lo).toBeLessThanOrEqual(mid);
        expect(mid).toBeLessThanOrEqual(hi);
        expect(mid).toBeCloseTo(c.variants.ppp![i]!, 3);
      });
    }
    p.spending.range.forEach(([, mid], i) => expect(mid).toBeCloseTo(p.spending.scenarios[0]!.values[i]!, 3));
  });

  it("gives every assumption an owner (invariant 3): demography, and the state pension age to the government", () => {
    const p = loadPeople();
    const by = Object.fromEntries(p.assumptions.map((a) => [a.id, a]));
    for (const id of ["fertility", "migration", "life_expectancy"]) expect(by[id]!.controlled_by).toBe("demography");
    expect(by.state_pension_age!.controlled_by).toBe("government");
    // Every option points at a published variant.
    const codes = new Set(p.variants.map((v) => v.code));
    for (const a of p.assumptions) for (const o of a.options) expect(codes.has(o.variant)).toBe(true);
  });

  it("marks worked-out numbers as estimates with a method", () => {
    const p = loadPeople();
    expect(p.charts.workers.provenance.quality).toBe("approx");
    expect(p.charts.workers.provenance.method_note).toMatch(/^Computed from ONS projections/);
    for (const s of p.spending.scenarios.slice(1)) {
      expect(s.quality).toBe("approx");
      expect(s.method_note).toBeTruthy();
    }
  });

  it("rejects a chart without the principal projection, an unordered range, or a computed value without a method", () => {
    const a = clone();
    delete a.charts.oadr.variants.ppp;
    expect(PeopleBundle.safeParse(a).success).toBe(false);
    const b = clone();
    b.charts.workers.range[3] = [3, 2, 1];
    expect(PeopleBundle.safeParse(b).success).toBe(false);
    const c = clone();
    delete c.spending.scenarios[1].method_note;
    expect(PeopleBundle.safeParse(c).success).toBe(false);
  });
});
