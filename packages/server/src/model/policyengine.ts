import { archetypeSituation, householdRows, readNetIncomes, type Situation } from "./households";
import type { T1Provider } from "./provider";
import type { Reform } from "./reform";
import { toT1Population } from "./transform";

/**
 * PolicyEngine's public API (https://api.policyengine.org, no key). Be a good
 * citizen: one request at a time per reader action, short timeouts, and
 * results cached by the service for 30 days.
 */
export const POLICYENGINE_API = "https://api.policyengine.org";

/** PolicyEngine's id for current law, the baseline every reform is compared with. */
export const CURRENT_LAW_ID = 1;

export interface PolicyEngineOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Milliseconds. The economy GET answers at once ("computing") or with the cached result. */
  timeouts?: { policy?: number; economy?: number; calculate?: number };
}

/**
 * A failed call. The code is all it carries ("http_502", "timeout", "network",
 * "bad_response", "pe_error"): never a response body, which can be large and
 * echoes the request.
 */
export class PolicyEngineError extends Error {
  constructor(readonly code: string) {
    super(`PolicyEngine ${code}`);
    this.name = "PolicyEngineError";
  }
}

export type EconomyStep = { status: "computing" } | { status: "ok"; raw: unknown };

export interface PolicyEngineClient {
  createPolicy(data: Reform): Promise<number>;
  economy(policyId: number, startYear: number): Promise<EconomyStep>;
  calculateHousehold(household: Situation, policy: Reform): Promise<unknown>;
}

const DEFAULT_TIMEOUTS = { policy: 10_000, economy: 15_000, calculate: 20_000 };

export function policyEngineClient(opts: PolicyEngineOptions = {}): PolicyEngineClient {
  const base = (opts.baseUrl ?? POLICYENGINE_API).replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;
  const timeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeouts };

  async function call(path: string, timeoutMs: number, body?: unknown): Promise<{ status?: unknown; result?: unknown }> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store", // the service caches; never a framework fetch cache
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      throw new PolicyEngineError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new PolicyEngineError(`http_${res.status}`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch (e) {
      throw new PolicyEngineError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "bad_response");
    }
    if (typeof json !== "object" || json === null) throw new PolicyEngineError("bad_response");
    const out = json as { status?: unknown; result?: unknown };
    if (out.status === "error") throw new PolicyEngineError("pe_error");
    return out;
  }

  return {
    async createPolicy(data) {
      const r = await call("/uk/policy", timeouts.policy, { data });
      const id = (r.result as { policy_id?: unknown } | undefined)?.policy_id;
      if (r.status !== "ok" || typeof id !== "number" || !Number.isInteger(id)) throw new PolicyEngineError("bad_response");
      return id;
    },
    async economy(policyId, startYear) {
      const q = new URLSearchParams({ region: "uk", time_period: String(startYear) });
      const r = await call(`/uk/economy/${policyId}/over/${CURRENT_LAW_ID}?${q}`, timeouts.economy);
      if (r.status === "computing") return { status: "computing" };
      if (r.status === "ok" && typeof r.result === "object" && r.result !== null) return { status: "ok", raw: r.result };
      throw new PolicyEngineError("bad_response");
    },
    async calculateHousehold(household, policy) {
      const r = await call("/uk/calculate", timeouts.calculate, { household, policy });
      if (r.status !== "ok" || typeof r.result !== "object" || r.result === null) throw new PolicyEngineError("bad_response");
      return r.result;
    },
  };
}

/** T1 on PolicyEngine's public API. */
export function policyEngineProvider(opts: PolicyEngineOptions = {}): T1Provider {
  const client = policyEngineClient(opts);
  return {
    name: "policyengine_api",
    async simulate(reform, startYear, handle, now) {
      if (handle === null) return { status: "pending", handle: await client.createPolicy(reform) };
      const step = await client.economy(handle, startYear);
      if (step.status === "computing") return { status: "pending", handle };
      const { population, warnings } = toT1Population(step.raw, { policyId: handle, startYear, fetchedAt: now });
      return { status: "ok", handle, population, warnings };
    },
    async households(reform, startYear) {
      const situation = archetypeSituation(startYear);
      // Current law and the reform side by side: two requests at once, so the reader waits for one.
      const [baseline, reformed] = await Promise.all([client.calculateHousehold(situation, {}), client.calculateHousehold(situation, reform)]);
      return householdRows(readNetIncomes(baseline, startYear), readNetIncomes(reformed, startYear));
    },
  };
}
