import { z } from "zod";
import { Quality, Range, Source } from "./provenance";
import { ControlledBy } from "./levers";

/**
 * data/build/people.json, written by etl/people.py (M6): ONS population projections
 * (principal and variants), ONS past births and deaths, and OBR long-term
 * age-related spending. Nothing here is projected by us (docs/MODEL.md T3);
 * values worked out from published figures are `approx` and say how.
 */

export const PeopleProvenance = z
  .object({
    quality: Quality,
    source_id: z.string().min(1),
    vintage: z.string().min(1),
    method_note: z.string().min(1).optional(),
  })
  .refine((p) => p.quality === "sourced" || !!p.method_note, "a value that is not sourced needs a method_note");
export type PeopleProvenance = z.infer<typeof PeopleProvenance>;

const VariantCode = z.string().regex(/^[a-z]{3}$/);

export const Variant = z.object({
  code: VariantCode,
  label: z.string().min(1),
  /** In the shaded range? ONS's special cases (replacement fertility, zero migration, no mortality improvement) are not. */
  in_range: z.boolean(),
  fertility: z.string().min(1),
  life_expectancy: z.string().min(1),
  migration: z.string().min(1),
});
export type Variant = z.infer<typeof Variant>;

export const AssumptionDetail = z.union([
  z.object({}).strict(),
  z.object({ year: z.string(), unit: z.string(), value: z.number(), quality: Quality, source_id: z.string(), vintage: z.string(), method_note: z.string().optional() }),
  z.object({ year: z.string(), unit: z.string(), male: z.number(), female: z.number(), quality: Quality, source_id: z.string(), vintage: z.string(), method_note: z.string().optional() }),
]);
export type AssumptionDetail = z.infer<typeof AssumptionDetail>;

export const Assumption = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  controlled_by: ControlledBy,
  /** Only published variants; empty when none is published (state pension age). */
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1), variant: VariantCode, detail: AssumptionDetail })),
  note: z.string().optional(),
});
export type Assumption = z.infer<typeof Assumption>;

/** One projected series per variant, with [low, principal, high] per year across the variants in range. */
export const VariantChart = z
  .object({
    unit: z.string().min(1),
    years: z.array(z.number().int()).min(2),
    variants: z.record(VariantCode, z.array(z.number())),
    range: z.array(Range),
    provenance: PeopleProvenance,
  })
  .superRefine((c, ctx) => {
    if (!c.variants.ppp) ctx.addIssue({ code: "custom", path: ["variants"], message: "no principal projection (ppp)" });
    for (const [code, vals] of Object.entries(c.variants)) {
      if (vals.length !== c.years.length) ctx.addIssue({ code: "custom", path: ["variants", code], message: "one value per year" });
    }
    if (c.range.length !== c.years.length) ctx.addIssue({ code: "custom", path: ["range"], message: "one range per year" });
  });
export type VariantChart = z.infer<typeof VariantChart>;

export const PastSeries = z.object({
  years: z.array(z.number().int()),
  values: z.array(z.number()),
  provenance: PeopleProvenance.optional(),
});

export const VitalChart = z.intersection(VariantChart, z.object({ past: PastSeries }));
export type VitalChart = z.infer<typeof VitalChart>;

export const SpendingScenario = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    controlled_by: ControlledBy.nullable(),
    values: z.array(z.number()),
    quality: Quality,
    source_id: z.string().min(1),
    vintage: z.string().min(1),
    method_note: z.string().optional(),
  })
  .refine((s) => s.quality === "sourced" || !!s.method_note, "a computed scenario needs a method_note");
export type SpendingScenario = z.infer<typeof SpendingScenario>;

export const SpendingProjection = z
  .object({
    unit: z.literal("pct_gdp"),
    years: z.array(z.string().regex(/^\d{4}-\d{2}$/)).min(2),
    scenarios: z.array(SpendingScenario).min(1),
    range: z.array(Range),
    components: z.array(z.object({ id: z.string(), label: z.string(), values: z.array(z.number()) })),
    provenance: PeopleProvenance,
  })
  .superRefine((s, ctx) => {
    if (s.scenarios[0]?.id !== "baseline") ctx.addIssue({ code: "custom", path: ["scenarios"], message: "the baseline comes first" });
    for (const sc of [...s.scenarios, ...s.components]) {
      if (sc.values.length !== s.years.length) ctx.addIssue({ code: "custom", path: [sc.id], message: "one value per year" });
    }
  });
export type SpendingProjection = z.infer<typeof SpendingProjection>;

export const PeopleBundle = z.object({
  projection: z.object({ source_id: z.string(), vintage: z.string(), base_year: z.number().int(), last_year: z.number().int() }),
  variants: z.array(Variant).min(1),
  assumptions: z.array(Assumption),
  charts: z.object({ oadr: VariantChart, workers: VariantChart, births: VitalChart, deaths: VitalChart }),
  spending: SpendingProjection,
  sources: z.array(Source).min(1),
});
export type PeopleBundle = z.infer<typeof PeopleBundle>;
