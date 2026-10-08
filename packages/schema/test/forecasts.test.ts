import { describe, expect, it } from "vitest";
import {
  BacktestTable,
  ForecastFile,
  ForecastRecord,
  backtestSummary,
  flattenForecasts,
  forecastAppendOnlyIssues,
  joinScores,
  outturnExpected,
  periodEnd,
  seriesInfo,
  type BacktestResult,
} from "../src/forecasts";
import { forecastFileName, loadForecasts, parseForecasts } from "../src/forecasts-data";

const rec = (over: Partial<ForecastRecord> = {}): ForecastRecord => ({
  id: "obr:EFO-2026-03:fiscal.psnb:2026-27",
  series_id: "fiscal.psnb",
  period: "2026-27",
  unit: "gbp_bn",
  predicted: [115.461, 115.461, 115.461],
  range: "point",
  quality: "sourced",
  recorded_on: "2026-10-08",
  recorded_as: "shown",
  ...over,
});

const file = (forecasts: ForecastRecord[] = [rec()], over: Partial<ForecastFile> = {}): ForecastFile => ({
  maker: "obr",
  source_id: "obr_efo",
  vintage: "EFO-2026-03",
  made_on: "2026-03-03",
  about: "OBR forecasts as the Statement shows them.",
  forecasts,
  ...over,
});

const result = (forecast_id: string, over: Partial<BacktestResult> = {}): BacktestResult => ({
  forecast_id,
  outturn: 120,
  outturn_source_id: "ons_psf",
  outturn_vintage: "PSF-2027-04",
  outturn_quality: "sourced",
  result: "miss_above",
  miss: 4.539,
  miss_pct: 3.93,
  error: 4.539,
  error_pct: 3.93,
  ...over,
});

describe("forecast records (M7)", () => {
  it("parses the committed forecasts and backtest table, with every result naming a recorded forecast", () => {
    const { files, forecasts, table } = loadForecasts();
    expect(files.length).toBeGreaterThan(0);
    expect(forecasts.filter((f) => f.score).length).toBe(table.results.length);
    // Official forecasts are labelled as theirs; ours are approx or modelled, never "sourced".
    for (const f of forecasts) {
      if (f.maker === "public_ledger") expect(f.quality).not.toBe("sourced");
      else expect(f.source_id).not.toBe("public_ledger");
    }
  });

  it("keeps point and range honest", () => {
    expect(ForecastRecord.safeParse(rec()).success).toBe(true);
    expect(ForecastRecord.safeParse(rec({ range: "range" })).success).toBe(false);
    expect(ForecastRecord.safeParse(rec({ predicted: [1, 2, 3], range: "point" })).success).toBe(false);
    expect(ForecastRecord.safeParse(rec({ predicted: [3, 2, 1], range: "range" })).success).toBe(false); // unordered
    expect(ForecastRecord.safeParse({ ...rec(), outturn: 3 }).success).toBe(false); // outturn lives in the backtest table
  });

  it("checks ids against their file", () => {
    expect(ForecastFile.safeParse(file()).success).toBe(true);
    expect(ForecastFile.safeParse(file([rec(), rec()])).success).toBe(false);
    expect(ForecastFile.safeParse(file([rec({ id: "ons:EFO-2026-03:fiscal.psnb:2026-27" })])).success).toBe(false);
  });

  it("names files after the edition and checks the folder", () => {
    expect(forecastFileName("EFO-2026-03+PESA-2026")).toBe("EFO-2026-03_PESA-2026");
    expect(forecastFileName("  EFO-2026-03 (rev) ")).toBe("EFO-2026-03_rev");
    expect(forecastFileName("_".repeat(50_000) + "x")).toBe("x");
    const ok = parseForecasts([{ path: "data/build/forecasts/obr/EFO-2026-03.json", data: file() }], undefined);
    expect(ok.issues).toEqual([]);
    const bad = parseForecasts([{ path: "data/build/forecasts/ons/EFO-2026-03.json", data: file() }], undefined);
    expect(bad.issues.join()).toMatch(/does not match its folder/);
    const orphan = parseForecasts([{ path: "data/build/forecasts/obr/EFO-2026-03.json", data: file() }], { outturn_editions: [], results: [result("obr:x:y:2020-21")] });
    expect(orphan.issues.join()).toMatch(/not a recorded forecast/);
  });

  it("is append-only: records stay as published, new ones go at the end", () => {
    const before = file([rec()]);
    const grown = file([rec(), rec({ id: "obr:EFO-2026-03:fiscal.psnb:2027-28", period: "2027-28" })]);
    expect(forecastAppendOnlyIssues(before, grown)).toEqual([]);
    expect(forecastAppendOnlyIssues(before, { ...before, about: "Reworded." })).toEqual([]);
    expect(forecastAppendOnlyIssues(before, file([rec({ predicted: [120, 120, 120] })]))[0]).toMatch(/append-only/);
    expect(forecastAppendOnlyIssues(before, file([]))[0]).toMatch(/forecasts\[0\]/);
    expect(forecastAppendOnlyIssues(before, file([rec()], { made_on: "2026-03-04" }))[0]).toMatch(/made_on changed/);
  });
});

describe("backtest summary", () => {
  const ranged = rec({ id: "ons:NPP:people.births:2026", series_id: "people.births", period: "2026", unit: "persons_k", predicted: [637, 653, 668], range: "range" });
  const files = [file([rec(), rec({ id: "obr:EFO-2026-03:fiscal.psnb:2025-26", period: "2025-26", recorded_as: "context" })]), file([ranged], { maker: "ons", source_id: "ons_npp", vintage: "NPP" })];

  it("works out the hit rate on ranged forecasts only", () => {
    const table = BacktestTable.parse({ outturn_editions: [], results: [result("obr:EFO-2026-03:fiscal.psnb:2025-26"), result("ons:NPP:people.births:2026", { result: "hit", miss: 0, miss_pct: 0 })] });
    const s = backtestSummary(joinScores(flattenForecasts(files), table));
    expect(s).toMatchObject({ recorded: 3, scored: 2, waiting: 1, hit_rate: 1 });
    expect(s.single).toEqual({ scored: 1, hit: 0, miss_above: 1, miss_below: 0 });
    expect(s.next_due).toEqual({ month: "2027-04", count: 1 });
  });

  it("has no hit rate until a ranged forecast is scored", () => {
    const rows = joinScores(flattenForecasts(files), { outturn_editions: [], results: [] });
    expect(backtestSummary(rows).hit_rate).toBeNull();
    // What the site showed: 2026-27 public finances come before births to mid-2026.
    expect(backtestSummary(rows.filter((f) => f.recorded_as === "shown")).next_due).toEqual({ month: "2027-04", count: 1 });
  });

  it("knows when each outturn is due", () => {
    expect(periodEnd("2026-27")).toBe("2027-03-31");
    expect(periodEnd("2026")).toBe("2026-06-30");
    expect(outturnExpected({ series_id: "fiscal.psnb", period: "2026-27" })).toBe("2027-04");
    expect(outturnExpected({ series_id: "statement.spending.health", period: "2026-27" })).toBe("2027-07");
    expect(outturnExpected({ series_id: "people.births", period: "2025" })).toBe("2026-09");
    expect(seriesInfo("statement.spending.health", { health: "Health" }).label).toBe("Spending: Health");
  });
});
