import { describe, expect, it } from "vitest";
import { Lever, stepValues } from "../src/levers";
import { parseSeed, rawSeed, type RawSeed } from "../src/seed";

/** A stepped lever as the ETL writes it (HMRC's capital gains tax steps, central values in £bn). */
const stepped = () => ({
  id: "cgt_test",
  label: "Capital gains tax, test rate",
  group: "taxes",
  controlled_by: "government",
  unit: "pp",
  base: 24,
  min: 24,
  max: 34,
  step: 1,
  effect: {
    target: "cgt",
    steps: [
      { at: 1, y1: [-0.0165, -0.015, -0.0135], y5: [-0.033, -0.03, -0.027] },
      { at: 5, y1: [-0.187, -0.17, -0.153] },
      { at: 10, y1: [-0.594, -0.54, -0.486], y5: [-3.9215, -3.565, -3.2085] },
    ],
  } as Record<string, unknown>,
  quality: "sourced",
  source_id: "hmrc_reckoner",
});

const messages = (lever: unknown) => {
  const r = Lever.safeParse(lever);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("stepped levers (schema)", () => {
  it("accept a lever with steps and no per_unit_bn", () => {
    expect(messages(stepped())).toEqual([]);
  });

  it("need exactly one of per_unit_bn or steps", () => {
    const both = stepped();
    both.effect.per_unit_bn = { y1: [1, 2, 3] };
    expect(messages(both)).toContain("a lever needs exactly one of per_unit_bn or steps");

    const neither = stepped();
    delete neither.effect.steps;
    expect(messages(neither)).toContain("a lever needs exactly one of per_unit_bn or steps");

    const perUnit = stepped();
    delete perUnit.effect.steps;
    perUnit.effect.per_unit_bn = { y1: [1, 2, 3] };
    Object.assign(perUnit, { min: 20, max: 30 });
    expect(messages(perUnit)).toEqual([]);
  });

  it("need steps above base, in ascending order, each one different", () => {
    const zero = stepped();
    (zero.effect.steps as { at: number }[])[0]!.at = 0;
    expect(messages(zero).length).toBeGreaterThan(0);

    const unordered = stepped();
    const steps = unordered.effect.steps as { at: number }[];
    [steps[0]!.at, steps[1]!.at] = [5, 1];
    expect(messages(unordered)).toContain("steps must be in ascending order, each one different");

    const repeated = stepped();
    (repeated.effect.steps as { at: number }[])[1]!.at = 1;
    expect(messages(repeated)).toContain("steps must be in ascending order, each one different");

    const empty = stepped();
    empty.effect.steps = [];
    expect(messages(empty).length).toBeGreaterThan(0);
  });

  it("start at base and end at the last step", () => {
    expect(messages({ ...stepped(), min: 20 })).toContain("a stepped lever starts at its base (min must equal base)");
    expect(messages({ ...stepped(), max: 40 })).toContain("a stepped lever ends at its last step (max must equal base plus the last step)");
    // Bases are published figures (e.g. 52.95p): floating-point dust is not an error.
    expect(messages({ ...stepped(), base: 0.1 + 0.2, min: 0.3, max: 10.3 })).toEqual([]);
  });

  it("are never toggles", () => {
    expect(messages({ ...stepped(), unit: "toggle", base: 0, min: 0, max: 1 })).toContain("a toggle cannot have steps");
  });

  it("carry no per-unit price effect", () => {
    const priced = stepped();
    priced.effect.cpi_pp_per_unit = [0.1, 0.2, 0.3];
    priced.effect.cpi_provenance = { quality: "approx", source_id: "x", method_note: "test" };
    expect(messages(priced)).toContain("a stepped lever cannot scale a per-unit price effect");
  });

  it("list today's value and each step as the values it offers", () => {
    expect(stepValues(stepped() as unknown as Lever)).toEqual([24, 25, 29, 34]);
  });
});

describe("stepped levers (cross-checks)", () => {
  const withSetting = (value: number) => {
    const raw = structuredClone(rawSeed()) as RawSeed;
    (raw.presets as any).presets[0].settings = { cgt_higher: value };
    return parseSeed(raw).issues.filter((i) => i.level === "error").map((i) => i.message);
  };
  const higher = () => (rawSeed().bundle as any).levers.levers.find((l: any) => l.id === "cgt_higher");

  it("accept a preset on one of the steps", () => {
    expect(withSetting(higher().base + 5)).toEqual([]);
  });

  it("reject a preset between steps", () => {
    expect(withSetting(higher().base + 3).some((m) => m.includes("not one of the lever's steps"))).toBe(true);
  });
});
