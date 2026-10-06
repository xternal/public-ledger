import { z } from "zod";
import { FiscalYear, IsoDate, Provenance, Source, provenanceShape, refineProvenance } from "./provenance";

/** Largest gap allowed between receipts + borrowing and spending (PRD F1: balances to £0.1bn). */
export const BALANCE_TOLERANCE_BN = 0.1;

export const StatementLine = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string().min(1),
    desc: z.string().optional(),
    bn: z.number().nonnegative(),
    ...provenanceShape,
  })
  .superRefine(refineProvenance);
export type StatementLine = z.infer<typeof StatementLine>;

const MACRO_NUMBERS = [
  "nominal_gdp_bn",
  "psnd_bn",
  "psnd_pct_gdp",
  "bank_rate_pct",
  "households_m",
  "income_taxpayers_m",
  "population_m",
  "baseline_psnb_bn",
  "baseline_nominal_growth_pct",
  "baseline_psnd_pct_gdp",
] as const;
export type MacroKey = (typeof MACRO_NUMBERS)[number];

const Macro = z
  .object({
    nominal_gdp_bn: z.number().positive(),
    psnd_bn: z.number().positive(),
    psnd_pct_gdp: z.number().positive(),
    bank_rate_pct: z.number(),
    bank_rate_date: IsoDate,
    households_m: z.number().positive(),
    income_taxpayers_m: z.number().positive(),
    population_m: z.number().positive(),
    baseline_psnb_bn: z.record(FiscalYear, z.number()),
    baseline_nominal_growth_pct: z.number(),
    baseline_psnd_pct_gdp: z.record(FiscalYear, z.number()),
    provenance: z.record(z.string(), Provenance.superRefine(refineProvenance)),
  })
  .superRefine((m, ctx) => {
    for (const key of MACRO_NUMBERS) {
      if (!m.provenance[key]) ctx.addIssue({ code: "custom", path: ["provenance", key], message: "every macro number needs provenance" });
    }
    const psnd = Object.keys(m.baseline_psnd_pct_gdp);
    const psnb = Object.keys(m.baseline_psnb_bn);
    if (psnd.join() !== psnb.join())
      ctx.addIssue({ code: "custom", path: ["baseline_psnd_pct_gdp"], message: "baseline paths must cover the same years" });
  });

export const StatementSeed = z
  .object({
    meta: z.object({
      country: z.string(),
      fiscal_year: FiscalYear,
      vintage: z.string().min(1),
      vintage_label: z.string().min(1),
      note: z.string(),
      sources: z.array(Source).min(1),
      plugs: z.string().optional(),
      /** Set by the ETL build: whether the year is outturn or forecast. */
      kind: z.enum(["outturn", "estimate", "forecast"]).optional(),
    }),
    macro: Macro,
    receipts: z.array(StatementLine).min(1),
    borrowing_bn: z.number(),
    borrowing_provenance: Provenance.superRefine(refineProvenance),
    spending: z.array(StatementLine).min(1),
  })
  .superRefine((s, ctx) => {
    const ids = [...s.receipts, ...s.spending].map((l) => l.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) ctx.addIssue({ code: "custom", message: `duplicate line ids: ${dupes.join(", ")}` });
    const rec = s.receipts.reduce((a, l) => a + l.bn, 0);
    const sp = s.spending.reduce((a, l) => a + l.bn, 0);
    const gap = rec + s.borrowing_bn - sp;
    if (Math.abs(gap) > BALANCE_TOLERANCE_BN)
      ctx.addIssue({ code: "custom", path: ["borrowing_bn"], message: `statement does not balance: receipts + borrowing − spending = ${gap.toFixed(2)}bn` });
  });
export type StatementSeed = z.infer<typeof StatementSeed>;
