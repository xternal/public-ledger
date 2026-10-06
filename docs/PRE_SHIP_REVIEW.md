# Pre-ship review

Self-review of the prototype and spec pack, 6 Oct 2026. "Ship" here means two different things; the bar is different for each.

* **Ship the handover** (give the pack to a developer / Claude Code and a designer): OK now. Open items below are tracked in the build plan.
* **Ship publicly** (anyone can see the numbers and cards): not before every Blocker is closed.

Legend: ✅ fixed in this pass · 🔲 open. Owner: ENG, DATA, ED (editor), ECON (economist), LEGAL, DES (design).

## Blockers for public launch

| # | Issue | Why it matters | Fix | Owner | State |
|---|---|---|---|---|---|
| B1 | Three Sankey lines are balancing plugs: "Other taxes" £124bn and "Non-tax income" £122.5bn split a £246.5bn residual 50/50; "Other & accounting" £130bn is the gap between 2025-26 TME and functions scaled from 2024-25 TES | ~18% of income and ~10% of spending are not real breakdowns. "What are you hiding in 'other'?" is the first attack | ETL M1 from OBR receipts tables and PESA; decompose accounting adjustments (public corporations, locally financed, national-accounts adjustments). Plugs now carry a visible `plug` badge | DATA | 🔲 |
| B2 | Lever coefficients (1p income tax ≈ £7.4bn, 1pp VAT ≈ £8.7bn, NICs, CT, Bank Rate → debt interest) are from model memory | Every sandbox result depends on them | Replace with HMRC "Direct effects of illustrative tax changes" and OBR ready reckoner; golden tests | DATA, ECON | 🔲 |
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
| H7 | No table alternative for charts (a11y) | Prototype now has "Show as table" for the Sankey; fan chart still needs one | ENG | ✅ Sankey · 🔲 fan |
| H8 | Your share ignores Scottish rates, self-employed NI, pension contributions and all indirect taxes (VAT is a large share of tax paid by lower earners) | Labelled; v1 add VAT/indirect estimate from ONS "Effects of taxes and benefits on household income" and a Scotland toggle | ENG | 🔲 |
| H9 | "Borrowed on top, in your name" may read as loaded | Test with users; alternative: "Plus borrowing on top: £X" | DES, ED | 🔲 |
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
| M6 | Google Fonts sends visitor IPs to Google | 🔲 self-host in the app |
| M7 | Households (28.6m), taxpayers (38.0m), population (69.3m) from model memory | 🔲 ETL from ONS/HMRC; flagged in seed `quality_notes` |
| M8 | Full d3 bundle (~280 KB) in prototype | 🔲 modular imports in the app |
| M9 | Build-time estimate (6–8 weeks) is low-confidence | 🔲 re-estimate after M0 |
| M10 | KPI "Debt £2.9tn" doesn't move with scenarios (year-one view) | 🔲 add scenario debt at horizon to KPI strip or label it "today" |
| M11 | README and RUSSIA docs were in Russian | ✅ all handover docs now in English |

## Not a bug, but decide

* **Neutral brand name** for the UK pilot (B5) before any domain or social handle is registered.
* **Methodology board**: name two or three independent economists before launch; without them "independent" is a claim, not a fact.
* **Liar score**: keep it out of v0 (README §4.6). Revisit after the backtest has a year of data.
