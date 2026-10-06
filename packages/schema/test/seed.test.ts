import { describe, expect, it } from "vitest";
import { RAW_SEED, loadSeed, parseSeed, type RawSeed } from "../src/seed";

const clone = (): RawSeed => structuredClone(RAW_SEED) as RawSeed;
const errorsOf = (raw: RawSeed) => parseSeed(raw).issues.filter((i) => i.level === "error");

describe("seed files", () => {
  it("parse and cross-check without errors", () => {
    const { seed, issues } = parseSeed();
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(seed).not.toBeNull();
  });

  it("give every lever an owner (invariant 3)", () => {
    const seed = loadSeed();
    for (const l of seed.levers.levers) expect(l.controlled_by).toBeTruthy();
    expect(seed.levers.levers.find((l) => l.id === "bank_rate")?.controlled_by).toBe("central_bank");
  });

  it("turn the bus card into a promise preset", () => {
    const seed = loadSeed();
    const bus = seed.presets.find((p) => p.promise_id === "uk-bus-cap-2-2026");
    expect(bus?.settings).toEqual({ bus_cap_2: 1, "bus_cap_2.funding": "climate_loans" });
  });
});

describe("validation rejects", () => {
  it("a quality label outside the four allowed", () => {
    const raw = clone();
    (raw.statement as any).receipts[0].quality = "approx-sum-checked";
    expect(errorsOf(raw).length).toBeGreaterThan(0);
  });

  it("a training value without a TODO(source) note", () => {
    const raw = clone();
    (raw.levers as any).levers[1].method_note = "from memory";
    expect(errorsOf(raw).some((e) => e.message.includes("TODO(source)"))).toBe(true);
  });

  it("an approx value without a method note", () => {
    const raw = clone();
    delete (raw.statement as any).spending[0].method_note;
    expect(errorsOf(raw).some((e) => e.message.includes("method_note"))).toBe(true);
  });

  it("a lever with no owner", () => {
    const raw = clone();
    delete (raw.levers as any).levers[0].controlled_by;
    expect(errorsOf(raw).length).toBeGreaterThan(0);
  });

  it("a statement that does not balance", () => {
    const raw = clone();
    (raw.statement as any).receipts[0].bn += 1;
    expect(errorsOf(raw).some((e) => e.message.includes("does not balance"))).toBe(true);
  });

  it("a source id that resolves to nothing", () => {
    const raw = clone();
    (raw.statement as any).spending[0].source_id = "nowhere";
    expect(errorsOf(raw).some((e) => e.message.includes("unknown source_id"))).toBe(true);
  });

  it("a preset that sets a lever outside its range", () => {
    const raw = clone();
    (raw.presets as any).presets[0].settings.defence_gdp = 9;
    expect(errorsOf(raw).some((e) => e.message.includes("outside"))).toBe(true);
  });

  it("a scoreable card without parameters", () => {
    const raw = clone();
    (raw.promises as any).promises[0].parameters = null;
    expect(errorsOf(raw).length).toBeGreaterThan(0);
  });

  it("a lever pointing at a line that does not exist", () => {
    const raw = clone();
    (raw.levers as any).levers[0].effect.target = "nothing";
    expect(errorsOf(raw).some((e) => e.message.includes("not a statement line"))).toBe(true);
  });
});
