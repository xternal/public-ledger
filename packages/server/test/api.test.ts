import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSeed } from "@ledger/schema/seed";
import { loadForecasts } from "@ledger/schema/forecasts";
import type { Status } from "@ledger/schema";
import {
  ACTOR_CSV_COLUMNS,
  CONTRACT_CSV_COLUMNS,
  FORECAST_CSV_COLUMNS,
  PROMISE_CSV_COLUMNS,
  STATEMENT_CSV_COLUMNS,
  STATEMENT_YEAR_CSV_COLUMNS,
  actorRows,
  actorsData,
  contractRows,
  contractsData,
  envelope,
  forecastRows,
  forecastsData,
  labelDate,
  licenceFor,
  parseCsv,
  promiseRows,
  promisesData,
  quoteLicence,
  splitFormat,
  statementIndex,
  statementIndexRows,
  statementYear,
  statementYearRows,
  toCsv,
  vintageChangelog,
  type Manifest,
} from "../src/api";

const seed = loadSeed();
const fc = loadForecasts();
const SITE = "https://ledger.test";
const statusLabel = Object.fromEntries(
  (["promised", "in_plan", "legislated", "funded", "delivering", "delivered", "failed", "quietly_dropped", "unscoreable"] as Status[]).map((s) => [s, `label:${s}`]),
) as Record<Status, string>;
const ctx = { siteUrl: SITE, statusLabel };
const keys = (o: object) => Object.keys(o).sort();
const FIGURE = ["method_note", "quality", "source_id", "unit", "value", "vintage"];

