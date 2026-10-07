import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { T1Response, type Settings } from "@ledger/schema";
import { testDb, type Db } from "../src/db";
import {
  ERROR_RETRY_MS,
  PENDING_LIMIT_MS,
  PolicyEngineError,
  getT1,
  householdRows,
  readNetIncomes,
  toT1Population,
  type LeverModel,
  type SimulateStep,
  type T1Household,
  type T1Provider,
} from "../src/model";

const read = (url: URL) => JSON.parse(readFileSync(url, "utf8"));
const fixture = (name: string) => read(new URL(`./fixtures/t1/${name}`, import.meta.url));
const model: LeverModel = read(new URL("../../../data/build/levers.json", import.meta.url));
const vatEconomy = fixture("pe-economy-vat21-2025.json").result;
const households: T1Household[] = householdRows(
  readNetIncomes(fixture("pe-households-baseline-2025.json").response.result, 2025),
  readNetIncomes(fixture("pe-households-vat21-2025.json").response.result, 2025),
);

const base = (): Settings => Object.fromEntries(model.levers.map((l) => [l.id, l.base]));
const VAT21 = { ...base(), vat_standard: 21 };

/**
 * A provider that behaves like PolicyEngine: registering returns policy 93107;
 * the economy answer is "computing" until `ready`, then the real VAT result.
 */
function fakeProvider() {
  const state = { ready: false, fail: null as PolicyEngineError | null, simulate: [] as (number | null)[], households: 0 };
  const provider: T1Provider = {
    name: "policyengine_api",
    async simulate(_reform, startYear, handle, now): Promise<SimulateStep> {
      state.simulate.push(handle);
      if (state.fail) throw state.fail;
      if (handle === null) return { status: "pending", handle: 93107 };
      if (!state.ready) return { status: "pending", handle };
      return { status: "ok", handle, ...toT1Population(vatEconomy, { policyId: handle, startYear, fetchedAt: now }) };
    },
    async households() {
      state.households++;
      if (state.fail) throw state.fail;
      return households;
    },
  };
  return { provider, state };
}

