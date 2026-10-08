import { z } from "zod";
import { IsoDate, Quality, Range } from "./provenance";

/**
 * Forecasts against outturn (M7, docs/DATA_MODEL.md "Forecast", docs/MODEL.md "Backtest").
 *
 * etl/backtest.py keeps every forward number the site shows that a later
 * official outturn can score as a Forecast record, in
 * data/build/forecasts/<maker>/<edition>.json. Records are append-only, like a
 * card's timeline: `pnpm validate --base` rejects a changed or removed one. The
 * same job compares each record whose period has an outturn with it and writes
 * data/build/backtest.json, worked out again on every run.
 */

/** Who made the forecast: the OBR, the ONS, or this site. Official forecasts are never presented as ours. */
export const ForecastMaker = z.enum(["obr", "ons", "public_ledger"]);
export type ForecastMaker = z.infer<typeof ForecastMaker>;

export const ForecastRecord = z
  .object({
    /** "<maker>:<edition>:<series_id>:<period>" */
    id: z.string().min(1),
    series_id: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/),
    /** "2026-27" (fiscal year) or "2026" (year to 30 June, ONS population). */
    period: z.string().regex(/^\d{4}(-\d{2})?$/),
    unit: z.string().min(1),
    predicted: Range,
    /** "point": published as a single number (low = central = high), so it can only hit by matching exactly. */
    range: z.enum(["range", "point"]),
    quality: Quality,
    /** The day this site recorded it. */
    recorded_on: IsoDate,
    /** "shown": the site showed it as a forecast. "context": an earlier official forecast, recorded after its period ended, for the backtest. */
    recorded_as: z.enum(["shown", "context"]),
    note: z.string().min(1).optional(),
    /** Our own model forecasts (none yet): the engine and scenario that made them. */
    engine_version: z.string().min(1).optional(),
    scenario_id: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const [lo, c, hi] = r.predicted;
    if ((r.range === "point") !== (lo === c && c === hi))
      ctx.addIssue({ code: "custom", path: ["range"], message: 'a "point" has low = central = high; a "range" does not' });
  });
export type ForecastRecord = z.infer<typeof ForecastRecord>;

export const ForecastFile = z
  .object({
    maker: ForecastMaker,
    /** Where the numbers come from: obr_efo, ons_npp; "public_ledger" for ours. */
    source_id: z.string().min(1),
    /** The edition, or for ours the editions it is worked out from ("EFO-2026-03+PESA-2026"). */
    vintage: z.string().min(1),
    /** The day the maker published it; for ours, the day it was first recorded. */
    made_on: IsoDate,
    /** For ours: "<source_id>:<edition>" of every input. */
    inputs: z.array(z.string().min(1)).optional(),
    /** One sentence on what the records are and how their ranges are made. */
    about: z.string().min(1),
    forecasts: z.array(ForecastRecord).min(1),
  })
  .strict()
  .superRefine((f, ctx) => {
    const ids = f.forecasts.map((r) => r.id);
    ids.forEach((id, i) => {
      if (ids.indexOf(id) !== i) ctx.addIssue({ code: "custom", path: ["forecasts", i, "id"], message: `duplicate forecast id ${id}` });
      if (!id.startsWith(`${f.maker}:${f.vintage}:`)) ctx.addIssue({ code: "custom", path: ["forecasts", i, "id"], message: `id must start with "${f.maker}:${f.vintage}:"` });
    });
  });
export type ForecastFile = z.infer<typeof ForecastFile>;

/** A record with its file's maker, source, edition and date: DATA_MODEL.md `Forecast`. */
export type Forecast = ForecastRecord & Pick<ForecastFile, "maker" | "source_id" | "vintage" | "made_on">;

export const flattenForecasts = (files: ForecastFile[]): Forecast[] =>
  files.flatMap((f) => f.forecasts.map((r) => ({ ...r, maker: f.maker, source_id: f.source_id, vintage: f.vintage, made_on: f.made_on })));

export const BacktestResult = z
  .object({
    forecast_id: z.string().min(1),
    outturn: z.number(),
    outturn_source_id: z.string().min(1),
    outturn_vintage: z.string().min(1),
    outturn_quality: Quality,
    /** hit: low <= outturn <= high. Otherwise the outturn came in above or below the range. */
    result: z.enum(["hit", "miss_above", "miss_below"]),
    /** How far outside the range, from its nearer edge, in the forecast's unit; 0 for a hit. */
    miss: z.number().nonnegative(),
    miss_pct: z.number().nullable(),
    /** Outturn minus the central forecast. */
    error: z.number(),
    error_pct: z.number().nullable(),
  })
  .strict();
export type BacktestResult = z.infer<typeof BacktestResult>;

export const BacktestTable = z
  .object({
    outturn_editions: z.array(z.object({ source_id: z.string().min(1), vintage: z.string().min(1) })),
    results: z.array(BacktestResult),
  })
  .strict();
export type BacktestTable = z.infer<typeof BacktestTable>;

/** A forecast with its score, once its period has an outturn. */
export type ScoredForecast = Forecast & { score: BacktestResult | null };

export function joinScores(forecasts: Forecast[], table: BacktestTable): ScoredForecast[] {
  const byId = new Map(table.results.map((r) => [r.forecast_id, r]));
  return forecasts.map((f) => ({ ...f, score: byId.get(f.id) ?? null }));
}

/** Results that name no recorded forecast: a sign the table is stale. */
export function orphanResults(forecasts: Forecast[], table: BacktestTable): string[] {
  const ids = new Set(forecasts.map((f) => f.id));
  return table.results.filter((r) => !ids.has(r.forecast_id)).map((r) => r.forecast_id);
}

