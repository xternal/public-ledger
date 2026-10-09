import type { ContractFile, Forecast, Quality, ScoredForecast, Seed, Source, StatementSeed, Status } from "@ledger/schema";
import { backtestSummary, contractChange, outturnExpected, seriesInfo, type BacktestSummary, type BacktestTable } from "@ledger/schema";
import { quoteLicence, type Cell } from "./envelope";

/**
 * The datasets behind /api/v1, as plain objects (JSON) and flat rows (CSV).
 * Every number travels with its provenance: unit, quality, source_id and the
 * edition (vintage) it comes from. Only public material is read: the build
 * bundle, the promise cards and actors, contract records and forecasts.
 */

export interface Ctx {
  siteUrl: string;
  /** Reader-facing status labels ("Not met" for failed), as the site shows them. */
  statusLabel: Record<Status, string>;
}

/** A number with its provenance. */
export interface Figure {
  value: number;
  unit: string;
  quality: Quality;
  source_id: string | null;
  vintage: string;
  method_note: string | null;
}

export interface SourceOut {
  id: string;
  title: string;
  publisher: string;
  url: string;
  published_on: string | null;
  licence: string | null;
}

const sourceOut = (s: Source): SourceOut => ({
  id: s.id,
  title: s.title,
  publisher: s.publisher,
  url: s.url,
  published_on: s.published_on ?? null,
  licence: s.licence ?? null,
});

/** Only the sources a dataset cites, in the seed's order. */
const cited = (seed: Seed, ids: Iterable<string | null | undefined>): SourceOut[] => {
  const want = new Set([...ids].filter((x): x is string => !!x));
  return seed.sources.filter((s) => want.has(s.id)).map(sourceOut);
};

const QUALITY_ORDER: Quality[] = ["sourced", "approx", "modelled", "training"];
const weakest = (qs: Quality[]): Quality => qs.reduce((a, q) => (QUALITY_ORDER.indexOf(q) > QUALITY_ORDER.indexOf(a) ? q : a), "sourced");
const round = (x: number, dp = 3) => Math.round(x * 10 ** dp) / 10 ** dp;

// ------------------------------------------------------------------ statement

export type StatementSide = "receipt" | "spending" | "borrowing";

export interface StatementLineOut extends Figure {
  id: string;
  side: StatementSide;
  label: string;
  /** A balancing residual, not a real breakdown. */
  plug: boolean;
}

export interface StatementYearOut {
  period: string;
  kind: "outturn" | "estimate" | "forecast";
  vintage: string;
  vintage_label: string;
  note: string;
  url: string;
  totals: { receipts: Figure; spending: Figure; borrowing: Figure };
  macro: { nominal_gdp: Figure; debt: Figure; debt_pct_gdp: Figure; bank_rate: Figure; households: Figure; population: Figure };
  lines: StatementLineOut[];
}

function macroFigure(s: StatementSeed, key: keyof StatementSeed["macro"]["provenance"] & string, value: number, unit: string): Figure {
  const p = s.macro.provenance[key]!;
  return { value: round(value), unit, quality: p.quality, source_id: p.source_id ?? null, vintage: s.meta.vintage, method_note: p.method_note ?? null };
}

function total(s: StatementSeed, side: "receipts" | "spending"): Figure {
  const lines = s[side];
  return {
    value: round(lines.reduce((a, l) => a + l.bn, 0)),
    unit: "gbp_bn",
    quality: weakest(lines.map((l) => l.quality)),
    source_id: s.borrowing_provenance.source_id ?? null,
    vintage: s.meta.vintage,
    method_note: `Sum of the ${lines.length} ${side === "receipts" ? "income" : "spending"} lines; each line has its own source.`,
  };
}

