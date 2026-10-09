# Model layer

An ensemble of open models in tiers. Each tier is optional and labelled in the UI. The user always sees which tier produced a number.

## T0 — Arithmetic (v0, client-side TypeScript)

**Static costing.** For lever `L` moved by `d` units: `Δ_target = d × per_unit_bn` (a Range). Tax levers change receipts; spending levers change spending. Point measures (bus cap) add a fixed cost with optional funding offsets.

Source of `per_unit_bn`:
- Tax rates: HMRC *Direct effects of illustrative tax changes*. Use the year-one and steady-state figures. Correction (M1): HMRC's figures are not static. Most include taxpayers' own behavioural response; IHT, VED and Child Benefit do not; none include economy-wide effects. The M1 build uses the June 2025 edition (the January 2026 edition was postponed by HMRC on 6 Jul 2026). https://www.gov.uk/government/statistics/direct-effects-of-illustrative-tax-changes
- Bank Rate → debt interest: OBR EFO ready reckoner (sensitivity of debt interest to a 1pp rise in Bank Rate and gilt yields). Year one is smaller than year five because only short-dated debt, reserves (QE) and T-bills reprice immediately.
- % of GDP targets: `d × nominal GDP / 100`.

**Stepped levers.** Where the source says its costings cannot be scaled, a lever carries `steps` instead of `per_unit_bn`: the source's own changes, each with its own Range for year one (`y1`) and the last year it costs (`y5`). Capital gains tax works this way: HMRC costs rises of 1, 5 and 10 points in each rate and says the figures "are also non-linear and so cannot be scaled up" (big rises raise less, or lose money, because people sell fewer assets). The engine uses HMRC's figure for the step a value stands on and nothing else: no interpolation, no scaling, nothing beyond the last step. A value between steps (from an old link) counts as the step below it; the sandbox shows these levers as a set of choices, not a slider.

"Static" here means no economy-wide (macro) effects; HMRC costings may include taxpayers' own responses. Restrict slider ranges to the band where the source says linearity holds (typically a few pp), and label results "static, before behaviour".

Ranges: v0 uses ±10–25% around central based on the source's own stated uncertainty, or a documented editorial default. Never a point.

**Borrowing.** `ΔPSNB = Δspending − Δreceipts`.

**Debt path** (to end of OBR forecast horizon). The baseline is OBR's own PSND % GDP path (sourced); the scenario adds our cumulative extra borrowing on top:
```
GDP_t        = GDP_{t-1} × (1 + g_nominal)            # v1: OBR nominal GDP path
extra_t      = extra_{t-1} × (1 + i_t) + ΔPSNB_t      # extra debt carries interest
debt%_t      = OBR_PSND%_t + extra_t / GDP_t × 100
```
v0 uses Bank Rate for `i_t`; v1 should use the effective interest rate on the gilt stock (DMO/OBR), which is lower and slower to move.

**Macro rules of thumb** (wide on purpose; values are from model memory and carry `quality: training` until an economist signs them off against OBR/BoE published elasticities):
- GDP year one: `(m_s × Δspending_non_interest − m_t × Δtax) / GDP`, with `m_s ∈ [0.4, 1.0]`, `m_t ∈ [0.2, 0.6]`.
- CPI one-off from VAT: `[0.4, 0.8]pp` per 1pp VAT (pass-through partial).
- Mortgage translation: annuity payment at `Bank Rate + spread` on a reference loan; show as monthly £.

**Per household / per taxpayer:** divide by ONS households (≈28.6m) or HMRC income-tax payers. Always say which.

## T1 — Microsimulation (v1, Python service)

