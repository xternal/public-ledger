import { z } from "zod";
import { FiscalYear } from "./provenance";

/**
 * T1: microsimulation (docs/MODEL.md). A scenario's tax and benefit levers
 * run through PolicyEngine UK, a public, open-source tax-benefit model, over
 * representative survey households. It gives what T0 arithmetic cannot: who
 * gains and who loses, by income decile, region and household type. T0 still
 * answers instantly; T1 fills in when ready and is shown next to T0, never
 * instead of it. Every T1 number is `quality: modelled` and carries the
 * model and data versions it came from.
 */

/** Sandbox levers T1 can model (tax-benefit changes). Others (Bank Rate, departmental spending, the bus cap) stay T0-only. */
export const T1_LEVERS = [
  "income_tax_basic",
  "income_tax_higher",
  "income_tax_additional",
  "personal_allowance",
  "nics_main",
  "vat_standard",
  "fuel_duty",
  "state_pension_change",
] as const;
export type T1Lever = (typeof T1_LEVERS)[number];

/** Households whose before-and-after net income T1 reports ("people like me"). Fixed, so nothing about a reader is ever sent. */
export const ARCHETYPES = [
  { id: "single_25k", label: "Single adult earning £25,000" },
  { id: "single_45k", label: "Single adult earning £45,000" },
  { id: "single_120k", label: "Single adult earning £120,000" },
  { id: "couple_two_children", label: "Couple earning £35,000 and £15,000, two children" },
  { id: "lone_parent", label: "Lone parent earning £18,000, one child" },
  { id: "pensioner_couple", label: "Pensioner couple on the state pension" },
] as const;
export type ArchetypeId = (typeof ARCHETYPES)[number]["id"];

/** ONS region codes (nations for Scotland, Wales, Northern Ireland). */
export const REGIONS = [
  { id: "E12000001", name: "North East" },
  { id: "E12000002", name: "North West" },
  { id: "E12000003", name: "Yorkshire and The Humber" },
  { id: "E12000004", name: "East Midlands" },
  { id: "E12000005", name: "West Midlands" },
  { id: "E12000006", name: "East of England" },
  { id: "E12000007", name: "London" },
  { id: "E12000008", name: "South East" },
  { id: "E12000009", name: "South West" },
  { id: "W92000004", name: "Wales" },
  { id: "S92000003", name: "Scotland" },
  { id: "N92000002", name: "Northern Ireland" },
] as const;
export type RegionId = (typeof REGIONS)[number]["id"];

const Money = z.number(); // £ per household per year unless the field says _bn
const Share = z.number().min(0).max(1);
const BeforeAfter = z.object({ baseline: z.number(), reform: z.number() });

export const WinnerShares = z.object({
  gain_more_5: Share,
  gain_less_5: Share,
  no_change: Share,
  lose_less_5: Share,
  lose_more_5: Share,
});
export type WinnerShares = z.infer<typeof WinnerShares>;

export const T1Provenance = z.object({
  provider: z.literal("policyengine_api"),
  /** e.g. "2.102.3" */
  model_version: z.string(),
  /** e.g. "policyengine-uk-data-1.56.16" */
  data_version: z.string(),
  dataset: z.string().nullable(),
  /** PolicyEngine's id for this reform; the baseline is current law (1). */
  policy_id: z.number().int(),
  /** A page where anyone can open the same reform in PolicyEngine. */
  url: z.url(),
  fetched_at: z.iso.datetime(),
});
export type T1Provenance = z.infer<typeof T1Provenance>;

export const T1Result = z.object({
  /** The scenario code (?s=…) this result belongs to. */
  scenario: z.string(),
  year: FiscalYear,
  provenance: T1Provenance,
  quality: z.literal("modelled"),
  /** Scenario levers T1 modelled, and the changed ones it could not (shown as "not in this model"). */
  modelled: z.array(z.string()),
  not_modelled: z.array(z.string()),
  budget: z.object({
    /** Change in the government's balance, £bn a year: positive raises money, negative costs money. Static: no behavioural response. */
    net_bn: z.number(),
    tax_bn: z.number(),
    benefits_bn: z.number(),
    /** Per programme (income_tax, vat, universal_credit…), £bn a year. */
    by_programme: z.record(z.string(), z.object({ baseline_bn: z.number(), reform_bn: z.number(), change_bn: z.number() })),
  }),
  /** Income deciles 1 (lowest) to 10: average change in household net income, £ a year and %. */
  deciles: z.array(z.object({ decile: z.number().int().min(1).max(10), avg_change_gbp: Money, rel_change_pct: z.number() })).length(10),
  winners: z.object({ all: WinnerShares, by_decile: z.array(WinnerShares).length(10) }),
  regions: z.array(z.object({ id: z.string(), name: z.string(), avg_change_gbp: Money, rel_change_pct: z.number() })),
  households: z.array(z.object({ id: z.string(), label: z.string(), baseline_net_gbp: Money, reform_net_gbp: Money, change_gbp: Money })),
  poverty: z.object({ all: BeforeAfter, child: BeforeAfter, adult: BeforeAfter, senior: BeforeAfter }),
  inequality: z.object({ gini: BeforeAfter, top_10_pct_share: BeforeAfter, top_1_pct_share: BeforeAfter }),
});
export type T1Result = z.infer<typeof T1Result>;

/** What GET /api/t1 answers. */
export const T1Response = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), result: T1Result }),
  /** PolicyEngine is computing (about a minute for a new scenario); ask again after `retry_after_s`. */
  z.object({ status: z.literal("pending"), retry_after_s: z.number().int().positive() }),
  /** The scenario changes no lever T1 models. */
  z.object({ status: z.literal("not_applicable"), not_modelled: z.array(z.string()) }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type T1Response = z.infer<typeof T1Response>;

/**
 * T0 and T1 revenue disagree enough to explain (docs/MODEL.md, ensemble display):
 * T1's central estimate is outside T0's range widened by 15%.
 */
export function t0t1Disagree(t0Range: readonly [number, number, number], t1Bn: number): boolean {
  const lo = Math.min(t0Range[0], t0Range[2]);
  const hi = Math.max(t0Range[0], t0Range[2]);
  const pad = Math.max(Math.abs(lo), Math.abs(hi)) * 0.15;
  return t1Bn < lo - pad || t1Bn > hi + pad;
}

/**
 * Invariant 2: modelled numbers are shown as ranges. PolicyEngine gives a single
 * estimate, so T1 uses the project's editorial ±10% (the rule for any source
 * that gives a central figure only), and the method note says so.
 */
export const T1_EDITORIAL_BAND = 0.1;
export function t1Range(central: number): [number, number, number] {
  const a = central * (1 - T1_EDITORIAL_BAND);
  const b = central * (1 + T1_EDITORIAL_BAND);
  return [Math.min(a, b), central, Math.max(a, b)];
}