export function statementYear(seed: Seed, period: string, ctx: Ctx): StatementYearOut | null {
  const s = seed.statements[period];
  if (!s) return null;
  const kind = seed.years.find((y) => y.period === period)?.kind ?? s.meta.kind ?? "outturn";
  const line = (side: StatementSide) => (l: StatementSeed["receipts"][number]): StatementLineOut => ({
    id: l.id,
    side,
    label: l.label,
    value: round(l.bn),
    unit: "gbp_bn",
    quality: l.quality,
    source_id: l.source_id ?? null,
    vintage: s.meta.vintage,
    method_note: l.method_note ?? null,
    plug: !!l.plug,
  });
  const borrowing: Figure = {
    value: round(s.borrowing_bn),
    unit: "gbp_bn",
    quality: s.borrowing_provenance.quality,
    source_id: s.borrowing_provenance.source_id ?? null,
    vintage: s.meta.vintage,
    method_note: s.borrowing_provenance.method_note ?? null,
  };
  const m = s.macro;
  return {
    period,
    kind,
    vintage: s.meta.vintage,
    vintage_label: s.meta.vintage_label,
    note: s.meta.note,
    url: `${ctx.siteUrl}/api/v1/statement/${period}`,
    totals: { receipts: total(s, "receipts"), spending: total(s, "spending"), borrowing },
    macro: {
      nominal_gdp: macroFigure(s, "nominal_gdp_bn", m.nominal_gdp_bn, "gbp_bn"),
      debt: macroFigure(s, "psnd_bn", m.psnd_bn, "gbp_bn"),
      debt_pct_gdp: macroFigure(s, "psnd_pct_gdp", m.psnd_pct_gdp, "pct_gdp"),
      bank_rate: macroFigure(s, "bank_rate_pct", m.bank_rate_pct, "rate_pct"),
      households: macroFigure(s, "households_m", m.households_m, "households_m"),
      population: macroFigure(s, "population_m", m.population_m, "persons_m"),
    },
    lines: [
      ...s.receipts.map(line("receipt")),
      { id: "borrowing", side: "borrowing", label: "Borrowing", ...borrowing, plug: false },
      ...s.spending.map(line("spending")),
    ],
  };
}

export function statementIndex(seed: Seed, ctx: Ctx) {
  const years = seed.years.map((y) => statementYear(seed, y.period, ctx)!).map(({ lines: _lines, ...rest }) => rest);
  const ids = seed.years.flatMap((y) => {
    const s = seed.statements[y.period]!;
    return [...s.receipts, ...s.spending].map((l) => l.source_id).concat(s.borrowing_provenance.source_id, ...Object.values(s.macro.provenance).map((p) => p.source_id));
  });
  return { base_year: seed.baseYear, years, sources: cited(seed, ids) };
}

const FIGURE_COLUMNS = ["value", "unit", "quality", "source_id", "vintage", "method_note"] as const;
export const STATEMENT_CSV_COLUMNS = ["period", "kind", "measure", "label", ...FIGURE_COLUMNS] as const;
export type StatementCsvRow = Record<(typeof STATEMENT_CSV_COLUMNS)[number], Cell>;

const figureCells = (f: Figure) => ({ value: f.value, unit: f.unit, quality: f.quality, source_id: f.source_id, vintage: f.vintage, method_note: f.method_note });

/** Long format: one row per number, so each keeps its own provenance. */
export function statementIndexRows(seed: Seed, ctx: Ctx): StatementCsvRow[] {
  return statementIndex(seed, ctx).years.flatMap((y) =>
    [
      ...Object.entries(y.totals).map(([k, f]) => ({ measure: k, label: k === "receipts" ? "Income" : k === "spending" ? "Spending" : "Borrowing", f })),
      ...Object.entries(y.macro).map(([k, f]) => ({ measure: k, label: MACRO_LABEL[k as keyof typeof MACRO_LABEL], f })),
    ].map(({ measure, label, f }) => ({ period: y.period, kind: y.kind, measure, label, ...figureCells(f) })),
  );
}

const MACRO_LABEL = {
  nominal_gdp: "Nominal GDP",
  debt: "Public debt",
  debt_pct_gdp: "Public debt, % of GDP",
  bank_rate: "Bank Rate",
  households: "Households",
  population: "Population",
} as const;

export const STATEMENT_YEAR_CSV_COLUMNS = ["period", "kind", "side", "id", "label", ...FIGURE_COLUMNS, "plug"] as const;
export type StatementYearCsvRow = Record<(typeof STATEMENT_YEAR_CSV_COLUMNS)[number], Cell>;

