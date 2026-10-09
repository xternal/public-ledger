import { z } from "zod";
import { Provenance, Quality, Range, Source, provenanceIssues, provenanceShape, refineProvenance } from "./provenance";

/** CLAUDE.md invariant 3: every lever says who controls it. */
export const ControlledBy = z.enum(["government", "central_bank", "demography", "external"]);
export type ControlledBy = z.infer<typeof ControlledBy>;

export const LeverGroup = z.enum(["taxes", "spending", "rates", "measures"]);
export type LeverGroup = z.infer<typeof LeverGroup>;

export const LeverUnit = z.enum(["pp", "pct", "pct_gdp", "toggle", "gbp", "pence"]);
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

/**
 * One of the source's own costed changes, for a lever whose effect cannot be
 * scaled (HMRC's capital gains tax rates: "non-linear and so cannot be scaled
 * up"). `at` is units above base; y1 and y5 are the effect on the target line
 * for that whole change, not per unit.
 */
export const LeverStep = z.object({
  at: z.number().positive(),
  y1: Range,
  y5: Range.optional(),
});
export type LeverStep = z.infer<typeof LeverStep>;

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
      /** Effect of one unit of change, scaled by the change. A lever has this or `steps`, never both. */
      per_unit_bn: z.object({ y1: Range, y5: Range.optional() }).optional(),
      /** The only changes the lever offers, ascending, each with its own effect. Never interpolated or scaled. */
      steps: z.array(LeverStep).min(1).optional(),
      cpi_pp_per_unit: Range.optional(),
      /** Where the CPI effect comes from: its own source, separate from the lever's cost (invariant 1). */
      cpi_provenance: Provenance.optional(),
    }),
    household: MortgageReference.optional(),
    promise_id: z.string().optional(),
    funding_options: z.array(FundingOption).min(1).optional(),
    ...provenanceShape,
  })
  .superRefine((l, ctx) => {
    refineProvenance(l, ctx);
    if (l.effect.cpi_pp_per_unit && !l.effect.cpi_provenance)
      ctx.addIssue({ code: "custom", path: ["effect", "cpi_provenance"], message: "a CPI effect needs its own provenance (cpi_provenance)" });
    if (l.effect.cpi_provenance)
      for (const message of provenanceIssues(l.effect.cpi_provenance)) ctx.addIssue({ code: "custom", path: ["effect", "cpi_provenance"], message });
    if (!(l.min <= l.base && l.base <= l.max))
      ctx.addIssue({ code: "custom", path: ["base"], message: "base must sit between min and max" });
    if (l.unit === "toggle" && (l.min !== 0 || l.max !== 1 || l.step !== 1))
      ctx.addIssue({ code: "custom", path: ["unit"], message: "a toggle runs 0 to 1 in steps of 1" });
    if (l.funding_options && l.unit !== "toggle")
      ctx.addIssue({ code: "custom", path: ["funding_options"], message: "only toggle measures take funding options" });
    refineSteps(l, ctx);
  });
export type Lever = z.infer<typeof Lever>;

/** Floating-point slack when matching a value to a step (bases like 52.95 come from published figures). */
export const STEP_TOLERANCE = 1e-9;

/** The values a stepped lever offers: its base (today), then base plus each step. Empty steps give just the base. */
export const stepValues = (l: { base: number; effect: { steps?: LeverStep[] | undefined } }): number[] => [
  l.base,
  ...(l.effect.steps ?? []).map((s) => l.base + s.at),
];

/** The fields refineSteps reads (the parsed lever, before its own refinements). */
interface SteppedShape {
  unit: LeverUnit;
  base: number;
  min: number;
  max: number;
  effect: { per_unit_bn?: unknown; steps?: LeverStep[] | undefined; cpi_pp_per_unit?: Range | undefined };
}

/**
 * A lever is costed per unit (scaled by the change) or by steps (only the
 * changes the source costs, each with its own figure). A stepped lever runs
 * from today's value to its last step and offers nothing in between.
 */
function refineSteps(l: SteppedShape, ctx: z.RefinementCtx) {
  const { per_unit_bn, steps, cpi_pp_per_unit } = l.effect;
  if (!per_unit_bn === !steps) {
    ctx.addIssue({ code: "custom", path: ["effect"], message: "a lever needs exactly one of per_unit_bn or steps" });
    return;
  }
  // Zod still runs this refinement when the steps array itself failed (e.g. empty): nothing more to check then.
  const last = steps?.[steps.length - 1];
  if (!steps || !last) return;
  if (l.unit === "toggle") ctx.addIssue({ code: "custom", path: ["effect", "steps"], message: "a toggle cannot have steps" });
  steps.forEach((s, i) => {
    if (i > 0 && !(s.at > steps[i - 1]!.at))
      ctx.addIssue({ code: "custom", path: ["effect", "steps", i, "at"], message: "steps must be in ascending order, each one different" });
  });
  if (Math.abs(l.min - l.base) > STEP_TOLERANCE) ctx.addIssue({ code: "custom", path: ["min"], message: "a stepped lever starts at its base (min must equal base)" });
  if (Math.abs(l.max - (l.base + last.at)) > STEP_TOLERANCE)
    ctx.addIssue({ code: "custom", path: ["max"], message: "a stepped lever ends at its last step (max must equal base plus the last step)" });
  if (cpi_pp_per_unit)
    ctx.addIssue({ code: "custom", path: ["effect", "cpi_pp_per_unit"], message: "a stepped lever cannot scale a per-unit price effect" });
}

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