// ------------------------------------------------------------------ what each series is

interface SeriesInfo {
  label: string;
  /** Who publishes the outturn that scores it, and how long after the period ends it usually comes. */
  outturn: string;
  outturnLagMonths: number;
}

const FISCAL_OUTTURN = { outturn: "ONS public sector finances (then the OBR's outturn)", outturnLagMonths: 1 };
const PESA_OUTTURN = { outturn: "HM Treasury public spending statistics (PESA)", outturnLagMonths: 4 };
const POPULATION_OUTTURN = { outturn: "ONS mid-year population estimates", outturnLagMonths: 15 };

export const FORECAST_SERIES: Record<string, SeriesInfo> = {
  "receipts.total": { label: "Income", ...FISCAL_OUTTURN },
  "spending.tme": { label: "Total spending", ...FISCAL_OUTTURN },
  "fiscal.psnb": { label: "Borrowing", ...FISCAL_OUTTURN },
  "spending.debt_interest": { label: "Debt interest", ...FISCAL_OUTTURN },
  "fiscal.psnd": { label: "Public debt", ...FISCAL_OUTTURN },
  "fiscal.psnd_pct_gdp": { label: "Public debt, % of GDP", ...FISCAL_OUTTURN },
  "people.births": { label: "Births", ...POPULATION_OUTTURN },
  "people.deaths": { label: "Deaths", ...POPULATION_OUTTURN },
};

/** Our split of spending by function: one series per Statement spending line. */
export const FUNCTION_SERIES_PREFIX = "statement.spending.";

/** Label and outturn of a series; spending lines take the Statement's own label. */
export function seriesInfo(seriesId: string, lineLabels: Record<string, string> = {}): SeriesInfo {
  if (seriesId.startsWith(FUNCTION_SERIES_PREFIX)) {
    const line = seriesId.slice(FUNCTION_SERIES_PREFIX.length);
    return { label: `Spending: ${lineLabels[line] ?? line}`, ...PESA_OUTTURN };
  }
  return FORECAST_SERIES[seriesId] ?? { label: seriesId, ...FISCAL_OUTTURN };
}

/** The last day of a period: 31 March for "2026-27", 30 June for "2026" (ONS years to mid-year). */
export function periodEnd(period: string): string {
  const fy = /^(\d{4})-\d{2}$/.exec(period);
  if (fy) return `${Number(fy[1]) + 1}-03-31`;
  return `${period}-06-30`;
}

/** The month an outturn is usually first published ("2027-04"), from the period's end and the publisher's usual delay. */
export function outturnExpected(f: Pick<Forecast, "series_id" | "period">): string {
  const [y, m] = periodEnd(f.period).split("-").map(Number) as [number, number];
  const months = y * 12 + (m - 1) + seriesInfo(f.series_id).outturnLagMonths;
  return `${Math.floor(months / 12)}-${String((months % 12) + 1).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ summary

export interface ResultCounts {
  scored: number;
  hit: number;
  miss_above: number;
  miss_below: number;
}

export interface BacktestSummary {
  recorded: number;
  scored: number;
  waiting: number;
  /** Forecasts with a range: the hit rate is worked out on these only. */
  ranged: ResultCounts;
  /** Forecasts published as a single number: they miss unless they match exactly, so they show how far off they were. */
  single: ResultCounts;
  /** Hits as a share of scored ranged forecasts; null until one is scored. */
  hit_rate: number | null;
  /** The earliest month a waiting forecast is expected to be scored, and how many are due then. */
  next_due: { month: string; count: number } | null;
}

const counts = (scored: ScoredForecast[]): ResultCounts => ({
  scored: scored.length,
  hit: scored.filter((f) => f.score!.result === "hit").length,
  miss_above: scored.filter((f) => f.score!.result === "miss_above").length,
  miss_below: scored.filter((f) => f.score!.result === "miss_below").length,
});

export function backtestSummary(rows: ScoredForecast[]): BacktestSummary {
  const scored = rows.filter((f) => f.score);
  const ranged = counts(scored.filter((f) => f.range === "range"));
  const waiting = rows.filter((f) => !f.score).map(outturnExpected).sort();
  const first = waiting[0];
  return {
    recorded: rows.length,
    scored: scored.length,
    waiting: rows.length - scored.length,
    ranged,
    single: counts(scored.filter((f) => f.range === "point")),
    hit_rate: ranged.scored ? ranged.hit / ranged.scored : null,
    next_due: first ? { month: first, count: waiting.filter((m) => m === first).length } : null,
  };
}

// ------------------------------------------------------------------ append-only

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/**
 * A forecast file only grows: compared with the published file, its maker,
 * source, edition and date are the same, and every record is still there,
 * unchanged and in place. New records may only be added at the end. The
 * one-line `about` may be reworded.
 */
export function forecastAppendOnlyIssues(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const issues: string[] = [];
  for (const k of ["maker", "source_id", "vintage", "made_on", "inputs"]) {
    if (stable(b[k]) !== stable(a[k])) issues.push(`${k} changed; a forecast file keeps its identity`);
  }
  const was = Array.isArray(b.forecasts) ? b.forecasts : [];
  const now = Array.isArray(a.forecasts) ? a.forecasts : [];
  was.forEach((r, i) => {
    if (stable(r) !== stable(now[i])) issues.push(`forecasts[${i}] was changed or removed; forecast records are append-only (add a new record instead)`);
  });
  return issues;
}