export function statementYearRows(y: StatementYearOut): StatementYearCsvRow[] {
  return y.lines.map((l) => ({ period: y.period, kind: y.kind, side: l.side, id: l.id, label: l.label, ...figureCells(l), plug: l.plug }));
}

// ------------------------------------------------------------------ promises

export interface CostOut {
  /** Cost to the public purse a year, in £bn: positive costs money, negative raises it. */
  low: number;
  central: number;
  high: number;
  unit: "gbp_bn_per_year";
  /** "sourced" when the central figure comes from the costing sources listed; the low–high range may be editorial, as the note says. */
  quality: Quality;
  method_note: string | null;
  sources: { title: string; url: string }[];
  /**
   * Who made the central figure (PROMISE_STANDARD §2). official: the OBR, HMRC, HM Treasury or another UK government
   * department, or a devolved government's equivalent. party: the promise-maker's own figure. independent: anyone else
   * (IFS, think tanks, academics). Set on every cost; CI enforces it.
   */
  costed_by: { kind: "official" | "party" | "independent"; name: string } | null;
}

export interface PromiseOut {
  id: string;
  url: string;
  /** The editors' neutral 3–8 word summary of what is promised; null until written. The quote (text) is the record. */
  headline: string | null;
  actor_id: string;
  actor_name: string;
  party_id: string | null;
  made_on: string;
  venue: string | null;
  venue_label: string | null;
  policy_area: string;
  status: Status;
  status_label: string;
  status_note: string | null;
  deadline: string | null;
  /**
   * The body that would have to act to deliver the promise as worded, as of now (an actor id of kind government,
   * named by its role: hm-government, a devolved government, a council). null when no body in power is committed to
   * it, such as an opposition party's pledge (PROMISE_STANDARD §11). Until 9 Oct 2026 this field carried what
   * brought_about_by carries now.
   */
  outcome_by: string | null;
  /** Who brought about the current status when it was not the card's own actor (credit); null otherwise. */
  brought_about_by: string | null;
  origin: string;
  text: string;
  version: number;
  quote_source_url: string;
  quote_checked_on: string | null;
  quote_licence: string;
  who: string | null;
  when: string | null;
  funded_by: string | null;
  cost: CostOut | null;
  sources: { title: string; url: string; archived_url: string | null }[];
  versions: { version: number; text: string; recorded_on: string; source_url: string; quote_checked_on: string | null; cost: CostOut | null }[];
  events: { date: string; type: string; text: string; evidence_url: string | null; auto: boolean }[];
  replies: { from_actor_id: string; date: string; text: string; editor_response: string | null }[];
  corrections: { date: string; path: string; was: unknown; now: unknown; reason: string; source_url: string | null }[];
  contracts: string[];
}

type Card = Seed["cards"][number];

function costOf(p: Card["current"]["parameters"]): CostOut | null {
  const r = p?.how_much_bn_per_year;
  if (!p || !r) return null;
  return {
    low: r[0],
    central: r[1],
    high: r[2],
    unit: "gbp_bn_per_year",
    quality: p.cost_sources?.length ? "sourced" : "approx",
    method_note: p.cost_note ?? null,
    sources: (p.cost_sources ?? []).map((s) => ({ title: s.title, url: s.url })),
    costed_by: p.costed_by ? { kind: p.costed_by.kind, name: p.costed_by.name } : null,
  };
}

