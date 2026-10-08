import "server-only";
import { loadSeed } from "@ledger/schema/seed";
import { loadPeople } from "@ledger/schema/people";
import { loadForecasts, readBuildText, type ForecastData } from "@ledger/schema/forecasts";
import type { PeopleBundle, Seed } from "@ledger/schema";
import { buildRuns, vintageChangelog, type BuildRun, type Manifest, type VintageEntry } from "@ledger/server/api";

/**
 * Seed data, parsed and cross-checked through the Zod schemas at build time.
 * A bad seed file fails the build rather than rendering wrong numbers.
 */
let cached: Seed | null = null;

export function getSeed(): Seed {
  cached ??= loadSeed();
  return cached;
}

let people: PeopleBundle | null = null;

/** /people: ONS population projections and OBR long-term spending (data/build/people.json), validated on first use. */
export function getPeople(): PeopleBundle {
  people ??= loadPeople();
  return people;
}

let forecasts: ForecastData | null = null;

/** Forecast records and their scores against outturn (M7): data/build/forecasts and backtest.json, validated on first use. */
export function getForecasts(): ForecastData {
  forecasts ??= loadForecasts();
  return forecasts;
}

let vintages: { manifest: Manifest; changelog: VintageEntry[]; runs: BuildRun[] } | null = null;

/** The data build's manifest, every edition it holds (newest first) and the run log, for /method and the API. */
export function getVintages() {
  if (!vintages) {
    const manifest = JSON.parse(readBuildText("data/build/manifest.json")) as Manifest;
    vintages = {
      manifest,
      changelog: vintageChangelog(manifest, readBuildText("data/build/history/artifacts.csv")),
      runs: buildRuns(readBuildText("data/build/history/runs.csv")),
    };
  }
  return vintages;
}
