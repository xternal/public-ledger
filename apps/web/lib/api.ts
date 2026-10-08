import "server-only";
import {
  ACTOR_CSV_COLUMNS,
  CONTRACT_CSV_COLUMNS,
  FORECAST_CSV_COLUMNS,
  PROMISE_CSV_COLUMNS,
  STATEMENT_CSV_COLUMNS,
  STATEMENT_YEAR_CSV_COLUMNS,
  VINTAGE_CSV_COLUMNS,
  actorRows,
  actorsData,
  contractRows,
  contractsData,
  csvResponse,
  envelope,
  forecastRows,
  forecastsData,
  jsonResponse,
  licenceFor,
  notFound,
  promiseOut,
  promiseRows,
  promisesData,
  statementIndex,
  statementIndexRows,
  statementYear,
  statementYearRows,
  toCsv,
  type Cell,
  type Dataset,
} from "@ledger/server/api";
import { getForecasts, getSeed, getVintages } from "./data";
import { STATUS_LABEL } from "./copy";
import { siteUrl } from "./site";

/**
 * The public read-only API, /api/v1 (M7). Every route is static: built at
 * deploy time from the committed data and content, served from the edge with
 * open CORS for GET. Documented at /method/api.
 */

const ctx = () => ({ siteUrl: siteUrl(), statusLabel: STATUS_LABEL });
const meta = () => ({ siteUrl: siteUrl(), dataBuild: getSeed().builtAt });

const json = (dataset: Dataset, path: string, data: unknown) => jsonResponse(envelope(dataset, path, data, meta()));
const csv = <T extends Record<string, Cell>>(dataset: Dataset, name: string, columns: readonly (keyof T & string)[], rows: T[]) =>
  csvResponse(toCsv([...columns], rows), name, licenceFor(dataset, siteUrl()));

export interface Endpoint {
  path: string;
  /** A real URL path to try, e.g. the base year for {year}. */
  example: string;
  csv: boolean;
  about: string;
}

/** What the API offers, for the index and the docs page. Examples use real ids from the data. */
export const endpoints = (): Endpoint[] => [
  { path: "/api/v1/statement", example: "/api/v1/statement", csv: true, about: "Every year: income, spending, borrowing, debt and GDP, outturn or OBR forecast." },
  { path: "/api/v1/statement/{year}", example: `/api/v1/statement/${getSeed().baseYear}`, csv: true, about: "One year, line by line: every income and spending line, and borrowing." },
  { path: "/api/v1/promises", example: "/api/v1/promises", csv: true, about: "Every promise card: the quote, cost range, status and full history." },
  { path: "/api/v1/promises/{id}", example: `/api/v1/promises/${getSeed().cards[0]?.id ?? ""}`, csv: false, about: "One promise card." },
  { path: "/api/v1/actors", example: "/api/v1/actors", csv: true, about: "People, parties and the government, with their cards counted by status." },
  { path: "/api/v1/forecasts", example: "/api/v1/forecasts", csv: true, about: "Every recorded forecast and, once the outturn is in, how it scored." },
  { path: "/api/v1/contracts", example: "/api/v1/contracts", csv: true, about: "Public contracts linked to promise cards, with every change in value or dates." },
  { path: "/api/v1/vintages", example: "/api/v1/vintages", csv: true, about: "Every edition of every source the data holds, newest first." },
];

export const api = {
  index: () =>
    json("index", "", {
      endpoints: endpoints().map((e) => ({
        path: e.path,
        url: `${siteUrl()}${e.example}`,
        formats: e.csv ? ["json", "csv"] : ["json"],
        ...(e.csv ? { csv_url: `${siteUrl()}${e.example}.csv` } : {}),
        about: e.about,
      })),
      years: getSeed().years.map((y) => y.period),
    }),

  statement: (format: "json" | "csv") =>
    format === "csv" ? csv("statement", "statement", STATEMENT_CSV_COLUMNS, statementIndexRows(getSeed(), ctx())) : json("statement", "statement", statementIndex(getSeed(), ctx())),

  statementYear: (year: string, format: "json" | "csv") => {
    const seed = getSeed();
    const y = statementYear(seed, year, ctx());
    if (!y) return notFound(`No statement for ${year}`);
    if (format === "csv") return csv("statement", `statement-${year}`, STATEMENT_YEAR_CSV_COLUMNS, statementYearRows(y));
    const ids = new Set(y.lines.map((l) => l.source_id).concat(...Object.values(y.macro).map((f) => f.source_id)));
    return json("statement", `statement/${year}`, { ...y, sources: seed.sources.filter((s) => ids.has(s.id)) });
  },

  promises: (format: "json" | "csv") =>
    format === "csv" ? csv("promises", "promises", PROMISE_CSV_COLUMNS, promiseRows(getSeed(), ctx())) : json("promises", "promises", promisesData(getSeed(), ctx())),

  promise: (id: string) => {
    const card = getSeed().cards.find((c) => c.id === id);
    return card ? json("promises", `promises/${id}`, promiseOut(card, ctx())) : notFound(`No promise card ${id}`);
  },

  actors: (format: "json" | "csv") =>
    format === "csv" ? csv("actors", "actors", ACTOR_CSV_COLUMNS, actorRows(getSeed(), ctx())) : json("actors", "actors", actorsData(getSeed(), ctx())),

  forecasts: (format: "json" | "csv") => {
    const { forecasts, table } = getForecasts();
    return format === "csv"
      ? csv("forecasts", "forecasts", FORECAST_CSV_COLUMNS, forecastRows(getSeed(), forecasts))
      : json("forecasts", "forecasts", forecastsData(getSeed(), forecasts, table));
  },

  contracts: (format: "json" | "csv") =>
    format === "csv" ? csv("contracts", "contracts", CONTRACT_CSV_COLUMNS, contractRows(getSeed())) : json("contracts", "contracts", contractsData(getSeed())),

  vintages: (format: "json" | "csv") => {
    const { changelog, runs } = getVintages();
    return format === "csv"
      ? csv("vintages", "vintages", VINTAGE_CSV_COLUMNS, changelog.map((e) => ({ ...e })))
      : json("vintages", "vintages", { editions: changelog, builds: runs.slice(0, 30) });
  },
};
