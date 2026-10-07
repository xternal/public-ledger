import type { T1Result } from "@ledger/schema";
import type { Reform } from "./reform";

/** What a provider computes over the whole population: everything in a T1Result except the scenario's own fields and the example households. */
export type T1Population = Pick<T1Result, "provenance" | "budget" | "deciles" | "winners" | "regions" | "poverty" | "inequality">;

export type T1Household = T1Result["households"][number];

/** One step of a simulation. Never waits for the result: the service asks again on the reader's next poll. */
export type SimulateStep =
  | { status: "pending"; handle: number }
  | { status: "ok"; handle: number; population: T1Population; warnings: string[] };

/**
 * Where T1 runs (docs/MODEL.md T1). Today PolicyEngine's public API; a
 * self-hosted policyengine-uk service can implement the same interface later
 * without changing the cache, the route or the contract.
 */
export interface T1Provider {
  readonly name: T1Result["provenance"]["provider"];
  /**
   * With `handle` null, register the reform and return its handle (PolicyEngine:
   * the policy id) as pending. With a handle, ask once whether the population
   * result is ready. Each call is a single request to the provider.
   */
  simulate(reform: Reform, startYear: number, handle: number | null, now: Date): Promise<SimulateStep>;
  /** Net income of each fixed example household (ARCHETYPES) under current law and under the reform. */
  households(reform: Reform, startYear: number): Promise<T1Household[]>;
}
