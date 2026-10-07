import { z } from "zod";
import type { WinnerShares } from "@ledger/schema";
import type { T1Population } from "./provider";
import { aggregateRegions } from "./regions";

/**
 * PolicyEngine's economy result → the provider-neutral T1Population.
 * Only the fields T1 shows are read; anything else PolicyEngine adds is ignored.
 */
const num = z.number().finite();
const ByDecile = z.record(z.string(), num);
const BeforeAfter = z.object({ baseline: num, reform: num });
const WINNER_KEYS = {
  "Gain more than 5%": "gain_more_5",
  "Gain less than 5%": "gain_less_5",
  "No change": "no_change",
  "Lose less than 5%": "lose_less_5",
  "Lose more than 5%": "lose_more_5",
} as const satisfies Record<string, keyof WinnerShares>;
type WinnerKey = keyof typeof WINNER_KEYS;
const winnerKeys = Object.keys(WINNER_KEYS) as WinnerKey[];

export const PeEconomy = z.object({
  model_version: z.string().optional(),
  data_version: z.string().optional(),
  budget: z.object({ budgetary_impact: num, tax_revenue_impact: num, benefit_spending_impact: num }),
  detailed_budget: z.record(z.string(), z.object({ baseline: num, reform: num, difference: num })),
  decile: z.object({ average: ByDecile, relative: ByDecile }),
  intra_decile: z.object({
    all: z.record(z.string(), num),
    deciles: z.record(z.string(), z.array(num).length(10)),
  }),
  local_authority_impact: z
    .array(
      z.object({
        local_authority_code: z.string(),
        population: num,
        average_household_income_change: num,
        relative_household_income_change: num,
      }),
    )
    .nullish(),
  poverty: z.object({ poverty: z.object({ all: BeforeAfter, child: BeforeAfter, adult: BeforeAfter, senior: BeforeAfter }) }),
  inequality: z.object({ gini: BeforeAfter, top_10_pct_share: BeforeAfter, top_1_pct_share: BeforeAfter }),
  policyengine_bundle: z
    .object({ model_version: z.string().optional(), data_version: z.string().optional(), dataset: z.string().nullish() })
    .nullish(),
});
export type PeEconomy = z.infer<typeof PeEconomy>;

export class TransformError extends Error {
  constructor(readonly code: string) {
    super(`T1 transform: ${code}`);
    this.name = "TransformError";
  }
}

/** Policy page anyone can open to see the same reform in PolicyEngine's own app. */
export function policyUrl(policyId: number, startYear: number): string {
  return `https://policyengine.org/uk/policy?reform=${policyId}&focus=policyOutput.policyBreakdown&region=uk&timePeriod=${startYear}`;
}

const bn = (gbp: number) => gbp / 1e9;
const DECILES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const share = (v: number | undefined) => Math.min(1, Math.max(0, v ?? 0));

/**
 * PolicyEngine's `decile.relative` arrives as a percentage (VAT at 21%: decile 1
 * is −2.99, i.e. −2.99%), unlike the local authority rows, which are fractions.
 * Check rather than trust: reading the values as fractions would imply a typical
 * decile's household net income of `average / relative`. Real deciles are well
 * above £5,000 a year; if the fraction reading puts the median decile below
 * that, the values are percentages. Returns the factor that turns them into %.
 */
export function decileRelativeToPct(average: Record<string, number>, relative: Record<string, number>): 1 | 100 {
  const implied = DECILES.map((d) => {
    const a = average[String(d)];
    const r = relative[String(d)];
    return a !== undefined && r !== undefined && Math.abs(r) > 1e-12 ? Math.abs(a / r) : null;
  }).filter((x): x is number => x !== null);
  if (implied.length === 0) return 1;
  implied.sort((a, b) => a - b);
  const median = implied[Math.floor(implied.length / 2)]!;
  return median < 5_000 ? 1 : 100;
}

export interface TransformContext {
  policyId: number;
  startYear: number;
  fetchedAt: Date;
}

export function toT1Population(raw: unknown, ctx: TransformContext): { population: T1Population; warnings: string[] } {
  const parsed = PeEconomy.safeParse(raw);
  if (!parsed.success) throw new TransformError("bad_economy_result");
  const r = parsed.data;
  const warnings: string[] = [];

  const by_programme = Object.fromEntries(
    Object.entries(r.detailed_budget).map(([k, v]) => [k, { baseline_bn: bn(v.baseline), reform_bn: bn(v.reform), change_bn: bn(v.difference) }]),
  );

  const toPct = decileRelativeToPct(r.decile.average, r.decile.relative);
  const deciles = DECILES.map((d) => {
    const avg = r.decile.average[String(d)];
    const rel = r.decile.relative[String(d)];
    if (avg === undefined || rel === undefined) throw new TransformError("missing_decile");
    return { decile: d, avg_change_gbp: avg, rel_change_pct: rel * toPct };
  });

  const winnersOf = (get: (key: WinnerKey) => number | undefined): WinnerShares => {
    const out = {} as WinnerShares;
    for (const key of winnerKeys) out[WINNER_KEYS[key]] = share(get(key));
    return out;
  };
  const winners = {
    all: winnersOf((k) => r.intra_decile.all[k]),
    by_decile: DECILES.map((d) => winnersOf((k) => r.intra_decile.deciles[k]?.[d - 1])),
  };

  const { regions, unmatched } = aggregateRegions(
    (r.local_authority_impact ?? []).map((a) => ({
      code: a.local_authority_code,
      population: a.population,
      avg_change_gbp: a.average_household_income_change,
      rel_change: a.relative_household_income_change,
    })),
  );
  if (unmatched.length) warnings.push(`local authority codes missing from data/seed/lad_region.json: ${unmatched.join(", ")}`);
  if (!r.local_authority_impact?.length) warnings.push("PolicyEngine returned no local authority results");

  const bundle = r.policyengine_bundle ?? {};
  const model_version = bundle.model_version ?? r.model_version;
  const data_version = bundle.data_version ?? r.data_version;
  if (!model_version || !data_version) throw new TransformError("missing_versions");

  const p = r.poverty.poverty;
  return {
    population: {
      provenance: {
        provider: "policyengine_api",
        model_version,
        data_version,
        dataset: bundle.dataset ?? null,
        policy_id: ctx.policyId,
        url: policyUrl(ctx.policyId, ctx.startYear),
        fetched_at: ctx.fetchedAt.toISOString(),
      },
      budget: {
        // Positive = more money for the government. benefits_bn is the change
        // in benefit spending (positive = more spent), so net = tax − benefits.
        net_bn: bn(r.budget.budgetary_impact),
        tax_bn: bn(r.budget.tax_revenue_impact),
        benefits_bn: bn(r.budget.benefit_spending_impact),
        by_programme,
      },
      deciles,
      winners,
      regions,
      poverty: { all: p.all, child: p.child, adult: p.adult, senior: p.senior },
      inequality: { gini: r.inequality.gini, top_10_pct_share: r.inequality.top_10_pct_share, top_1_pct_share: r.inequality.top_1_pct_share },
    },
    warnings,
  };
}
