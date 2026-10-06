import { z } from "zod";

/** How much to trust a number. `training` = from model memory, must be replaced before launch. */
export const Quality = z.enum(["sourced", "approx", "modelled", "training"]);
export type Quality = z.infer<typeof Quality>;

export const IsoDate = z.iso.date();
export const FiscalYear = z.string().regex(/^\d{4}-\d{2}$/, "expected a fiscal year like 2025-26");

/** [low, central, high]. Anything forecast or modelled is a Range, never a point. */
export const Range = z
  .tuple([z.number(), z.number(), z.number()])
  .refine(([lo, c, hi]) => lo <= c && c <= hi, "range must be ordered low <= central <= high");
export type Range = [low: number, central: number, high: number];

export const Source = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.url(),
  published_on: IsoDate.optional(),
  licence: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

/** The provenance fields any rendered number carries. */
export const provenanceShape = {
  quality: Quality,
  source_id: z.string().min(1).optional(),
  method_note: z.string().min(1).optional(),
  /** A balancing residual, not a real breakdown (review B1). Rendered with the `plug` badge. */
  plug: z.boolean().optional(),
};

export const Provenance = z.object(provenanceShape);
export type Provenance = z.infer<typeof Provenance>;

/**
 * DATA_MODEL.md rules: a method note is required unless the value is sourced,
 * a source is required unless the value is a training placeholder, and a
 * training value must say what will replace it.
 */
export function provenanceIssues(p: Provenance): string[] {
  const issues: string[] = [];
  if (p.quality !== "sourced" && !p.method_note) issues.push(`quality "${p.quality}" needs a method_note`);
  if (p.quality !== "training" && !p.source_id) issues.push(`quality "${p.quality}" needs a source_id`);
  if (p.quality === "training" && !p.method_note?.includes("TODO(source)"))
    issues.push(`training values need a TODO(source) note`);
  return issues;
}

export function refineProvenance(p: Provenance, ctx: z.RefinementCtx) {
  for (const message of provenanceIssues(p)) ctx.addIssue({ code: "custom", message });
}

/** DATA_MODEL.md Observation. ETL (M1) emits these; seed files carry the same fields per line. */
export const Observation = z
  .object({
    series_id: z.string().min(1),
    period: z.string().min(1),
    geography: z.string().min(1),
    value: z.number(),
    unit: z.string().min(1),
    kind: z.enum(["outturn", "forecast", "projection"]),
    vintage: z.string().min(1),
    ...provenanceShape,
  })
  .superRefine(refineProvenance);
export type Observation = z.infer<typeof Observation>;
