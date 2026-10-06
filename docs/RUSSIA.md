# Russia adaptation

Same engine, interface and promise standard. Sources, levers, quality labels and language change. Build it as a second `country` config, not a fork.

## 1. What is fundamentally different from the UK

| | UK | Russia |
|---|---|---|
| Data | Open, machine-readable, with an independent forecaster (OBR) | Partly closed: classified spending lines, statistics publication cut back since 2022, some government sites blocked from abroad |
| Main revenue | Income tax and NICs | Oil and gas revenue (driven by Urals price, exchange rate, volumes) + VAT |
| Buffer | None; every gap is borrowed | National Wealth Fund (NWF): deficits are partly covered by selling NWF assets, not only by borrowing |
| Rate → budget | Through debt interest | Also through subsidised mortgage and loan programmes, whose budget cost rises with the key rate |
| Promises | Manifestos, Hansard | May decrees 2012 and 2018, national projects, Presidential addresses, "Direct Line", election programmes, governors' pledges |
| Independent costing | OBR, IFS | None inside the country; exile and foreign centres (Re: Russia, BOFIT, etc.) |

## 2. The Russian Sankey

Left: oil and gas revenue · VAT · personal income tax (mostly regional) · profit tax · social contributions (to extra-budgetary funds) · other · **NWF asset sales** · **borrowing (OFZ)**.
Right, by budget classification sections: national defence · national security and law enforcement · social policy · health · education · national economy · debt service · transfers to regions · housing and utilities · other.

**The grey zone.** Classified spending is drawn as its own hatched "not disclosed" flow, with an estimated range, never hidden in "other". Independent analysts estimated the closed share of federal spending in 2024–2025 at roughly a quarter to a third (from model memory; verify against Re: Russia and similar before publishing). This is the central visual argument of the "Product instead of a promise" concept.

Levels: federal budget → consolidated budget (with regions) → extra-budgetary funds (Social Fund, Compulsory Medical Insurance Fund). v1 is federal only; consolidated later.

## 3. Russian levers v0

* Urals price, $/bbl (external) → oil and gas revenue, NWF transfers under the fiscal rule.
* Rouble/dollar exchange rate (external / central bank) → oil and gas revenue in roubles, inflation.
* Key rate (Bank of Russia) → debt service, cost of subsidised mortgages and loan subsidies, household mortgage payment.
* Defence and security spending, % GDP (government).
* VAT, personal income tax (progressive scale since 2025), profit tax (government).
* Pension indexation (government).
* Point measures from promises: maternity capital, payments, national projects.

## 4. Sources

| Source | What | URL |
|---|---|---|
| Ministry of Finance | Monthly federal budget execution estimates, oil and gas revenue, NWF | https://minfin.gov.ru |
| Electronic Budget portal | Budget law, allocations, execution | https://budget.gov.ru |
| Federal Treasury | Budget execution, consolidated reports | https://roskazna.gov.ru |
| Bank of Russia | Key rate, exchange rates, lending statistics, API | https://cbr.ru |
| Rosstat / EMISS | Demography, prices, incomes, employment | https://rosstat.gov.ru · https://fedstat.ru |
| Unified procurement system | Contracts and execution | https://zakupki.gov.ru |
| Clearspending (Infometer) | Friendly interface to procurement data | https://clearspending.ru |
| Accounts Chamber | Execution reports, national projects audits | https://ach.gov.ru |
| Decrees and laws | Decree texts, Presidential addresses | http://kremlin.ru/acts · http://publication.pravo.gov.ru |
| State Duma bills | Bill stages | https://sozd.duma.gov.ru |
| Re: Russia | Independent budget and economic analysis | https://re-russia.net |
| CMACON (ЦМАКП) | Macro analysis and forecasts | http://www.forecast.ru |
| BOFIT (Bank of Finland) | External assessments of the Russian economy | https://www.bofit.fi |

Practical point: some Russian government sites block foreign IPs. The ETL must work through mirrors or archived copies and keep raw files with hashes (already part of the ETL contract).

## 5. Promise ledger: first batch

1. May decrees of 2012 (targets: public-sector pay, productivity, high-productivity jobs).
2. May decrees of 2018 and the national goals for 2024 / 2030.
3. National projects 2019–2024 and the new national projects to 2030.
4. Ten years of Presidential addresses to the Federal Assembly.
5. The Peaceful Russia (Мирная Россия) programme: assessed first, by the same standard (see Project 6).

Unlike the UK pilot, this batch has a long history. It can show the full cycle on day one: promised → reworded → quietly moved to 2030.

## 6. "What it means for me"

Region (pay and prices vary widely), occupation (public-sector workers), mortgage (subsidised vs market), pension. Exchange rate and inflation shown as fans. There is no PolicyEngine-grade microsimulation for Russia; v1 uses Rosstat aggregates by region and decile.

## 7. Follow and contribute in Russia mode

Accounts are **off**. A list of people who follow promises by the Kremlin is a liability for those people. Follow works through RSS and a Telegram bot that stores no subscriber list beyond what Telegram itself holds. Submissions are anonymous by default: no IP logging, metadata stripped from uploads, Tor-friendly form, no requests for real names. See `PRIVACY_AND_ACCOUNTS.md`.

## 8. Russia-specific risks

* Poor and closed data → a quality label on every number, the grey zone on the Sankey, cross-checks against alternative estimates.
* Accusations of bias → one standard, the party's own programme assessed first, an independent methodology board.
* Safety of the team, contributors and sources inside Russia → no data about citizens, editors outside Russia, public sources only, anonymous-by-default submissions.
