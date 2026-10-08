import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./content-files";
import { BacktestTable, ForecastFile, flattenForecasts, joinScores, orphanResults, type ScoredForecast } from "./forecasts";

/**
 * data/build/forecasts/<maker>/<edition>.json and data/build/backtest.json,
 * read from disk (Node only: server components at build time, scripts, tests).
 */

export const FORECASTS_DIR = join("data", "build", "forecasts");
export const BACKTEST_FILE = join("data", "build", "backtest.json");

export interface RawForecastFile {
  /** Repo-relative, e.g. "data/build/forecasts/obr/EFO-2026-03.json". */
  path: string;
  data: unknown;
}

/** An edition label as a file name, as etl/backtest.py writes it: "EFO-2026-03+PESA-2026" → "EFO-2026-03_PESA-2026". */
export const forecastFileName = (vintage: string) => trimUnderscores(vintage.replace(/[^A-Za-z0-9.-]+/g, "_"));

/** Strips leading and trailing underscores in one pass (a /_+$/ regex can take quadratic time on long runs). */
function trimUnderscores(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === "_") start++;
  while (end > start && s[end - 1] === "_") end--;
  return s.slice(start, end);
}

export function readForecastFiles(root = repoRoot()): RawForecastFile[] {
  const dir = join(root, FORECASTS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((maker) =>
      readdirSync(join(dir, maker))
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => {
          const path = join(FORECASTS_DIR, maker, f);
          return { path, data: JSON.parse(readFileSync(join(root, path), "utf8")) };
        }),
    );
}

export interface ForecastData {
  files: ForecastFile[];
  forecasts: ScoredForecast[];
  table: BacktestTable;
}

/** Parse and cross-check every forecast file and the backtest table; returns the data and any problems. */
export function parseForecasts(raw: RawForecastFile[], rawTable: unknown): { data: ForecastData | null; issues: string[] } {
  const issues: string[] = [];
  const files: ForecastFile[] = [];
  for (const f of raw) {
    const r = ForecastFile.safeParse(f.data);
    if (!r.success) {
      issues.push(...r.error.issues.map((i) => `${f.path}:${i.path.join(".")}: ${i.message}`));
      continue;
    }
    const [maker, name] = f.path.split(/[\\/]/).slice(-2);
    if (maker !== r.data.maker) issues.push(`${f.path}: maker "${r.data.maker}" does not match its folder`);
    if (name !== `${forecastFileName(r.data.vintage)}.json`) issues.push(`${f.path}: file name should be ${forecastFileName(r.data.vintage)}.json`);
    files.push(r.data);
  }
  const t = BacktestTable.safeParse(rawTable ?? { outturn_editions: [], results: [] });
  if (!t.success) issues.push(...t.error.issues.map((i) => `${BACKTEST_FILE}:${i.path.join(".")}: ${i.message}`));
  const forecasts = flattenForecasts(files);
  const ids = forecasts.map((f) => f.id);
  ids.forEach((id, i) => {
    if (ids.indexOf(id) !== i) issues.push(`forecast id ${id} is recorded twice`);
  });
  if (t.success) for (const id of orphanResults(forecasts, t.data)) issues.push(`${BACKTEST_FILE}: result for ${id}, which is not a recorded forecast; run python -m etl.backtest`);
  if (issues.length || !t.success) return { data: null, issues };
  return { data: { files, forecasts: joinScores(forecasts, t.data), table: t.data }, issues };
}

/** A committed build file as text, e.g. "data/build/history/runs.csv"; "" when it is missing. */
export function readBuildText(rel: string, root = repoRoot()): string {
  const path = join(root, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function readBacktestTable(root = repoRoot()): unknown {
  const path = join(root, BACKTEST_FILE);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

/** The forecasts and their scores. Throws on a bad file, so the build fails rather than publishing a wrong score. */
export function loadForecasts(root = repoRoot()): ForecastData {
  const { data, issues } = parseForecasts(readForecastFiles(root), readBacktestTable(root));
  if (!data) throw new Error(`Forecast data failed validation:\n${issues.map((i) => `  ${i}`).join("\n")}`);
  return data;
}
