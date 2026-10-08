# Build plan for Claude Code

Run milestones in order. Each has a ready prompt. Start every session with: *"Read CLAUDE.md, README.md and the docs referenced in the milestone before writing code."*

---

## M0 — Scaffold and port the prototype (2–3 days)

**Prompt**
> Set up the monorepo described in CLAUDE.md (pnpm workspaces: apps/web, packages/engine, packages/schema). Next.js App Router + TS strict + Tailwind. Port `prototype/template.html` into React components: KpiStrip, Sankey (d3-sankey), SandboxDock, LeverSlider, MeasureToggle, ResultPanel, FanChart, YourShare, PromiseList, PromiseDetail, CreditTable, QualityBadge. Move CSS tokens to `apps/web/styles/tokens.css` keeping light/dark behaviour. Read data from `data/seed/*.json` through Zod schemas in packages/schema. Port `compute()` and `debtPath()` into `packages/engine` with types. Add Vitest; write tests: (1) statement balances for base and for 20 random scenarios, (2) each lever at +1 unit reproduces its central `per_unit_bn`, (3) bus cap with climate_loans funding nets to +0.1bn. Add `pnpm dev`, `pnpm test`, `pnpm validate`.

**Done when:** the app matches the prototype on desktop, tests pass, no number is a literal in a component.

## M1 — Real data ETL (4–5 days)

**Prompt**
> Build `etl/` per docs/DATA_SOURCES.md "ETL contract". Implement sources: OBR EFO supplementary tables (latest vintage; receipts by tax, spending components, PSNB, PSND, GDP, debt interest, ready reckoner), HMT public spending statistics (COFOG functions and sub-functions), ONS public sector finances (monthly outturn), BoE Bank Rate, HMRC 'Direct effects of illustrative tax changes'. Normalise to Observation (docs/DATA_MODEL.md). Build StatementSnapshot for every fiscal year 2019-20 → last forecast year. Replace `quality: training` lever coefficients with HMRC/OBR values and record sources. Write manifest.json. Add a GitHub Action that runs nightly and opens a PR when data changes. Fail CI on balance check errors or staleness.

**Done when:** the Statement has a year selector backed by real data; every badge is `sourced` or `approx` with a method note; no `training` values remain in levers that HMRC/OBR cover.

## M2 — Sandbox complete (4 days)

**Prompt**
> Extend packages/engine and the UI: add personal allowance, higher and additional rates, fuel duty levers; lever groups; URL-encoded scenarios (`?s=` compact base64url of non-default settings) with round-trip tests; `/s/[hash]` share page with OG image via `next/og` showing headline results with ranges; table view for the Sankey and fan chart. Debounce recompute to animation frames. Keyboard and screen-reader pass on sliders.

**Done when:** a scenario link opens the same scenario; OG images render; Lighthouse a11y ≥ 95.

## M3 — Promise ledger v0 (5 days)

