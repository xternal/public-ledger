# Data model

Zod schemas live in `packages/schema`. TypeScript shown; ETL mirrors with Pydantic.

## Provenance core

```ts
type Quality = "sourced" | "approx" | "modelled" | "training";

interface Source {
  id: string;                 // "obr_efo_2026_03"
  title: string;
  publisher: "OBR" | "HMT" | "HMRC" | "ONS" | "BoE" | "DMO" | "Parliament" | "Media" | string;
  url: string;
  published_on: string;       // ISO date
  licence?: string;           // OGL v3 for most UK gov data
}

interface Observation {
  series_id: string;          // "receipts.vat", "spending.cofog.health", "macro.bank_rate"
  period: string;             // "2025-26" (fiscal), "2026-09" (monthly), "2026-09-18" (event)
  geography: "UK" | "England" | "Scotland" | "Wales" | "NI" | string;
  value: number;
  unit: "gbp_bn" | "pct" | "pct_gdp" | "persons_m" | "rate_pct" | string;
  kind: "outturn" | "forecast" | "projection";
  source_id: string;
  vintage: string;            // forecast/edition id, e.g. "EFO-2026-03"
  quality: Quality;
  method_note?: string;       // required when quality != "sourced"
}
```

## Statement

```ts
interface BudgetNode {
  id: string;                 // "social_protection", "social_protection.state_pension"
  parent_id?: string;
  side: "receipt" | "spending" | "financing";
  label: string;
  desc?: string;
  classification: "COFOG" | "HMT_receipts" | "custom";
  series_id: string;          // → Observation.series_id
}

interface StatementSnapshot {  // what the Sankey renders
  period: string;
  vintage: string;
  receipts: { node_id: string; bn: number; quality: Quality }[];
  borrowing_bn: number;       // derived: spending − receipts
  spending: { node_id: string; bn: number; quality: Quality }[];
  macro: { nominal_gdp_bn: number; psnd_bn: number; households_m: number; bank_rate_pct: number };
}
```

## Sandbox

```ts
type Range = [low: number, central: number, high: number];

interface Lever {
  id: string;                 // "vat_standard"
  label: string;
  controlled_by: "government" | "central_bank" | "demography" | "external";
  unit: "pp" | "pct" | "pct_gdp" | "toggle" | "gbp";
  base: number; min: number; max: number; step: number;
  effect: {
    target_node: string;      // BudgetNode id
    per_unit_bn: { y1: Range; y5?: Range };
    cpi_pp_per_unit?: Range;
  };
  funding_options?: { id: string; label: string; offset_bn: number; target_node: string; quality: Quality }[];
  quality: Quality;
  source_id?: string;
}

interface Scenario {
  id: string;                 // content hash of settings
  base_vintage: string;
  settings: Record<string /*lever_id*/, number | boolean | string>;
  created_from?: { promise_id?: string; preset_id?: string };
}

interface ScenarioResult {
  scenario_id: string;
  engine: "T0" | "T1" | "T2";
  engine_version: string;
  horizon: { period: string; d_borrowing_bn: Range; debt_pct_gdp: Range }[];
  y1: { d_borrowing_bn: Range; per_household_gbp: Range; cpi_pp: Range; gdp_pct: Range };
  distribution?: { decile: number; d_income_pct: Range }[];   // T1
  computed_at: string;
}
```

## Promises