/** Field names are the API's contract: a rename must be a deliberate change here (and a new version if it breaks clients). */
describe("API v1 shapes", () => {
  it("wraps every dataset in the same envelope, with a licence and attribution", () => {
    const e = envelope("statement", "statement", { x: 1 }, { siteUrl: SITE, dataBuild: seed.builtAt });
    expect(keys(e)).toEqual(["api_version", "data", "data_build", "dataset", "docs_url", "licence"]);
    expect(e.api_version).toBe("v1");
    expect(e.docs_url).toBe(`${SITE}/method/api`);
    expect(e.licence.name).toBe("Open Government Licence v3.0");
    expect(e.licence.attribution).toContain(SITE);
    expect(licenceFor("promises", SITE).notes.join(" ")).toContain("Open Parliament Licence v3.0");
    expect(licenceFor("statement", SITE).notes.join(" ")).not.toContain("Parliament");
  });

  it("gives each statement number its unit, quality, source and edition", () => {
    const y = statementYear(seed, seed.baseYear, ctx)!;
    expect(keys(y)).toEqual(["kind", "lines", "macro", "note", "period", "totals", "url", "vintage", "vintage_label"]);
    expect(keys(y.totals)).toEqual(["borrowing", "receipts", "spending"]);
    expect(keys(y.macro)).toEqual(["bank_rate", "debt", "debt_pct_gdp", "households", "nominal_gdp", "population"]);
    for (const f of [...Object.values(y.totals), ...Object.values(y.macro)]) expect(keys(f)).toEqual(FIGURE);
    for (const l of y.lines) {
      expect(keys(l)).toEqual([...FIGURE, "id", "label", "plug", "side"].sort());
      expect(l.vintage).toBe(y.vintage);
      if (l.quality !== "training") expect(l.source_id).toBeTruthy();
    }
    // The statement balances in the API too (invariant 4).
    const sum = (side: string) => y.lines.filter((l) => l.side === side).reduce((a, l) => a + l.value, 0);
    expect(sum("receipt") + sum("borrowing") - sum("spending")).toBeCloseTo(0, 0);
    expect(statementYear(seed, "1999-00", ctx)).toBeNull();
  });

  it("lists every year, and names every source it cites", () => {
    const idx = statementIndex(seed, ctx);
    expect(idx.years.map((y) => y.period)).toEqual(seed.years.map((y) => y.period));
    expect(idx.years.every((y) => !("lines" in y))).toBe(true);
    const cited = new Set(idx.sources.map((s) => s.id));
    for (const y of idx.years) for (const f of Object.values(y.totals)) if (f.source_id) expect(cited.has(f.source_id)).toBe(true);
    expect(keys(idx.sources[0]!)).toEqual(["id", "licence", "published_on", "publisher", "title", "url"]);
  });

  it("shows promise cards with their full history, but nothing about readers", () => {
    const { promises } = promisesData(seed, ctx);
    expect(promises).toHaveLength(seed.cards.length);
    const p = promises.find((x) => x.cost)!;
    expect(keys(p)).toEqual(
      [
        "actor_id", "actor_name", "brought_about_by", "contracts", "corrections", "cost", "deadline", "events", "funded_by", "headline", "id", "made_on", "origin", "outcome_by", "party_id",
        "policy_area", "quote_checked_on", "quote_licence", "quote_source_url", "replies", "sources", "status", "status_label", "status_note", "text",
        "url", "venue", "venue_label", "version", "versions", "when", "who",
      ].sort(),
    );
    expect(keys(p.cost!)).toEqual(["central", "costed_by", "high", "low", "method_note", "quality", "sources", "unit"]);
    expect(p.cost!.low).toBeLessThanOrEqual(p.cost!.high);
    // AI Journalist's two rules read these (RFC 0001 Amendment 1): every cost names its maker, every card says who must act.
    const governments = new Set(seed.actors.filter((a) => a.kind === "government").map((a) => a.id));
    for (const x of promises) {
      for (const c of [x.cost, ...x.versions.map((v) => v.cost)]) if (c) expect(["official", "party", "independent"]).toContain(c.costed_by?.kind);
      expect(x.outcome_by === null || governments.has(x.outcome_by)).toBe(true);
    }
    expect(promises.some((x) => x.outcome_by === null)).toBe(true);
    // An opposition party's pledge rests with no body in power.
    expect(promises.filter((x) => seed.actors.find((a) => a.id === x.party_id)?.standing === "opposition" && x.status === "promised").map((x) => x.outcome_by)).not.toContain("hm-government");
    expect(p.status_label).toBe(`label:${p.status}`);
    const text = JSON.stringify(promises);
    for (const k of ["credit", "submission_ref", "email", "address", "subscription", "consent"]) expect(text).not.toContain(`"${k}"`);
  });

  it("counts each actor's cards by status", () => {
    const { actors } = actorsData(seed, ctx);
    expect(keys(actors[0]!)).toEqual(["by_status", "id", "kind", "name", "party_id", "promise_ids", "roles", "short_name", "url"]);
    const total = actors.filter((a) => a.kind === "party").reduce((n, a) => n + a.promise_ids.length, 0);
    expect(total).toBeLessThanOrEqual(seed.cards.length);
  });

  it("joins forecasts with their scores and labels them by maker", () => {
    const d = forecastsData(seed, fc.forecasts, fc.table);
    expect(keys(d)).toEqual(["forecasts", "outturn_editions", "sources", "summary"]);
    const f = d.forecasts[0]!;
    expect(keys(f)).toEqual(
      [
        "central", "high", "id", "label", "low", "made_on", "maker", "note", "outturn_expected", "outturn_source", "period", "quality", "range", "recorded_as",
        "recorded_on", "score", "series_id", "source_id", "unit", "vintage",
      ].sort(),
    );
    const scored = d.forecasts.find((x) => x.score)!;
    expect(keys(scored.score!)).toEqual(["error", "error_pct", "miss", "miss_pct", "outturn", "outturn_quality", "outturn_source_id", "outturn_vintage", "result"]);
    expect(d.summary.shown.recorded + d.summary.context.recorded).toBe(d.forecasts.length);
    expect(d.forecasts.some((x) => x.label.startsWith("Spending: "))).toBe(true);
  });

  it("serves contracts with the cards that link them", () => {
    const { contracts } = contractsData(seed);
    for (const c of contracts) expect(c.snapshots.length).toBeGreaterThan(0);
    expect(contractRows(seed)).toHaveLength(contracts.length);
  });
});