/** A card as the API shows it. A reader's credit handle and submission reference are left out. */
export function promiseOut(c: Card, ctx: Ctx): PromiseOut {
  const f = c.file;
  const p = c.current.parameters;
  return {
    id: c.id,
    url: `${ctx.siteUrl}/promise/${c.id}`,
    headline: f.headline ?? null,
    actor_id: c.actor.id,
    actor_name: c.actor.name,
    party_id: c.party?.id ?? null,
    made_on: f.made_on,
    venue: f.venue ?? null,
    venue_label: f.venue_label ?? null,
    policy_area: f.policy_area,
    status: f.status,
    status_label: ctx.statusLabel[f.status],
    status_note: f.status_note ?? null,
    deadline: f.deadline ?? null,
    outcome_by: c.outcomeBy?.id ?? null,
    brought_about_by: c.broughtAboutBy?.id ?? null,
    origin: f.origin,
    text: c.current.text,
    version: c.current.version,
    quote_source_url: c.current.source_url,
    quote_checked_on: c.current.quote_checked_on ?? null,
    quote_licence: quoteLicence(c.current.source_url),
    who: p?.who ?? null,
    when: p?.when ?? null,
    funded_by: p?.funded_by ?? null,
    cost: costOf(p),
    sources: f.sources.map((s) => ({ title: s.title, url: s.url, archived_url: s.archived_url ?? null })),
    versions: f.versions.map((v) => ({ version: v.version, text: v.text, recorded_on: v.recorded_on, source_url: v.source_url, quote_checked_on: v.quote_checked_on ?? null, cost: costOf(v.parameters) })),
    events: f.events.map((e) => ({ date: e.date, type: e.type, text: e.text, evidence_url: e.evidence_url ?? null, auto: !!e.auto })),
    replies: f.replies.map((r) => ({ from_actor_id: r.from_actor_id, date: r.date, text: r.text, editor_response: r.editor_response ?? null })),
    corrections: f.corrections.map((x) => ({ date: x.date, path: x.path, was: x.was ?? null, now: x.now ?? null, reason: x.reason, source_url: x.source_url ?? null })),
    contracts: c.contracts.map((k) => k.key),
  };
}

export const promisesData = (seed: Seed, ctx: Ctx) => ({ promises: seed.cards.map((c) => promiseOut(c, ctx)) });

export const PROMISE_CSV_COLUMNS = [
  "id",
  "url",
  "actor_id",
  "actor_name",
  "party_id",
  "made_on",
  "venue",
  "policy_area",
  "status",
  "status_label",
  "deadline",
  "text",
  "version",
  "quote_source_url",
  "quote_checked_on",
  "quote_licence",
  "cost_low_bn",
  "cost_central_bn",
  "cost_high_bn",
  "cost_quality",
  "cost_note",
  "cost_source_url",
  "funded_by",
  "events",
  "last_event_date",
  // Added 9 Oct 2026, at the end so existing column positions stay the same.
  "outcome_by",
  "brought_about_by",
  "cost_costed_by_kind",
  "cost_costed_by_name",
] as const;
export type PromiseCsvRow = Record<(typeof PROMISE_CSV_COLUMNS)[number], Cell>;

export function promiseRows(seed: Seed, ctx: Ctx): PromiseCsvRow[] {
  return promisesData(seed, ctx).promises.map((p) => ({
    id: p.id,
    url: p.url,
    actor_id: p.actor_id,
    actor_name: p.actor_name,
    party_id: p.party_id,
    made_on: p.made_on,
    venue: p.venue,
    policy_area: p.policy_area,
    status: p.status,
    status_label: p.status_label,
    deadline: p.deadline,
    text: p.text,
    version: p.version,
    quote_source_url: p.quote_source_url,
    quote_checked_on: p.quote_checked_on,
    quote_licence: p.quote_licence,
    cost_low_bn: p.cost?.low,
    cost_central_bn: p.cost?.central,
    cost_high_bn: p.cost?.high,
    cost_quality: p.cost?.quality,
    cost_note: p.cost?.method_note,
    cost_source_url: p.cost?.sources[0]?.url,
    funded_by: p.funded_by,
    events: p.events.length,
    last_event_date: p.events.map((e) => e.date).sort().at(-1),
    outcome_by: p.outcome_by,
    brought_about_by: p.brought_about_by,
    cost_costed_by_kind: p.cost?.costed_by?.kind,
    cost_costed_by_name: p.cost?.costed_by?.name,
  }));
}

// ------------------------------------------------------------------ actors

export interface ActorOut {
  id: string;
  name: string;
  short_name: string | null;
  kind: string;
  party_id: string | null;
  url: string;
  roles: { title: string; from: string | null; to: string | null }[];
  /** Cards made by the actor, or for a party by it and its people. */
  promise_ids: string[];
  by_status: Partial<Record<Status, number>>;
}

