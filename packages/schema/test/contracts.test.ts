import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ContractFile, ContractRef, contractAppendOnlyIssues, contractChange, contractKey, contractTotals, monthsBetween } from "../src/contracts";
import { PromiseFile as PromiseSchema, cardViews, type ActorFile, type PromiseFile } from "../src/content";

const contract = (over: Partial<ContractFile> = {}) => ({
  key: "ocds-h6vhtk-0525b3",
  ocid: "ocds-h6vhtk-0525b3",
  source: "find_a_tender" as const,
  title: "Peatland restoration",
  buyer: "Durham County Council",
  notice_url: "https://www.find-tender.service.gov.uk/Notice/092299-2026",
  record_url: "https://www.find-tender.service.gov.uk/api/1.0/ocdsRecordPackages/ocds-h6vhtk-0525b3",
  supplier: { name: "Dinsdale Moorland Specialists Ltd", companies_house_number: "09442333" },
  awarded_on: "2026-09-30",
  bids_received: 4,
  snapshots: [{ fetched_at: "2026-10-01", value: { amount: 400_000, currency: "GBP" }, end_date_planned: "2027-03-31" }],
  ...over,
});

describe("contract files (M6b)", () => {
  it("parses a fetched contract", () => {
    expect(ContractFile.safeParse(contract()).success).toBe(true);
  });

  it("names the file after the OCID, and the award when one is given", () => {
    expect(contractKey("ocds-h6vhtk-0525b3")).toBe("ocds-h6vhtk-0525b3");
    expect(contractKey({ ocid: "ocds-h6vhtk-0525b3", award_id: "2" })).toBe("ocds-h6vhtk-0525b3--award-2");
    expect(ContractFile.safeParse(contract({ key: "something-else" })).success).toBe(false);
  });

  it("accepts an OCID or an object as a card's link, nothing else", () => {
    expect(ContractRef.safeParse("ocds-h6vhtk-0525b3").success).toBe(true);
    expect(ContractRef.safeParse({ ocid: "ocds-b5fd17-d7d85349-e804-415b-968b-b7fd2fe98fd5", notice_url: "https://www.contractsfinder.service.gov.uk/Notice/69eb20f9-3534-4eba-a223-4cedc2330e41" }).success).toBe(true);
    expect(ContractRef.safeParse("092299-2026").success).toBe(false);
    expect(ContractRef.safeParse({ ocid: "ocds-h6vhtk-0525b3", supplier: "x" }).success).toBe(false);
  });

  it("keeps bids per lot when one award covers several lots", () => {
    expect(ContractFile.safeParse(contract({ bids_received: undefined, bids_received_by_lot: [15, 14, 16] })).success).toBe(true);
    expect(ContractFile.safeParse(contract({ bids_received_by_lot: [15] })).success).toBe(false);
  });

  it("keeps snapshots in date order", () => {
    const c = contract();
    c.snapshots = [c.snapshots[0]!, { ...c.snapshots[0]!, fetched_at: "2026-09-01" }];
    expect(ContractFile.safeParse(c).success).toBe(false);
  });
});

describe("what changed", () => {
  const grown = contract({
    snapshots: [
      { fetched_at: "2026-10-01", value: { amount: 400_000, currency: "GBP" }, end_date_planned: "2027-03-31" },
      { fetched_at: "2027-02-01", value: { amount: 460_000, currency: "GBP" }, end_date_planned: "2027-09-30" },
      { fetched_at: "2027-11-01", value: { amount: 460_000, currency: "GBP" }, end_date_planned: "2027-09-30", end_date_actual: "2027-10-31" },
    ],
  });

  it("compares the first value and end date with the latest", () => {
    const c = contractChange(grown);
    expect(c.valueDelta).toBe(60_000);
    expect(c.valueDeltaPct).toBeCloseTo(15);
    expect(c.endFirst).toBe("2027-03-31");
    expect(c.endNow).toBe("2027-10-31");
    expect(c.finished).toBe(true);
    expect(c.monthsLate).toBe(7);
  });

  it("counts months either way", () => {
    expect(monthsBetween("2027-03-31", "2027-03-31")).toBe(0);
    expect(monthsBetween("2027-03-31", "2026-12-31")).toBe(-3);
  });

  it("totals an actor's contracts with a median delay", () => {
    const t = contractTotals([grown, contract(), contract()]);
    expect(t).toEqual({ count: 3, valueDelta: 60_000, medianMonthsLate: 0 });
    expect(contractTotals([]).medianMonthsLate).toBeNull();
  });
});

describe("snapshots are append-only", () => {
  const was = contract();
  const next = { fetched_at: "2027-02-01", value: { amount: 460_000, currency: "GBP" }, end_date_planned: "2027-09-30" };

  it("allows a new snapshot at the end", () => {
    expect(contractAppendOnlyIssues(was, { ...was, snapshots: [...was.snapshots, next] })).toEqual([]);
  });

  it("rejects an edited snapshot", () => {
    const edited = { ...was, snapshots: [{ ...was.snapshots[0]!, value: { amount: 1, currency: "GBP" } }] };
    expect(contractAppendOnlyIssues(was, edited)[0]).toMatch(/snapshots\[0\] was changed or removed/);
  });

  it("rejects a removed snapshot and a changed identity", () => {
    expect(contractAppendOnlyIssues(was, { ...was, snapshots: [] })).toHaveLength(1);
    expect(contractAppendOnlyIssues(was, { ...was, ocid: "ocds-h6vhtk-000001" })[0]).toMatch(/ocid changed/);
  });

  it("lets descriptive fields be refreshed", () => {
    expect(contractAppendOnlyIssues(was, { ...was, bids_received: 5, title: "Peatland restoration, phase 2" })).toEqual([]);
  });
});

describe("cards with contracts", () => {
  // A real card, with links added: one fetched, one not yet.
  const file = readFileSync(join(import.meta.dirname, "../../../content/promises/uk-great-british-energy-2024.yaml"), "utf8");
  const card: PromiseFile = { ...PromiseSchema.parse(parse(file)), contracts: ["ocds-h6vhtk-0525b3", "ocds-h6vhtk-999999"] };
  const actors: ActorFile[] = [{ id: card.actor_id, name: "Speaker", kind: "party", roles: [] }];

  it("joins fetched contracts and skips ones not fetched yet", () => {
    const [view] = cardViews([card], actors, [ContractFile.parse(contract())]);
    expect(view!.contracts.map((c) => c.id)).toEqual([`${card.id}:ocds-h6vhtk-0525b3`]);
    expect(view!.contracts[0]!.promise_id).toBe(card.id);
  });
});
