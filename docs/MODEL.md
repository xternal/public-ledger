# Model layer

An ensemble of open models in tiers. Each tier is optional and labelled in the UI. The user always sees which tier produced a number.

## T0 — Arithmetic (v0, client-side TypeScript)

**Static costing.** For lever `L` moved by `d` units: `Δ_target = d × per_unit_bn` (a Range). Tax levers change receipts; spending levers change spending. Point measures (bus cap) add a fixed cost with optional funding offsets.

Source of `per_unit_bn`:
- Tax rates: HMRC *Direct effects of illustrative tax changes*. Use the year-one and steady-state figures. Correction (M1): HMRC's figures are not static. Most include taxpayers' own behavioural response; IHT, VED and Child Benefit do not; none include economy-wide effects. The M1 build uses the June 2025 edition (the January 2026 edition was postponed by HMRC on 6 Jul 2026). https://www.gov.uk/government/statistics/direct-effects-of-illustrative-tax-changes
- Bank Rate → debt interest: OBR EFO ready reckoner (sensitivity of debt interest to a 1pp rise in Bank Rate and gilt yields). Year one is smaller than year five because only short-dated debt, reserves (QE) and T-bills reprice immediately.
- % of GDP targets: `d × nominal GDP / 100`.

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

Contract: `POST /simulate {scenario}` → `ScenarioResult` with `distribution`. Cache by scenario hash. Timeout 20 s; the UI shows T0 instantly and fills T1 when ready.

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

## Ensemble display

When two tiers disagree (T0 static vs T1 microsim), show both side by side with a one-line explanation of why. Disagreement is information.

## Backtest (v2)

Every published ranged number for a future period is stored as a `Forecast`. When outturn arrives (ONS PSF, OBR EFO outturn), compute: hit (outturn within range), miss above, miss below. Publish a quarterly "forecasts vs outturn" page, including misses.

## Prototype engine reference

`prototype/template.html` → functions `compute()` and `debtPath()` contain a working T0 implementation (≈80 lines). Port to `packages/engine` with types and tests.
