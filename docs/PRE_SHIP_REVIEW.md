# Pre-ship review

Self-review of the prototype and spec pack, 6 Oct 2026. "Ship" here means two different things; the bar is different for each.

* **Ship the handover** (give the pack to a developer / Claude Code and a designer): OK now. Open items below are tracked in the build plan.
* **Ship publicly** (anyone can see the numbers and cards): not before every Blocker is closed.

Legend: ✅ fixed in this pass · 🔲 open. Owner: ENG, DATA, ED (editor), ECON (economist), LEGAL, DES (design).

## Blockers for public launch

| # | Issue | Why it matters | Fix | Owner | State |
|---|---|---|---|---|---|
| B1 | Three Sankey lines are balancing plugs: "Other taxes" £124bn and "Non-tax income" £122.5bn split a £246.5bn residual 50/50; "Other & accounting" £130bn is the gap between 2025-26 TME and functions scaled from 2024-25 TES | ~18% of income and ~10% of spending are not real breakdowns. "What are you hiding in 'other'?" is the first attack | ETL M1 from OBR receipts tables and PESA; decompose accounting adjustments (public corporations, locally financed, national-accounts adjustments). Plugs now carry a visible `plug` badge | DATA | ✅ M1: receipts by tax from OBR EFO TA.5 sum to the total; spending by function from HMT PESA 2026; the accounting line is broken down into published parts |
| B2 | Lever coefficients (1p income tax ≈ £7.4bn, 1pp VAT ≈ £8.7bn, NICs, CT, Bank Rate → debt interest) are from model memory | Every sandbox result depends on them | Replace with HMRC "Direct effects of illustrative tax changes" and OBR ready reckoner; golden tests | DATA, ECON | ✅ M1: HMRC June 2025 edition and OBR debt-interest reckoner, golden tests · 🔲 HMRC's next edition is postponed (acknowledged until 31 Jan 2027) |
| B3 | Macro rules of thumb (multipliers, VAT pass-through) unsigned | GDP/CPI tiles look authoritative | Economist sign-off against published OBR/BoE elasticities; tiles now carry a "rule of thumb" badge | ECON | ✅ badge · 🔲 sign-off |
| B4 | Only the bus-cap card is sourced. Defence 2.5% and 1.5m homes have no sources; the defence cost range I had entered was an estimate; the credit-history table uses fictional "Party A/B/C" | Publishing an unsourced status about a named politician is a defamation and credibility risk | Defence cost removed ("cost pending editor"). Editors source every card; credit table only renders from real cards | ED | ✅ partly · 🔲 |
| B5 | UK election law. Non-party campaigning that can reasonably be regarded as intended to influence voters is regulated; registration is needed above £20,000 (England) or £10,000 (Scotland, Wales, NI) in a regulated period. Foreign-linked bodies face tight limits (Elections Act 2022 cap for ineligible foreign campaigners, from model memory) | A promise tracker with status labels on parties may count; funding from a Russian party would be a problem | Legal advice before launch and before each regulated period; UK entity, UK funding, neutral brand; publish funding sources | LEGAL | 🔲 |
| B6 | Defamation exposure from statuses like `failed` and `quietly_dropped` on named people | UK defamation law is claimant-friendly | Evidence requirement per status (`PROMISE_STANDARD.md` §3), right of reply, legal review of status wording and templates, archive every source | LEGAL, ED | 🔲 |
| B7 | Follow lists and submission histories reveal political opinions (UK GDPR Art. 9 special category) | Regulatory and trust risk; in Russia mode a physical safety risk | Explicit consent, minimal storage, aggregates only, DPIA, Russia mode without accounts (`PRIVACY_AND_ACCOUNTS.md`) | LEGAL, ENG | ✅ spec · 🔲 DPIA |
| B8 | Licences and terms | Attribution is a condition of reuse | OGL v3 attribution for gov data; Open Parliament Licence for Hansard; TheyWorkForYou API terms and key; fair-dealing limits on storing broadcast transcripts (store short quotes plus timestamps, not full transcripts) | LEGAL, ENG | 🔲 |

## High