**Prompt**
> Implement content/promises/*.yaml and content/actors/*.yaml with Zod schemas from docs/DATA_MODEL.md and rules from docs/PROMISE_STANDARD.md. Migrate data/seed/promises.json. Pages: /promises (filters: actor, party, status, area, overdue; sort), /promise/[id] (ladder, translation strip using the engine, timeline, versions diff, sources, 'Run in sandbox'), /actor/[id] (status distribution, totals). OG image per promise. CI validator: required sources and parameters, append-only versions/events (diff against main), lever references exist. Nightly job: append `deadline_missed` events for overdue promises and open a PR.

**Done when:** 20 real UK cards are in, each with verified sources; the bus cap card is complete.

## M3b — Follow and Contribute, no accounts (5 days)

**Prompt**
> Read docs/PRIVACY_AND_ACCOUNTS.md and PRD F7–F8. Build services/alerts: on every merge to main, diff content/promises and data/build against the previous commit, emit change events (status, timeline event, version, cost range, reply), and fan out to (1) RSS/Atom feeds per promise, actor, area; (2) email via a transactional provider with open/click tracking disabled, double opt-in, one-click unsubscribe and delete; (3) a Telegram bot with /follow and /unfollow. Store subscriptions in Postgres with addresses encrypted at rest, explicit consent text version recorded. Build services/intake: POST /submissions with Turnstile, rate limiting by salted daily hash (no IP stored), URL check, Internet Archive snapshot, transcript fetch where available and exact-match of the claimed quote, LLM pre-fill (Claude API) of parameters, dedupe by normalised URL + time. Admin triage view for editors (behind SSO) that turns an accepted submission into a draft PR. UI: 'Follow' on cards and actor pages, 'Send us a promise' and 'Add evidence' forms as in the prototype, aggregate follower count hidden below 50. Self-host fonts; no third-party scripts on pages with forms.

**Done when:** a merged status change reaches RSS, email and Telegram within 15 minutes; a submission with a YouTube link and timestamp arrives in triage with an archived URL and a matched quote; delete-my-data works end to end.

## M4 — Promise intake with LLM (4 days)

**Prompt**
> Build `intake/`: fetch new Hansard items (Commons statements, PMQs) and GOV.UK press releases daily; optional manual upload of a transcript or YouTube captions. Use the Claude API to extract candidate promises as JSON {quote, speaker, date, venue, who, how_much, when, funded_by, confidence, source_span}. Only verbatim quotes with character offsets into the source text are allowed; drop anything without an exact match. Create a draft YAML per candidate and open a PR labelled `intake`, grouped by day. Never auto-merge.

**Done when:** a day's Hansard produces a reviewable PR with zero hallucinated quotes (exact-match check passes).

## M5 — Microsimulation (5 days)

**Prompt**
> Create services/model (FastAPI) wrapping policyengine-uk. Endpoint POST /simulate takes our Scenario, maps tax/benefit levers to PolicyEngine reform parameters, returns ScenarioResult with revenue (compare to T0) and distribution by decile, region, household type. Cache by scenario hash. In the app, show T0 instantly and fill a 'Who gains and loses' panel when T1 returns; show T0 vs T1 side by side with an explanation when they differ by >15%. Extend /me with household type and region to show 'people like me'.

## M5b — Optional accounts (4 days)

**Prompt**
> Add optional accounts with passkeys (WebAuthn) and email magic-link fallback; no passwords, no social login. Link existing email subscriptions on sign-in. Account page: follows, submission history with statuses, optional public handle, delete account. Contributor trust levels from accepted submissions; trusted submissions sort first in triage. 'Cost this next' voting for verified members (integration point with the member registry), affecting queue order only. No public profiles, no comments.

## M6 — Demography and long term (4 days)

**Prompt**
> Add ONS population projections (principal + variants) and OBR Fiscal risks and sustainability long-term projections. New page /people: old-age dependency ratio, workers per pensioner, births/deaths trend, age-related spending % GDP to 2075 as fans across variants. Assumption levers (fertility, net migration, life expectancy, state pension age) switch between published variants; we do not compute our own projections.

## M6b — Contracts behind delivery (2–3 days)

**Prompt**
> Add `ContractLink` to docs/DATA_MODEL.md and packages/schema: {id, promise_id, source: 'find_a_tender' | 'contracts_finder', ocid, notice_url, archived_url, supplier: {name, companies_house_number?}, awarded_on, bids_received?, snapshots: [{fetched_at, value: Money, end_date_planned, end_date_actual?}]}. Snapshots are append-only like PromiseEvent: a change in value or dates is a new snapshot, never an edit. Editors link contracts to a promise by hand (`contracts: [ocid]` in its YAML); no automatic matching of contracts to promises. Build `etl/contracts`: for every linked contract, fetch its OCDS release package from Find a Tender (the Central Digital Platform, where every notice under the Procurement Act 2023 has gone since 24 Feb 2025; ocids look like `ocds-h6vhtk-…`) or, for procurements started before that date, from Contracts Finder; refresh nightly, and open a PR when the value or dates change. On a promise card at `funded`, `delivering` or `delivered`, show a Contracts strip: supplier (linked to Companies House, which lists beneficial owners; we link to them, we don't store them), bids received, first vs latest value (Δ in £ and %), planned vs actual end (months late), link to the notice. On the actor page, show total Δ value and median delay across the actor's linked contracts.

**Done when:** three real cards at `delivering` or later show linked contracts fetched from OCDS; a changed value in the source produces a PR with a new snapshot; CI rejects an edited (not appended) snapshot.

## M7 — Backtest, API, method (4 days)

**Prompt**
> Store every ranged forward number shown on promise cards and share pages as a Forecast record. A quarterly job compares with outturn (ONS PSF, OBR outturn) and writes a backtest table. Page /method/backtest: hit rate, misses above/below, list of misses. Public read-only API (JSON + CSV) for statement, promises, actors, forecasts. Method page with changelog of data vintages.
