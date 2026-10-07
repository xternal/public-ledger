import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PolicyEngineError, archetypeSituation, policyEngineClient, policyEngineProvider } from "../src/model";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/t1/${name}`, import.meta.url), "utf8"));
const vat = fixture("pe-economy-vat21-2025.json");
const hhBase = fixture("pe-households-baseline-2025.json");
const hhVat = fixture("pe-households-vat21-2025.json");

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** A fake fetch: records each call and answers from `route`. */
function fakeFetch(route: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return route(call);
  }) as typeof fetch;
  return { fetch: f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const REFORM = { "gov.hmrc.vat.standard_rate": { "2025-01-01.2100-12-31": 0.21 } };

describe("PolicyEngine client", () => {
  it("registers a reform and reads its policy id", async () => {
    const f = fakeFetch(() => json({ status: "ok", message: "Policy already exists", result: { policy_id: 93107 } }));
    const id = await policyEngineClient({ fetch: f.fetch }).createPolicy(REFORM);
    expect(id).toBe(93107);
    expect(f.calls).toEqual([{ url: "https://api.policyengine.org/uk/policy", method: "POST", body: { data: REFORM } }]);
  });

  it("asks for the economy result over current law, for the UK and the year", async () => {
    let answer: unknown = { status: "computing", message: null, result: null };
    const f = fakeFetch(() => json(answer));
    const client = policyEngineClient({ fetch: f.fetch });
    expect(await client.economy(93107, 2025)).toEqual({ status: "computing" });
    expect(f.calls[0]).toEqual({ url: "https://api.policyengine.org/uk/economy/93107/over/1?region=uk&time_period=2025", method: "GET", body: undefined });
    answer = vat;
    const ok = await client.economy(93107, 2025);
    expect(ok.status).toBe("ok");
  });

  it("runs a household under a policy", async () => {
    const f = fakeFetch(() => json(hhBase.response));
    const out = await policyEngineClient({ fetch: f.fetch }).calculateHousehold(archetypeSituation(2025), {});
    expect(out).toEqual(hhBase.response.result);
    expect(f.calls[0]!.url).toBe("https://api.policyengine.org/uk/calculate");
    expect(f.calls[0]!.body).toEqual({ household: archetypeSituation(2025), policy: {} });
  });

  it("reports failures as codes only, never the response body", async () => {
    const secretish = "Invalid household payload: " + "x".repeat(5000);
    const client = policyEngineClient({ fetch: fakeFetch(() => json({ status: "error", message: secretish }, 400)).fetch });
    const err = await client.createPolicy(REFORM).catch((e) => e);
    expect(err).toBeInstanceOf(PolicyEngineError);
    expect(err.code).toBe("http_400");
    expect(err.message).toBe("PolicyEngine http_400");

    const pe = await policyEngineClient({ fetch: fakeFetch(() => json({ status: "error", message: secretish })).fetch })
      .economy(1, 2025)
      .catch((e) => e);
    expect(pe.code).toBe("pe_error");
    expect(pe.message).not.toContain("payload");

    const garbled = await policyEngineClient({ fetch: fakeFetch(() => new Response("<html>")).fetch })
      .economy(1, 2025)
      .catch((e) => e);
    expect(garbled.code).toBe("bad_response");

    const down = await policyEngineClient({
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    })
      .createPolicy(REFORM)
      .catch((e) => e);
    expect(down.code).toBe("network");
  });

  it("gives up after its timeout", async () => {
    const hang = (async (_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof fetch;
    const err = await policyEngineClient({ fetch: hang, timeouts: { economy: 20 } })
      .economy(1, 2025)
      .catch((e) => e);
    expect(err.code).toBe("timeout");
  });
});

describe("PolicyEngine provider", () => {
  it("registers first, then asks once per step", async () => {
    let economy: unknown = { status: "computing" };
    const f = fakeFetch((c) => (c.url.endsWith("/uk/policy") ? json({ status: "ok", result: { policy_id: 93107 } }) : json(economy)));
    const provider = policyEngineProvider({ fetch: f.fetch });
    const now = new Date("2026-10-07T12:00:00Z");

    expect(await provider.simulate(REFORM, 2025, null, now)).toEqual({ status: "pending", handle: 93107 });
    expect(f.calls).toHaveLength(1);
    expect(await provider.simulate(REFORM, 2025, 93107, now)).toEqual({ status: "pending", handle: 93107 });
    expect(f.calls).toHaveLength(2);

    economy = vat;
    const step = await provider.simulate(REFORM, 2025, 93107, now);
    expect(f.calls).toHaveLength(3);
    if (step.status !== "ok") throw new Error("expected ok");
    expect(step.population.budget.net_bn).toBeCloseTo(14.99, 2);
    expect(step.population.provenance.policy_id).toBe(93107);
  });

  it("computes the example households under current law and the reform", async () => {
    const f = fakeFetch((c) => json((c.body as { policy: object }).policy && Object.keys((c.body as { policy: object }).policy).length ? hhVat.response : hhBase.response));
    const rows = await policyEngineProvider({ fetch: f.fetch }).households(REFORM, 2025);
    expect(f.calls.map((c) => (c.body as { policy: unknown }).policy)).toEqual([{}, REFORM]);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ id: "single_25k", label: "Single adult earning £25,000", baseline_net_gbp: 21_345.05, reform_net_gbp: 21_345.05, change_gbp: 0 });
  });
});