export function actorsData(seed: Seed, ctx: Ctx) {
  return {
    actors: seed.actors.map((a): ActorOut => {
      const cards = seed.cards.filter((c) => c.actor.id === a.id || c.party?.id === a.id);
      const by: Partial<Record<Status, number>> = {};
      for (const c of cards) by[c.file.status] = (by[c.file.status] ?? 0) + 1;
      return {
        id: a.id,
        name: a.name,
        short_name: a.short_name ?? null,
        kind: a.kind,
        party_id: a.party_id ?? null,
        url: `${ctx.siteUrl}/actor/${a.id}`,
        roles: a.roles.map((r) => ({ title: r.title, from: r.from ?? null, to: r.to ?? null })),
        promise_ids: cards.map((c) => c.id),
        by_status: by,
      };
    }),
  };
}

export const ACTOR_CSV_COLUMNS = ["id", "name", "short_name", "kind", "party_id", "url", "current_role", "promises", "delivered", "not_met", "undone", "in_progress"] as const;
export type ActorCsvRow = Record<(typeof ACTOR_CSV_COLUMNS)[number], Cell>;

export function actorRows(seed: Seed, ctx: Ctx): ActorCsvRow[] {
  return actorsData(seed, ctx).actors.map((a) => {
    const n = (s: Status) => a.by_status[s] ?? 0;
    return {
      id: a.id,
      name: a.name,
      short_name: a.short_name,
      kind: a.kind,
      party_id: a.party_id,
      url: a.url,
      current_role: a.roles.find((r) => !r.to)?.title,
      promises: a.promise_ids.length,
      delivered: n("delivered"),
      not_met: n("failed"),
      undone: n("quietly_dropped"),
      in_progress: n("promised") + n("in_plan") + n("legislated") + n("funded") + n("delivering"),
    };
  });
}

// ------------------------------------------------------------------ forecasts

export interface ScoreOut {
  outturn: number;
  outturn_source_id: string;
  outturn_vintage: string;
  outturn_quality: Quality;
  result: "hit" | "miss_above" | "miss_below";
  miss: number;
  miss_pct: number | null;
  error: number;
  error_pct: number | null;
}

export interface ForecastOut {
  id: string;
  maker: Forecast["maker"];
  series_id: string;
  label: string;
  period: string;
  unit: string;
  low: number;
  central: number;
  high: number;
  range: "range" | "point";
  quality: Quality;
  source_id: string;
  vintage: string;
  made_on: string;
  recorded_on: string;
  recorded_as: "shown" | "context";
  note: string | null;
  outturn_source: string;
  /** The month the outturn is usually first published ("2027-04"). */
  outturn_expected: string;
  score: ScoreOut | null;
}

export const lineLabels = (seed: Seed): Record<string, string> => Object.fromEntries(seed.statement.spending.map((l) => [l.id, l.label]));

const stripId = ({ forecast_id: _id, ...rest }: NonNullable<ScoredForecast["score"]>): ScoreOut => rest;

export function forecastOut(f: ScoredForecast, labels: Record<string, string>): ForecastOut {
  const info = seriesInfo(f.series_id, labels);
  return {
    id: f.id,
    maker: f.maker,
    series_id: f.series_id,
    label: info.label,
    period: f.period,
    unit: f.unit,
    low: f.predicted[0],
    central: f.predicted[1],
    high: f.predicted[2],
    range: f.range,
    quality: f.quality,
    source_id: f.source_id,
    vintage: f.vintage,
    made_on: f.made_on,
    recorded_on: f.recorded_on,
    recorded_as: f.recorded_as,
    note: f.note ?? null,
    outturn_source: info.outturn,
    outturn_expected: outturnExpected(f),
    score: f.score ? stripId(f.score) : null,
  };
}

