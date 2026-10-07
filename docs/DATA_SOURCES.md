# Data sources (UK)

Most UK government data is under the Open Government Licence v3. URLs verified on 6 Oct 2026 are marked ✓; others are from memory and must be checked when writing the ETL module.

## Fiscal totals and forecasts

| Source | What we take | Cadence | URL |
|---|---|---|---|
| OBR Economic and fiscal outlook (EFO) | Receipts by tax, spending components (RDEL, CDEL, AME, welfare, debt interest), PSNB, PSND, GDP, forecast to t+5. Supplementary tables (xlsx) incl. ready reckoners | Spring + autumn | ✓ https://obr.uk/efo/economic-and-fiscal-outlook-march-2026/ |
| OBR Public finances databank | Long historical series (% GDP and £bn) | After each EFO | https://obr.uk/data/ |
| OBR brief guide | Headline numbers for the current year (used for seed) | Each EFO | ✓ https://obr.uk/forecasts-in-depth/brief-guides-and-explainers/public-finances/ |
| OBR Fiscal risks and sustainability | 50-year projections, age-cost profiles | Annual (July) | https://obr.uk/frs/ |
| ONS Public sector finances | Monthly outturn: receipts, spending, borrowing, debt, debt interest | Monthly | ✓ https://www.ons.gov.uk/economy/governmentpublicsectorandtaxes/publicsectorfinance |
| HMT Public spending statistics / PESA | Spending by COFOG function and sub-function, by department, by country/region (CRA) | PESA July; stats Feb/May/Nov | ✓ https://www.gov.uk/government/statistics/public-spending-statistics-release-may-2026/public-spending-statistics-may-2026 · https://www.gov.uk/government/collections/public-expenditure-statistical-analyses-pesa |
| HMRC tax receipts | Monthly receipts by tax | Monthly | https://www.gov.uk/government/statistics/hmrc-tax-and-nics-receipts-for-the-uk |
| HMRC Direct effects of illustrative tax changes | Lever coefficients (1p on income tax rates, VAT, NICs, CT, allowances) | Annual | https://www.gov.uk/government/statistics/direct-effects-of-illustrative-tax-changes |
| HMT Budget / Spending Review documents | Policy costings tables (scorecard) for announced measures | Each fiscal event | https://www.gov.uk/government/topical-events (per event) |

## Money and rates

| Source | What | URL |
|---|---|---|
| Bank of England database (IADB) | Bank Rate (series IUDBEDR), gilt yields | https://www.bankofengland.co.uk/boeapps/database/ |
| BoE MPC decisions | Decision dates, votes, minutes | ✓ https://www.bankofengland.co.uk/monetary-policy/the-interest-rate-bank-rate |
| UK Debt Management Office | Gilt portfolio, maturity, index-linked share | https://www.dmo.gov.uk/data/ |

Current state at time of writing: Bank Rate 3.75%, held 17 Sep 2026 (BoE IADB series IUDBEDR; corrected from 18 Sep in M1), next decision 5 Nov 2026 (source: BoE page above and press coverage).

## People

| Source | What | URL |
|---|---|---|
| ONS population estimates and national projections | Population by age, variants (fertility, migration, mortality) | https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/populationprojections |
| ONS births, deaths | TFR, births, deaths | https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages |
| ONS families and households | Number of households (per-household translation) | https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages/families |
| ONS labour market | Employment, earnings (for "what it means for me") | https://www.ons.gov.uk/employmentandlabourmarket |
| ONS Family spending in the UK | Weekly spending by household type and income (COICOP groups, motor fuel) for the T1 example households (`data/seed/archetype_spending.json`, `python -m etl.archetype_spending`, each June) | ✓ https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/expenditure/bulletins/familyspendingintheuk/april2024tomarch2025 |
| ONS API | Programmatic access to many of the above | https://developer.ons.gov.uk/ |

## Promises and their execution

| Source | Use | URL |
|---|---|---|
| Hansard API | Ministerial statements, PMQs, debates → promise intake | https://hansard-api.parliament.uk/ |
| TheyWorkForYou API (mySociety) | Speeches by person, voting records | https://www.theyworkforyou.com/api/ |
| UK Parliament Bills API | Bill stages → `legislated` events | https://bills-api.parliament.uk/ |
| legislation.gov.uk | Enacted law, commencement | https://www.legislation.gov.uk/developer |
| GOV.UK Content API / search | Press releases, policy papers → `funded`, `delivering` events | https://www.gov.uk/api/search.json |
| Contracts Finder / Find a Tender | Procurement evidence for delivery | https://www.contractsfinder.service.gov.uk/ · https://www.find-tender.service.gov.uk/ |
| Party manifestos | Bulk promise intake at elections | Party websites; archive copies on web.archive.org |
| Broadcast debates | Transcripts (BBC, ITV, Sky) — manual + LLM | Per broadcaster |

## Comparable and reusable projects

| Project | What to take | URL |
|---|---|---|
| PolicyEngine UK | Open microsimulation (T1), web API, UX for reforms | https://github.com/PolicyEngine/policyengine-uk · https://policyengine.org/uk |
| IFS TaxLab | Explainers, tax-by-tax framing | https://ifs.org.uk/taxlab |
| Full Fact | Fact-check workflow, claim monitoring | https://fullfact.org |
| Slovo i Dilo (Ukraine) | Promise tracker statuses and politician pages | https://www.slovoidilo.ua |
| CPB (Netherlands) | Costing party programmes before elections | https://www.cpb.nl |
| CBO (US) | Cost estimates format | https://www.cbo.gov |
| PolitiFact promise trackers | Rating ladders ("Promise kept / broken / stalled / compromise") | https://www.politifact.com |
| USAspending | Drill-down from budget to contract | https://www.usaspending.gov |
| OpenSpending (OKFN) | Budget data standards (Fiscal Data Package) | https://openspending.org |
| Where Does It Go? | A UK consumer "where your tax goes" site — check positioning | https://wheredoesitgo.co.uk/ |

## ETL contract

Each module in `etl/sources/<id>.py` exposes:
```python
def fetch(since: date | None) -> RawArtifact          # download, store raw file with hash under data/raw/
def parse(raw: RawArtifact) -> list[Observation]      # normalise to Observation schema
SOURCE: Source                                        # metadata
```
`etl/build.py` runs all, validates with schemas, runs the balance check, writes `data/build/` + `manifest.json` (source, vintage, hash, fetched_at). CI fails if a source is staler than its cadence + grace period.

A vintage names an edition, so it must change only when the data does: take it from the publisher (release date, edition name) or from the data itself (Bank Rate: "IADB IUDBEDR as of <latest decision>"), never from the day of the fetch. The nightly opens a pull request whenever a file under `data/build/observations` changes, so a label that moves on its own opens one every night. As a backstop, the build does not write an edition whose rows repeat the newest committed edition holding them under a new label (GOV.UK's `updated_at` moves on technical republishes); it keeps the committed file and logs an `edition` info check. After fetching, the build assembles from the committed editions, exactly as the offline rebuild in CI does.

A publisher that refuses GitHub's servers (OBR's Cloudflare answers 403) is read through the Internet Archive: the module passes `archive=True` to `core.download()` (see `etl/wayback.py` for the freshness rules). The `RawArtifact` keeps the publisher URL it asked for in `url` and records where the bytes came from in `fetched_url` and, for an archive copy, `archived_at`; both go into the manifest, `history/artifacts.csv` and the nightly pull request. If the archive has no fresh copy, the build keeps the committed edition and says how to refresh it by hand (`docs/OPERATIONS.md`, section 11).
