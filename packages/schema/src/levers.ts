import { z } from "zod";
import { Quality, Range, Source, provenanceShape, refineProvenance } from "./provenance";

/** CLAUDE.md invariant 3: every lever says who controls it. */
export const ControlledBy = z.enum(["government", "central_bank", "demography", "external"]);
export type ControlledBy = z.infer<typeof ControlledBy>;

export const LeverGroup = z.enum(["taxes", "spending", "rates", "measures"]);
export type LeverGroup = z.infer<typeof LeverGroup>;

export const LeverUnit = z.enum(["pp", "pct", "pct_gdp", "toggle", "gbp"]);
export type LeverUnit = z.infer<typeof LeverUnit>;

export const FundingOption = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    offset_bn: z.number().nonnegative(),
    target: z.string().optional(),
    quality: Quality.optional(),
    source_id: z.string().optional(),
    method_note: z.string().optional(),
  })
  .superRefine((f, ctx) => {
    if (f.offset_bn === 0) return;
    if (!f.target) ctx.addIssue({ code: "custom", path: ["target"], message: "a funding offset needs a target line" });
    if (!f.quality) ctx.addIssue({ code: "custom", path: ["quality"], message: "a funding offset needs a quality" });
    else refineProvenance({ quality: f.quality, source_id: f.source_id, method_note: f.method_note }, ctx);
  });
export type FundingOption = z.infer<typeof FundingOption>;

export const MortgageReference = z
  .object({
    kind: z.literal("mortgage"),
    reference_loan_gbp: z.number().positive(),
    term_years: z.number().int().positive(),
    spread_over_bank_rate_pp: z.number(),
    ...provenanceShape,
  })
  .superRefine((m, ctx) => {
    if (!m.method_note) ctx.addIssue({ code: "custom", message: "the mortgage reference needs a method_note" });
  });
export type MortgageReference = z.infer<typeof MortgageReference>;

export const Lever = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string().min(1),
    group: LeverGroup,
    controlled_by: ControlledBy,
    unit: LeverUnit,
    base: z.number(),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    effect: z.object({
      target: z.string().min(1),
      per_unit_bn: z.object({ y1: Range, y5: Range.optional() }),
      cpi_pp_per_unit: Range.optional(),
    }),
    household: MortgageReference.optional(),
    promise_id: z.string().optional(),
    funding_options: z.array(FundingOption).min(1).optional(),
    ...provenanceShape,
  })
  .superRefine((l, ctx) => {
    refineProvenance(l, ctx);
    if (!(l.min <= l.base && l.base <= l.max))
      ctx.addIssue({ code: "custom", path: ["base"], message: "base must sit between min and max" });
    if (l.unit === "toggle" && (l.min !== 0 || l.max !== 1 || l.step !== 1))
      ctx.addIssue({ code: "custom", path: ["unit"], message: "a toggle runs 0 to 1 in steps of 1" });
    if (l.funding_options && l.unit !== "toggle")
      ctx.addIssue({ code: "custom", path: ["funding_options"], message: "only toggle measures take funding options" });
  });
export type Lever = z.infer<typeof Lever>;

export const MacroRules = z
  .object({
    spending_multiplier: Range,
    tax_multiplier: Range,
    ...provenanceShape,
  })
  .superRefine(refineProvenance);
export type MacroRules = z.infer<typeof MacroRules>;

export const LeversSeed = z.object({
  meta: z.object({ note: z.string(), sources: z.array(Source) }),
  levers: z.array(Lever).min(1),
  macro_rules: MacroRules,
});
export type LeversSeed = z.infer<typeof LeversSeed>;

/**
 * Scenario settings, as in DATA_MODEL.md: lever id → value. A measure's
 * funding choice is stored under "<lever id>.funding".
 */
export const Settings = z.record(z.string(), z.union([z.number(), z.string()]));
export type Settings = z.infer<typeof Settings>;

export const fundingKey = (leverId: string) => `${leverId}.funding`;