export function forecastsData(seed: Seed, forecasts: ScoredForecast[], table: BacktestTable) {
  const labels = lineLabels(seed);
  const summary: Record<"shown" | "context", BacktestSummary> = {
    shown: backtestSummary(forecasts.filter((f) => f.recorded_as === "shown")),
    context: backtestSummary(forecasts.filter((f) => f.recorded_as === "context")),
  };
  return {
    summary,
    outturn_editions: table.outturn_editions,
    forecasts: forecasts.map((f) => forecastOut(f, labels)),
    sources: cited(seed, [...forecasts.map((f) => f.source_id), ...table.outturn_editions.map((e) => e.source_id)]),
  };
}

export const FORECAST_CSV_COLUMNS = [
  "id",
  "maker",
  "series_id",
  "label",
  "period",
  "unit",
  "low",
  "central",
  "high",
  "range",
  "quality",
  "source_id",
  "vintage",
  "made_on",
  "recorded_on",
  "recorded_as",
  "outturn_expected",
  "outturn",
  "outturn_source_id",
  "outturn_vintage",
  "result",
  "miss",
  "miss_pct",
  "error",
  "error_pct",
] as const;
export type ForecastCsvRow = Record<(typeof FORECAST_CSV_COLUMNS)[number], Cell>;

export function forecastRows(seed: Seed, forecasts: ScoredForecast[]): ForecastCsvRow[] {
  const labels = lineLabels(seed);
  return forecasts.map((x) => {
    const f = forecastOut(x, labels);
    return {
      id: f.id,
      maker: f.maker,
      series_id: f.series_id,
      label: f.label,
      period: f.period,
      unit: f.unit,
      low: f.low,
      central: f.central,
      high: f.high,
      range: f.range,
      quality: f.quality,
      source_id: f.source_id,
      vintage: f.vintage,
      made_on: f.made_on,
      recorded_on: f.recorded_on,
      recorded_as: f.recorded_as,
      outturn_expected: f.outturn_expected,
      outturn: f.score?.outturn,
      outturn_source_id: f.score?.outturn_source_id,
      outturn_vintage: f.score?.outturn_vintage,
      result: f.score?.result,
      miss: f.score?.miss,
      miss_pct: f.score?.miss_pct,
      error: f.score?.error,
      error_pct: f.score?.error_pct,
    };
  });
}

// ------------------------------------------------------------------ contracts

export interface ContractOut extends ContractFile {
  promise_ids: string[];
}

export function contractsData(seed: Seed) {
  return {
    contracts: seed.contracts.map((c): ContractOut => ({ ...c, promise_ids: seed.cards.filter((card) => card.contracts.some((k) => k.key === c.key)).map((card) => card.id) })),
    sources: cited(seed, seed.contracts.map((c) => c.source)),
  };
}

export const CONTRACT_CSV_COLUMNS = [
  "key",
  "ocid",
  "source",
  "promise_ids",
  "title",
  "buyer",
  "supplier",
  "companies_house_number",
  "awarded_on",
  "competition",
  "bids_received",
  "currency",
  "value_first",
  "value_latest",
  "end_date_first",
  "end_date_now",
  "finished",
  "months_late",
  "snapshots",
  "notice_url",
] as const;
export type ContractCsvRow = Record<(typeof CONTRACT_CSV_COLUMNS)[number], Cell>;

export function contractRows(seed: Seed): ContractCsvRow[] {
  return contractsData(seed).contracts.map((c) => {
    const ch = contractChange(c);
    return {
      key: c.key,
      ocid: c.ocid,
      source: c.source,
      promise_ids: c.promise_ids.join(" "),
      title: c.title,
      buyer: c.buyer,
      supplier: c.supplier.name,
      companies_house_number: c.supplier.companies_house_number,
      awarded_on: c.awarded_on,
      competition: c.competition,
      bids_received: c.bids_received ?? c.bids_received_by_lot?.join(" "),
      currency: ch.latest.value.currency,
      value_first: ch.first.value.amount,
      value_latest: ch.latest.value.amount,
      end_date_first: ch.endFirst,
      end_date_now: ch.endNow,
      finished: ch.finished,
      months_late: ch.monthsLate,
      snapshots: c.snapshots.length,
      notice_url: c.notice_url,
    };
  });
}