describe("API v1 CSV", () => {
  it("quotes fields that need it and leaves empty cells for none", () => {
    const csv = toCsv(["a", "b", "c"], [{ a: 'say "hi", then', b: null, c: 1.5 }]);
    expect(csv).toBe('a,b,c\r\n"say ""hi"", then",,1.5\r\n');
    expect(parseCsv(csv)).toEqual([{ a: 'say "hi", then', b: "", c: "1.5" }]);
  });

  it("keeps the columns it promises, one row per item", () => {
    const check = (columns: readonly string[], rows: Record<string, unknown>[]) => {
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(Object.keys(r)).toEqual([...columns]);
    };
    check(STATEMENT_CSV_COLUMNS, statementIndexRows(seed, ctx));
    check(STATEMENT_YEAR_CSV_COLUMNS, statementYearRows(statementYear(seed, seed.baseYear, ctx)!));
    check(PROMISE_CSV_COLUMNS, promiseRows(seed, ctx));
    check(ACTOR_CSV_COLUMNS, actorRows(seed, ctx));
    check(FORECAST_CSV_COLUMNS, forecastRows(seed, fc.forecasts));
    if (seed.contracts.length) check(CONTRACT_CSV_COLUMNS, contractRows(seed));
    expect(promiseRows(seed, ctx)).toHaveLength(seed.cards.length);
    const parsed = parseCsv(toCsv([...PROMISE_CSV_COLUMNS], promiseRows(seed, ctx)));
    expect(parsed.map((r) => r.id)).toEqual(seed.cards.map((c) => c.id));
  });
});

describe("API v1 helpers", () => {
  it("reads the format from the file name", () => {
    expect(splitFormat("2025-26.csv")).toEqual({ key: "2025-26", format: "csv" });
    expect(splitFormat("2025-26")).toEqual({ key: "2025-26", format: "json" });
    expect(splitFormat("2025-26.json")).toEqual({ key: "2025-26", format: "json" });
  });

  it("licenses quotes by where they were said", () => {
    expect(quoteLicence("https://hansard.parliament.uk/Commons/2026-07-22/debates/1")).toBe("Open Parliament Licence v3.0");
    expect(quoteLicence("https://www.gov.uk/government/news/x")).toBe("Open Government Licence v3.0");
    expect(quoteLicence("https://labour.org.uk/manifesto.pdf")).toMatch(/rights stay with the publisher/);
    expect(quoteLicence("not a url")).toMatch(/rights stay/);
  });
});

describe("changelog of data vintages", () => {
  const root = join(import.meta.dirname, "..", "..", "..");
  const manifest = JSON.parse(readFileSync(join(root, "data/build/manifest.json"), "utf8")) as Manifest;
  const artifacts = readFileSync(join(root, "data/build/history/artifacts.csv"), "utf8");

  it("lists every edition the build holds, newest first", () => {
    const log = vintageChangelog(manifest, artifacts);
    expect(log.length).toBe(manifest.sources.reduce((n, s) => n + s.vintages.length, 0));
    const dated = log.map((e) => e.published_on).filter((d): d is string => !!d);
    expect(dated).toEqual([...dated].sort().reverse());
    const efo = log.find((e) => e.source_id === "obr_efo")!;
    expect(efo).toMatchObject({ vintage: "EFO-2026-03", published_on: "2026-03-03", latest: true });
    expect(efo.first_loaded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("dates an edition from its label when the build has no date for it", () => {
    expect(labelDate("IADB IUDBEDR as of 2026-09-17")).toBe("2026-09-17");
    expect(labelDate("income-tax-rates@2026-10-01")).toBe("2026-10-01");
    expect(labelDate("EFO-2026-11")).toBe("2026-11-01");
    expect(labelDate("PESA-2026")).toBeNull();
    const m: Manifest = {
      build_id: "x",
      status: "ok",
      observations: 1,
      sources: [{ id: "obr_efo", title: "EFO", publisher: "OBR", url: "https://obr.uk/", vintages: ["EFO-2026-03", "EFO-2026-11"], freshness: { vintage: "EFO-2026-11", published_on: "2026-11-26" } }],
    };
    expect(vintageChangelog(m).map((e) => [e.vintage, e.published_on, e.latest])).toEqual([
      ["EFO-2026-11", "2026-11-26", true],
      ["EFO-2026-03", "2026-03-01", false],
    ]);
  });
});