`policyengine-uk` (open source, OpenFisca-derived; https://github.com/PolicyEngine/policyengine-uk). Use for tax-benefit levers to get:
- revenue cost with the model's own static estimate (compare with T0, show both: this is the ensemble);
- distribution by income decile, region, household type;
- "people like me" results for the Your share page.

Contract: `GET /api/t1?s=<scenario code>` → `T1Response` (`packages/schema/src/t1.ts`). Cache by scenario code and year. The UI shows T0 instantly and fills T1 when ready.

**Where it runs (decided in M5, 7 Oct 2026):** PolicyEngine's public API (`api.policyengine.org`), behind a `T1Provider` interface in `packages/server/src/model/`. Why not a self-hosted `services/model` yet:
- UK population microdata (the enhanced Family Resources Survey) sits in a private repository that needs PolicyEngine's approval; the public API runs on it for us.
- No container host to run and pay for; PolicyEngine maintains the model and data.
- PolicyEngine's packages are AGPL-3.0; calling the API keeps that code out of our deployment.

Costs: a dependency on a free public service (be a good citizen: compute only when a reader asks, cache, rate-limit), about a minute for a new scenario, and model or data versions that change over time (every result records them). If microdata access is granted, a self-hosted provider can replace the API without changing the contract.

**Ranges:** PolicyEngine gives single estimates; T1 shows them with the project's editorial ±10% (invariant 2) and says so.

**Example households ("people like me"):** six fixed households (`ARCHETYPES`), computed with `/uk/calculate` under current law and the reform (`packages/server/src/model/households.ts`). Their spending is ONS's average for the closest household type in *Family spending in the UK* (`data/seed/archetype_spending.json`, built by `python -m etl.archetype_spending`, which records the table, row and quality of every value), so VAT and fuel duty reach them. PolicyEngine charges VAT at the standard rate on half of spending and scales it up to national VAT receipts (÷0.38): a 1-point rise costs a household about 1.3% of its spending on the twelve COICOP groups. Its net income takes off all fuel duty paid but only a change in VAT. A change to these inputs or to the reform mapping bumps `T1_CACHE_VERSION` (`service.ts`), so cached results computed with the old inputs are worked out again.

## T2 — Macro (v2)

Options, in order of preference:
1. A small open semi-structural model (IS curve, Phillips curve, Taylor rule with Bank of England reaction) calibrated to published OBR/BoE elasticities. Purpose: show direction and ranges for GDP, CPI and Bank Rate over 1–3 years.
2. Reproduce OBR's published policy costings and scorecards where they exist (for announced measures) as an "official" tier next to ours.
3. Partnerships (NIESR NiGEM is commercial; consider academic access).

10-year horizon is shown as **scenarios** (low/central/high growth and rates), never as a forecast.

## T3 — Demography and long-term (v2)

Do not build projections. Use:
- ONS national population projections (principal + high/low fertility, migration, life expectancy variants).
- OBR *Fiscal risks and sustainability* long-term projections (age-related spending: state pension, health, social care) and their age-cost profiles.

Levers here are assumptions, not policies: fertility, net migration, life expectancy, state pension age. Output: old-age dependency ratio, age-related spending % GDP to 2075 as a fan.

Built in M6 as `/people` (`etl/people.py` → `data/build/people.json`). Each switch picks a published ONS variant; a mix the ONS does not publish is reported, never computed. Two numbers are worked out from published ones and marked `approx`: people of working age per person over pension age (ONS counts), and age-related spending in an OBR scenario (OBR baseline plus the scenario's published change). Neither body publishes a state pension age variant, so that lever shows its owner (government) and the assumptions used, with no switch.

## Ensemble display

When two tiers disagree (T0 static vs T1 microsim), show both side by side with a one-line explanation of why. Disagreement is information.

## Backtest (built in M7, 8 Oct 2026)

Every forward number the site shows that a later official outturn can score is stored as a `Forecast` record (`data/build/forecasts/<maker>/<edition>.json`, schema `packages/schema/src/forecasts.ts`), append-only: `pnpm validate --base` rejects a changed or removed record. `python -m etl.backtest` (also `pnpm backtest`) records new ones and scores every record whose period has an outturn in `data/build/backtest.json`. The nightly data job runs it after the build; CI re-runs it and fails if the committed files differ. Page: `/method/backtest`; data: `/api/v1/forecasts`.

**Scoring.** A hit when `low ≤ outturn ≤ high`, edges included. Otherwise a miss above or below, sized from the nearer edge of the range (in the forecast's unit and as a share of the central value); the error from the central value is kept too. Outturn: ONS public sector finances first, then the OBR's outturn (databank, later EFOs); HMT PESA outturn for spending by function; ONS mid-year estimates for births and deaths. Scores are worked out again on every run, so a revised outturn moves them; the table names the edition it used. The hit rate counts ranged forecasts only.

**What is recorded (decided 8 Oct 2026).**
- *OBR fiscal aggregates* the Statement and the debt path show for forecast years: receipts, total spending, borrowing, debt interest, debt (£bn and % of GDP). The OBR publishes single numbers in these tables, so they are recorded as points (`low = central = high`) and never given a range we made up; a point only "hits" by matching exactly, so the page shows how far off it was instead and leaves points out of the hit rate. The 13 receipt lines are left out: the OBR and the ONS draw some lines differently (business rates, non-tax income), so a gap would measure a definition, not a forecast.
- *Our split of spending by function* for forecast years (each function keeps its share of the latest PESA outturn year): our own forecasts, quality `approx`, points. Scored against PESA outturn, so the score tests our split and the OBR total together.
- *ONS births and deaths* on `/people`, with the range the page shades: lowest to highest published variant (special cases left out). Variants are other assumptions, not a probability range, and the page says so.
- *Context:* earlier official forecasts for periods the site already shows as outturn are recorded once, labelled `recorded_as: context` and as the OBR's or the ONS's: the March 2026 EFO for 2025-26, and the ONS principal projection for the year to mid-2025 (its first projected year, where every variant gives the same number to within a few dozen people, so it is recorded as a point). They give the page honest content from day one and are never counted as ours.

**What is left out, and why.** Promise-card costs and sandbox or share-page results are costings of what-ifs (what a measure would cost, what a change would do, on official costings, with no economy-wide effects). No official outturn measures a what-if, so there is no fair score: the debt path under a scenario is conditional on the scenario happening, alone. A costing could one day be scored against an official outturn cost of the measure itself (for example a department's spend on a delivered grant); that needs a source per measure and is not built. `/people`'s dependency ratio, workers per pensioner and long-term spending are not recorded yet: the ETL holds no outturn that measures them (ONS population by age would score the first two), and the 2075 spending paths are scenarios, not forecasts.

## Prototype engine reference

`prototype/template.html` → functions `compute()` and `debtPath()` contain a working T0 implementation (≈80 lines). Port to `packages/engine` with types and tests.