const T0 = new Date("2026-10-07T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const req = (settings: Settings = VAT21, scenario = "vat21") => ({ scenario, year: "2025-26", model, settings });

describe("T1 service", () => {
  let db: Db;
  let fake: ReturnType<typeof fakeProvider>;
  const deps = (now: Date, extra: Partial<Parameters<typeof getT1>[2]> = {}) => ({
    provider: fake.provider,
    clientKey: "203.0.113.7",
    now,
    log: () => undefined,
    ...extra,
  });
  const row = async (scenario = "vat21") =>
    (await db.query<{ status: string; policy_id: number | null; error: string | null; polls: number }>(
      "SELECT status, policy_id, error, polls FROM t1_result WHERE scenario = $1",
      [scenario],
    ))[0];

  beforeEach(async () => {
    db = await testDb();
    fake = fakeProvider();
  });

  it("answers not_applicable, without calling the provider, when no T1 lever changed", async () => {
    const a = await getT1(db, req({ ...base(), bank_rate: 4.5 }), deps(T0));
    expect(a).toEqual({ response: { status: "not_applicable", not_modelled: ["bank_rate"] }, httpStatus: 200, outcome: "not_applicable" });
    expect(fake.state.simulate).toEqual([]);
    expect(await row()).toBeUndefined();
  });

  it("goes pending, then ok, then answers from the cache", async () => {
    // 1. First request: register the reform and compute the households, in one round.
    const first = await getT1(db, req(), deps(T0));
    expect(first).toEqual({ response: { status: "pending", retry_after_s: 5 }, httpStatus: 202, outcome: "started" });
    expect(fake.state.simulate).toEqual([null]);
    expect(fake.state.households).toBe(1);
    expect(await row()).toMatchObject({ status: "pending", policy_id: 93107, polls: 0 });

    // 2. PolicyEngine still computing: one check, still pending.
    const second = await getT1(db, req(), deps(at(5_000)));
    expect(second.response.status).toBe("pending");
    expect(second.outcome).toBe("pending");
    expect(fake.state.simulate).toEqual([null, 93107]);
    expect(await row()).toMatchObject({ status: "pending", polls: 1 });

    // 3. Ready: the full result, valid against the contract.
    fake.state.ready = true;
    const third = await getT1(db, req(), deps(at(70_000)));
    expect(third.httpStatus).toBe(200);
    expect(third.outcome).toBe("ready");
    const parsed = T1Response.parse(third.response);
    if (parsed.status !== "ok") throw new Error("expected ok");
    expect(parsed.result.scenario).toBe("vat21");
    expect(parsed.result.year).toBe("2025-26");
    expect(parsed.result.quality).toBe("modelled");
    expect(parsed.result.modelled).toEqual(["vat_standard"]);
    expect(parsed.result.budget.net_bn).toBeCloseTo(14.99, 2);
    expect(parsed.result.households).toEqual(households);
    expect(parsed.result.provenance.fetched_at).toBe(at(70_000).toISOString());
    expect(await row()).toMatchObject({ status: "ok", polls: 2 });

    // 4. Cached: no provider call, same answer.
    const fourth = await getT1(db, req(), deps(at(86_400_000)));
    expect(fourth.response).toEqual(third.response);
    expect(fourth.outcome).toBe("cached");
    expect(fake.state.simulate).toHaveLength(3);

    // Aggregate counts only: one row per outcome, no scenario or client in them.
    const usage = await db.query<{ prop_value: string; count: string }>(
      "SELECT prop_value, sum(count) AS count FROM usage_daily WHERE event = 't1_requested' AND prop_key = 'outcome' GROUP BY prop_value ORDER BY prop_value",
    );
    expect(usage.map((u) => [u.prop_value, Number(u.count)])).toEqual([["cached", 1], ["pending", 1], ["ready", 1], ["started", 1]]);
    expect(JSON.stringify(await db.query("SELECT * FROM usage_daily"))).not.toContain("vat21");
  });

  it("starts again once a cached result is 30 days old", async () => {
    fake.state.ready = true;
    await getT1(db, req(), deps(T0));
    await getT1(db, req(), deps(at(5_000)));
    expect((await row())!.status).toBe("ok");
    const stale = await getT1(db, req(), deps(at(31 * 86_400_000)));
    expect(stale.response.status).toBe("pending");
    expect(fake.state.simulate).toEqual([null, 93107, null]);
  });

  it("stores an error, answers it for a while, then tries again", async () => {
    fake.state.fail = new PolicyEngineError("http_502");
    const a = await getT1(db, req(), deps(T0));
    expect(a.httpStatus).toBe(502);
    expect(T1Response.parse(a.response)).toMatchObject({ status: "error" });
    expect(JSON.stringify(a.response)).not.toContain("http_502"); // codes stay on the server
    expect(await row()).toMatchObject({ status: "error", error: "http_502" });

    fake.state.fail = null;
    const cached = await getT1(db, req(), deps(at(ERROR_RETRY_MS - 1)));
    expect(cached.httpStatus).toBe(502);
    expect(fake.state.simulate).toEqual([null]);

    const retried = await getT1(db, req(), deps(at(ERROR_RETRY_MS + 1)));
    expect(retried.response.status).toBe("pending");
    expect(fake.state.simulate).toEqual([null, null]);
  });

  it("turns a failed check into an error", async () => {
    await getT1(db, req(), deps(T0));
    fake.state.fail = new PolicyEngineError("timeout");
    const a = await getT1(db, req(), deps(at(5_000)));
    expect(a.httpStatus).toBe(502);
    expect(await row()).toMatchObject({ status: "error", error: "timeout" });
  });

  it("gives up on a computation that never finishes", async () => {
    await getT1(db, req(), deps(T0));
    const a = await getT1(db, req(), deps(at(PENDING_LIMIT_MS + 1)));
    expect(a.httpStatus).toBe(502);
    expect(fake.state.simulate).toEqual([null]); // no further check
    expect(await row()).toMatchObject({ status: "error", error: "pending_timeout" });
  });

  it("rate-limits new computations per client, not cached answers", async () => {
    fake.state.ready = true;
    const d = (now: Date, clientKey = "203.0.113.7") => deps(now, { dailyLimit: 2, clientKey });
    expect((await getT1(db, req(VAT21, "a"), d(T0))).httpStatus).toBe(202);
    expect((await getT1(db, req({ ...base(), vat_standard: 22 }, "b"), d(T0))).httpStatus).toBe(202);
    // Checks and cached answers are not new computations.
    expect((await getT1(db, req(VAT21, "a"), d(T0))).httpStatus).toBe(200);
    expect((await getT1(db, req(VAT21, "a"), d(T0))).httpStatus).toBe(200);

    const limited = await getT1(db, req({ ...base(), vat_standard: 23 }, "c"), d(T0));
    expect(limited.httpStatus).toBe(429);
    expect(limited.response).toMatchObject({ status: "error" });
    expect(await row("c")).toBeUndefined();
    expect(fake.state.simulate.filter((h) => h === null)).toHaveLength(2);

    // Another client, or the next day, may start one.
    expect((await getT1(db, req({ ...base(), vat_standard: 23 }, "c"), d(T0, "198.51.100.1"))).httpStatus).toBe(202);
    expect((await getT1(db, req({ ...base(), vat_standard: 24 }, "d"), d(at(86_400_000)))).httpStatus).toBe(202);
  });
});