| # | Issue | Fix | Owner | State |
|---|---|---|---|---|
| H1 | Debt chart used a borrowing path I had interpolated (112/96/82/69) and an invented flat £34bn/yr "other financial transactions" | Replaced with OBR March 2026 PSNB path (132.7 → 59.0) and OBR PSND % GDP path (94.3 → 95.1) via House of Commons Library CBP-10495; scenario adds extra debt on top | ENG | ✅ |
| H2 | Bus-cap card was marked `funded`, but our own standard requires a Budget/SR/Estimates allocation; an announcement naming a source is `in_plan` | Status changed to `in_plan` with a note. Good test that the standard bites | ED | ✅ |
| H3 | Mortgage translation assumes a tracker at Bank Rate + 1pp; most UK borrowers are on fixed rates | Copy now says fixed-rate borrowers feel it at remortgage; v1 use BoE quoted rates by product | ENG | ✅ copy · 🔲 data |
| H4 | Extra debt is charged at Bank Rate | Use effective interest rate on gilt stock (DMO/OBR) in v1 | ENG, ECON | 🔲 |
| H5 | Static costings are linear across wide slider ranges (e.g. VAT 15–25%) | Restrict ranges to where the source holds; label "static, before behaviour" | ENG, ECON | 🔲 |
| H6 | Sankey on phones scrolled sideways | Replaced below 720px by ranked bar lists; designer to refine tap-to-expand | DES | ✅ |
| H7 | No table alternative for charts (a11y) | Prototype now has "Show as table" for the Sankey; fan chart still needs one | ENG | ✅ Sankey and fan chart tables (M0) |
| H8 | Your share ignores Scottish rates, self-employed NI, pension contributions and all indirect taxes (VAT is a large share of tax paid by lower earners) | Labelled; v1 add VAT/indirect estimate from ONS "Effects of taxes and benefits on household income" and a Scotland toggle | ENG | 🔲 |
| H9 | "Borrowed on top, in your name" may read as loaded | Test with users; alternative: "Plus borrowing on top: £X" | DES, ED | ✅ wording changed to "Plus borrowing on top" (M0) · 🔲 user test |
| H10 | LLM intake reads untrusted transcripts (prompt injection, invented quotes) | Exact-match rule on quotes (already specified), treat transcript text as data, no tool use in the extraction call, human merge only | ENG | ✅ spec |
| H11 | Earlier conflicting fetch suggested 2026-27 PSNB £133bn; OBR guide and Commons Library put £132.7bn in 2025-26 and £115.5bn in 2026-27 | Resolved in favour of the Commons Library table; ETL should read OBR tables directly | DATA | ✅ |

## Medium / low

| # | Issue | State |
|---|---|---|
| M1 | Prototype hard-coded "today" as 2026-10-06 | ✅ now uses the current date |
| M2 | Sankey change labels stayed in £bn when units were per household / pence | ✅ unit-consistent |
| M3 | Promise list used `role="listbox"/"option"` without arrow-key handling | ✅ now buttons with `aria-pressed` |
| M4 | Presets showed no active state | ✅ |
| M5 | Dead code (`unitLabel`, `otherIdx`) | ✅ removed |
| M6 | Google Fonts sends visitor IPs to Google | ✅ Geist bundled with the app (M0) |
| M7 | Households (28.6m), taxpayers (38.0m), population (69.3m) from model memory | ✅ M1: ONS households 29.0m (2025), ONS population 69.5m (mid-2025), HMRC taxpayers by year |
| M8 | Full d3 bundle (~280 KB) in prototype | ✅ modular d3 imports (M0) |
| M9 | Build-time estimate (6–8 weeks) is low-confidence | 🔲 re-estimate after M0 |
| M10 | KPI "Debt £2.9tn" doesn't move with scenarios (year-one view) | ✅ labelled with its year (M0) · 🔲 scenario debt at horizon |
| M11 | README and RUSSIA docs were in Russian | ✅ all handover docs now in English |

## Found in M1 (data pipeline)

| # | Issue | State |
|---|---|---|
| D1 | The seed overstated nominal GDP (3,075 vs OBR 3,054.7) and understated debt (2,900 vs 2,922.3) | ✅ build reads OBR directly |
| D2 | HMRC costings were described as "static, before behaviour". Most include taxpayers' own response; none include economy-wide effects | ✅ copy and MODEL.md corrected |
| D3 | Bank Rate hold was dated 18 Sep 2026; the MPC announced it on 17 Sep | ✅ corrected |
| D4 | PESA counts £19.4bn of notional pension interest as debt interest; OBR does not. The Statement uses OBR's measure and shows the difference inside the accounting line | ✅ explained in the line's note |
| D5 | 2025-26 is still an OBR estimate in the Statement, while ONS outturn (borrowing £134.3bn vs £132.7bn) and PESA outturn exist | 🔲 decide once ONS tax-by-tax outturn is ingested |
| D6 | State pension figures from DWP are Great Britain only | 🔲 accepted for v0; add NI if needed |
| D7 | Defence lever started from COFOG defence (2.13% of GDP), so NATO-style targets overstated the cost | ✅ M2: starts from NATO's measure (2.32%, NATO estimate for 2025-26) |
| D8 | Fuel duty's temporary 5p cut ends 31 Dec 2026 (55.95p from 1 Jan 2027, 57.95p from 1 Mar 2027) | ✅ shown in the lever note; 🔲 update after Budget 2026 confirms rates |
| D9 | Brand colours as text failed AA in light mode (borrowing orange 3.3:1, amber pills 4.5:1) | ✅ text shade `--debt-ink`, amber darkened; Lighthouse accessibility 100 in both themes |

## Not a bug, but decide

* **Neutral brand name** for the UK pilot (B5) before any domain or social handle is registered.
* **Methodology board**: name two or three independent economists before launch; without them "independent" is a claim, not a fact.
* **Liar score**: keep it out of v0 (README §4.6). Revisit after the backtest has a year of data.
