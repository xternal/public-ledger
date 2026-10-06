import { z } from "zod";
import { FiscalYear, Source } from "./provenance";
import { StatementSeed } from "./statement";
import { LeversSeed } from "./levers";
import { TaxSeed } from "./tax";

/**
 * data/build/app.json, written by etl/build.py (M1): every year's Statement,
 * the sandbox levers and the tax rates, all from official sources.
 */
export const AppBundle = z
  .object({
    built_at: z.string().min(1),
    base_year: FiscalYear,
    years: z.array(z.object({ period: FiscalYear, kind: z.enum(["outturn", "estimate", "forecast"]) })).min(1),
    statements: z.record(FiscalYear, StatementSeed),
    levers: LeversSeed,
    tax: TaxSeed,
    sources: z.array(Source).min(1),
  })
  .superRefine((b, ctx) => {
    for (const y of b.years) {
      if (!b.statements[y.period]) ctx.addIssue({ code: "custom", path: ["statements", y.period], message: "listed year has no statement" });
    }
    if (!b.statements[b.base_year]) ctx.addIssue({ code: "custom", path: ["base_year"], message: "base year has no statement" });
  });
export type AppBundle = z.infer<typeof AppBundle>;
