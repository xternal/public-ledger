import { describe, expect, it } from "vitest";
import { rawSeed, loadSeed, parseSeed, type RawSeed } from "../src/seed";

const clone = (): RawSeed => structuredClone(rawSeed()) as RawSeed;
const errorsOf = (raw: RawSeed) => parseSeed(raw).issues.filter((i) => i.level === "error");
/** The base year's statement inside a cloned bundle, for mutation. */
const baseStatement = (raw: RawSeed) => {
  const b = raw.bundle as any;
  return b.statements[b.base_year];
};
const levers = (raw: RawSeed) => (raw.bundle as any).levers;
const actor = (raw: RawSeed, id: string) => raw.content.actors.find((f) => f.path.endsWith(`${id}.yaml`))!.data as any;
const bus = (raw: RawSeed) => raw.content.promises.find((f) => f.path.endsWith("uk-bus-cap-2-2026.yaml"))!.data as any;

describe("build bundle and seed files", () => {
  it("parse and cross-check without errors", () => {
    const { seed, issues } = parseSeed();
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(seed).not.toBeNull();
  });

  it("carry a statement for every listed year, and the base year is one of them", () => {
    const seed = loadSeed();
    expect(seed.years.length).toBeGreaterThan(1);
    for (const y of seed.years) expect(seed.statements[y.period]?.meta.fiscal_year).toBe(y.period);
    expect(seed.years.map((y) => y.period)).toContain(seed.baseYear);
  });

  it("give every lever an owner (invariant 3)", () => {
    const seed = loadSeed();
    for (const l of seed.levers.levers) expect(l.controlled_by).toBeTruthy();
    expect(seed.levers.levers.find((l) => l.id === "bank_rate")?.controlled_by).toBe("central_bank");
  });

  it("have no training values left in levers that HMRC or the OBR cover (M1)", () => {
    const seed = loadSeed();
    for (const l of seed.levers.levers) {
      if (["income_tax_basic", "nics_main", "vat_standard", "corp_tax", "bank_rate"].includes(l.id)) expect(l.quality).not.toBe("training");
    }
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
    baseStatement(raw).receipts[0].quality = "approx-sum-checked";
    expect(errorsOf(raw).length).toBeGreaterThan(0);
  });

  it("a training value without a TODO(source) note", () => {
    const raw = clone();
    levers(raw).macro_rules.quality = "training";
    levers(raw).macro_rules.method_note = "from memory";
    expect(errorsOf(raw).some((e) => e.message.includes("TODO(source)"))).toBe(true);
  });

  it("an estimate without a method note", () => {
    const raw = clone();
    const line = baseStatement(raw).spending.find((l: any) => l.quality === "approx");
    delete line.method_note;
    expect(errorsOf(raw).some((e) => e.message.includes("method_note"))).toBe(true);
  });

  it("a lever with no owner", () => {
    const raw = clone();
    delete levers(raw).levers[0].controlled_by;
    expect(errorsOf(raw).length).toBeGreaterThan(0);
  });

  it("a statement that does not balance", () => {
    const raw = clone();
    baseStatement(raw).receipts[0].bn += 1;
    expect(errorsOf(raw).some((e) => e.message.includes("does not balance"))).toBe(true);
  });

  it("a source id that resolves to nothing", () => {
    const raw = clone();
    baseStatement(raw).spending[0].source_id = "nowhere";
    expect(errorsOf(raw).some((e) => e.message.includes("unknown source_id"))).toBe(true);
  });

  it("a listed year with no statement", () => {
    const raw = clone();
    (raw.bundle as any).years.push({ period: "2040-41", kind: "forecast" });
    expect(errorsOf(raw).some((e) => e.message.includes("no statement"))).toBe(true);
  });

  it("a preset that sets a lever outside its range", () => {
    const raw = clone();
    (raw.presets as any).presets[0].settings.defence_gdp = 9;
    expect(errorsOf(raw).some((e) => e.message.includes("outside"))).toBe(true);
  });

  it("a scoreable card without parameters", () => {
    const raw = clone();
    const card = bus(raw);
    card.versions[card.versions.length - 1].parameters = null;
    expect(errorsOf(raw).some((e) => e.message.includes("parameters are required"))).toBe(true);
  });

  it("a status event without evidence", () => {
    const raw = clone();
    const card = bus(raw);
    card.events.push({ date: "2026-08-01", type: "funded", text: "Money found" });
    expect(errorsOf(raw).some((e) => e.message.includes("needs an evidence_url"))).toBe(true);
  });

  it("versions out of order", () => {
    const raw = clone();
    bus(raw).versions[0].version = 2;
    expect(errorsOf(raw).some((e) => e.message.includes("numbered"))).toBe(true);
  });

  it("a cost given as a single point", () => {
    const raw = clone();
    const card = bus(raw);
    card.versions[card.versions.length - 1].parameters.how_much_bn_per_year = [0.5, 0.5, 0.5];
    expect(errorsOf(raw).some((e) => e.message.includes("low–high range"))).toBe(true);
  });

  it("submission credit on a card that did not start from a submission", () => {
    const raw = clone();
    const card = bus(raw);
    card.origin = "manual";
    card.credit = "reader42";
    expect(errorsOf(raw).some((e) => e.message.includes("origin: reader_submission"))).toBe(true);
  });

  it("a correction that does not match the card", () => {
    const raw = clone();
    const card = bus(raw);
    card.corrections = [{ date: "2026-10-07", path: "events[0].date", was: "2000-01-01", now: "1999-12-31", reason: "test" }];
    expect(errorsOf(raw).some((e) => e.message.includes("does not match this correction"))).toBe(true);
    card.corrections = [{ date: "2026-10-07", path: "events[99].date", was: null, now: null, reason: "test" }];
    expect(errorsOf(raw).some((e) => e.message.includes("does not exist in this card"))).toBe(true);
  });

  it("a card without sources", () => {
    const raw = clone();
    bus(raw).sources = [];
    expect(errorsOf(raw).some((e) => e.message.includes("at least one source"))).toBe(true);
  });

  it("a card whose actor does not exist", () => {
    const raw = clone();
    bus(raw).actor_id = "nobody";
    expect(errorsOf(raw).some((e) => e.message.includes("unknown actor_id"))).toBe(true);
  });

  it("a Parliament id on the wrong kind of actor", () => {
    const raw = clone();
    actor(raw, "labour").parliament_member_id = 4263;
    actor(raw, "lucy-powell").parliament_party_id = 15;
    const errors = errorsOf(raw).map((e) => e.message);
    expect(errors).toContain("only a person has a parliament_member_id");
    expect(errors).toContain("only a party has a parliament_party_id");
  });

  it("two actors with the same Parliament id", () => {
    const raw = clone();
    actor(raw, "rachel-reeves").parliament_member_id = actor(raw, "lucy-powell").parliament_member_id;
    expect(errorsOf(raw).some((e) => e.message.includes("Parliament member 4263 is already"))).toBe(true);
  });

  it("a card whose id does not match its file name", () => {
    const raw = clone();
    bus(raw).id = "something-else";
    expect(errorsOf(raw).some((e) => e.message.includes("does not match the file name"))).toBe(true);
  });

  it("a lever pointing at a line that does not exist", () => {
    const raw = clone();
    levers(raw).levers[0].effect.target = "nothing";
    expect(errorsOf(raw).some((e) => e.message.includes("not a statement line"))).toBe(true);
  });
});