```ts
type Status = "promised" | "in_plan" | "legislated" | "funded" | "delivering"
            | "delivered" | "failed" | "quietly_dropped" | "unscoreable";

interface Actor { id: string; name: string; short_name?: string /* "Labour" for tight spaces */; kind: "person" | "party" | "government"; standing?: "government" | "opposition" | "public_body" /* at Westminster, now; a label, never a different rule */; party_id?: string; roles: { title: string; from: string; to?: string }[];
  parliament_member_id?: number /* person: UK Parliament Members API id, links /mp pages */; parliament_party_id?: number /* party: Members API party id */ }

interface Promise {
  id: string;                 // "uk-bus-cap-2-2026"
  actor_id: string;
  made_on: string;
  venue: "manifesto" | "speech" | "debate" | "tv" | "interview" | "press_release" | "parliament" | "social";
  policy_area: string;        // COFOG-aligned
  current_version: number;
  status: Status;
  deadline?: string;
  lever_settings?: Record<string, number | boolean | string>;   // → Scenario
  sources: { title: string; url: string; archived_url?: string }[];
}

interface PromiseVersion {    // append-only
  promise_id: string;
  version: number;
  text: string;               // verbatim quote
  parameters: {
    who?: string;
    how_much_bn_per_year?: Range | null;
    when?: string;
    funded_by?: string | null;  // null = not stated at announcement
  } | null;                   // null ⇒ unscoreable
  recorded_on: string;
  source_url: string;
}

interface PromiseEvent {      // append-only timeline
  promise_id: string;
  date: string;
  type: "promised" | "reworded" | "in_plan" | "legislated" | "funded" | "delivering"
      | "delivered" | "failed" | "deadline" | "deadline_missed" | "reply";
  text: string;
  evidence_url?: string;      // bill page, budget line, statistics release
  auto?: boolean;             // created by a job, e.g. deadline_missed
}

interface Reply { promise_id: string; from_actor_id: string; date: string; text: string; editor_response?: string }

// Contracts behind delivery (M6b). Editors link a promise to contracts by hand, in its YAML:
// `contracts: [ocid | { ocid, award_id?, notice_url? }]`; nothing is matched automatically.
// etl/contracts.py fetches each linked contract's OCDS record nightly into data/build/contracts/<key>.json.
// Schema: packages/schema/src/contracts.ts.
type Money = { amount: number; currency: string };   // as the notice states it, net of VAT when both are given
interface ContractLink {
  id: string;                 // "<promise_id>:<key>"; key = ocid, or "<ocid>--award-<award_id>" for one lot
  promise_id: string;
  source: "find_a_tender" | "contracts_finder";
  ocid: string;               // "ocds-h6vhtk-…" (Find a Tender), "ocds-b5fd17-…" (Contracts Finder)
  title: string; buyer: string;
  notice_url: string; archived_url?: string; record_url: string;
  supplier: { name: string; companies_house_number?: string };   // linked to Companies House; owners are not stored
  awarded_on: string;
  bids_received?: number;
  bids_received_by_lot?: number[];   // when one award covers several lots
  competition?: "open" | "selective" | "limited" | "direct";   // OCDS procurementMethod; direct = no competition
  snapshots: {                // append-only, like PromiseEvent: a change in value or dates is a new snapshot
    fetched_at: string;       // the day the nightly fetch first saw this state
    value: Money;
    end_date_planned: string;
    end_date_actual?: string; // once the notice says the contract ended
  }[];
}

// Forecasts against outturn (M7). Records are append-only, one file per maker and edition:
// data/build/forecasts/<maker>/<edition>.json = { maker, source_id, vintage, made_on, inputs?, about, forecasts: [...] }.
// Schema: packages/schema/src/forecasts.ts. Written by etl/backtest.py; docs/MODEL.md "Backtest" says what is recorded.
interface Forecast {
  id: string;                 // "<maker>:<edition>:<series_id>:<period>"
  maker: "obr" | "ons" | "public_ledger";   // whose forecast it is; official ones are never ours
  source_id: string; vintage: string;       // where it comes from ("obr_efo", "EFO-2026-03"); ours name their inputs
  series_id: string;          // "fiscal.psnb", "people.births", "statement.spending.health"
  period: string;             // "2026-27", or "2026" for ONS years to 30 June
  unit: string;
  predicted: Range;           // a single published number is [x, x, x] with range: "point"
  range: "range" | "point";
  quality: Quality;
  made_on: string;            // when the maker published it (ours: when first recorded)
  recorded_on: string;        // when this site recorded it
  recorded_as: "shown" | "context";   // context: an earlier official forecast, recorded after its period ended
  note?: string;
  engine_version?: string; scenario_id?: string;   // for our own model forecasts (none yet)
}

// data/build/backtest.json, worked out again on every run (not append-only):
interface BacktestResult {
  forecast_id: string;
  outturn: number; outturn_source_id: string; outturn_vintage: string; outturn_quality: Quality;
  result: "hit" | "miss_above" | "miss_below";   // hit: low <= outturn <= high
  miss: number; miss_pct: number | null;         // distance outside the range, from its nearer edge
  error: number; error_pct: number | null;       // outturn minus central
}
```

## Follow, contribute, accounts

```ts
interface Subscription {      // v0, no account
  id: string;
  channel: "email" | "telegram" | "webpush";
  address_encrypted: string;  // email / chat id / push endpoint, encrypted at rest
  targets: { kind: "promise" | "actor" | "area" | "deadline_window"; id: string }[];
  cadence: "instant" | "weekly";
  consent: { text_version: string; given_at: string };   // explicit consent (Art. 9)
  confirmed_at?: string;      // double opt-in
  account_id?: string;        // v1
}

interface Submission {
  id: string;                 // public reference, e.g. "S-2026-10-0412"
  kind: "new_promise" | "evidence";
  promise_id?: string;        // for evidence
  evidence_type?: "reworded" | "in_plan" | "legislated" | "funded" | "delivering" | "delivered" | "failed" | "other";
  url: string;
  archived_url?: string;
  video_time?: string;
  claimed_actor?: string;
  claimed_quote?: string;
  matched_quote?: { text: string; source_span: [number, number] } | null;   // exact match in transcript
  llm_prefill?: Partial<PromiseVersion["parameters"]>;
  contact_email_encrypted?: string;
  credit_handle?: string;     // only if opted in
  status: "received" | "auto_checked" | "in_review" | "accepted" | "merged_into" | "rejected" | "duplicate";
  resulting_promise_id?: string;
  received_at: string;
  // no IP stored; rate limiting uses a salted hash that rotates daily
}

interface Account {           // v1
  id: string;
  email_encrypted: string;
  passkeys: string[];
  handle?: string;
  trust_level: 0 | 1 | 2 | 3; // by accepted submissions; affects review order only
  created_at: string;
}
```

## Content files (v0)

`content/promises/uk-bus-cap-2-2026.yaml` mirrors `Promise` + inline `versions[]` + `events[]`. The validator:
- requires ≥1 source URL;
- requires `parameters` unless `status: unscoreable`;
- forbids editing an existing `versions[i]` or `events[i]` (CI compares with `main`);
- requires `lever_settings` to reference existing levers.
