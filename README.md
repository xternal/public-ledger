# Public Ledger — an open P&L of the state

Working title. This file covers the concept, the product logic and the build order. Specs for implementation live in `CLAUDE.md` and `docs/`. Read `docs/PRE_SHIP_REVIEW.md` before anything goes public.

## 1. The idea in one paragraph

A country is a company with 69 million shareholders and no annual report they can read. We build that report. The country's P&L reads in ten seconds, like the Alphabet or Amazon income-statement Sankeys. Next to it sits a sandbox where any politician's proposal turns, within a second, into "what it costs, where the money comes from, and what it does to debt, prices and my wallet". The third part is a promise ledger: a credit history for people in power. Every promise has a timeline that ends either in action or in visible silence.

## 2. The core design decision: a promise is a sandbox scenario

The modules form one chain:

```
Promise (card)  →  parameters (who, how much, when, paid for by what)
                →  a set of levers in the sandbox
                →  result: Δ borrowing, debt, prices, GDP, per household (all as ranges)
                →  delivery timeline (linked to budget, legislation and statistics)
```

The worked example (real, autumn 2026):

* On 22 July 2026 Prime Minister Andy Burnham announced a return to a £2 single bus fare cap in England from January 2027, at a cost of over £500m a year.
* There is no surplus. In 2025-26 income was £1,235bn, spending £1,368bn, borrowing £133bn.
* Funding named: £400m from switching international climate finance from grants to loans, the rest from DESNZ savings and existing DfT bus money.
* In the sandbox: +£0.5bn spending, −£0.4bn from international spending, so the net effect on borrowing is about +£0.1bn a year. The measure costs **£17 per household a year, 0.04% of spending**. Had no source been named, all of it would have been borrowed.

That is the product: a headline phrase becomes three numbers a person understands and one line on what pays for it.

Sources: ITV News (https://www.itv.com/news/2026-07-22/andy-burnham-unveils-2-bus-fare-cap-in-pledge-to-be-cost-of-living-government), OBR March 2026 (https://obr.uk/forecasts-in-depth/brief-guides-and-explainers/public-finances/).

## 3. Modules

| # | Module | What the user sees | What makes it different |
|---|---|---|---|
| 1 | **Statement (P&L)** | Sankey: taxes → public purse → spending by function. Borrowing is a hatched amber flow; debt interest shares the colour ("the cost of the gap"). Units: £bn / per household / pence per £1 | A live picture that redraws from any lever, not a "budget for citizens" PDF |
| 2 | **Sandbox** | Levers: taxes, Bank Rate, defence % GDP, NHS, pensions, point measures (bus cap). Presets per politician's proposal. Results: Δ borrowing, per household, CPI, GDP, debt/GDP to 2030-31, all as ranges | Instant, in the browser. Each lever says **who controls it** (government / Bank of England / demography) |
| 3 | **Your share** | Enter a salary → what you pay and where it goes, plus "borrowed on top in your name" | Translation into household terms |
| 4 | **Promise ledger** | Card: quote, actor, source, parameters, status ladder, timeline, cost, "run in sandbox" | Costing + tracking over time + household translation in one place. "Unscoreable" = slogan |
| 5 | **Credit history** | Per politician/party: promised, delivered, quietly dropped, unscoreable | Who over-promises and by how much, shown through data, not labels |
| 6 | **Follow & Contribute** | Follow a promise or actor and get alerts when status changes; send in a promise or evidence you saw | Retention loop and a crowd-sourced intake funnel, editor-gated |
| 7 | **People** (v2) | Demography: workers vs pensioners, births, ageing → pressure on pensions and NHS over 10–50 years | Uses OBR long-term projections, does not build its own |
| 8 | **Backtest** (v2) | Every model forecast stored and compared with outturn | A model that publishes its misses |

## 4. Where the original brief needed correcting

1. **Bank Rate in the UK is not a government lever.** The independent Bank of England sets it (3.75%, held 18 Sep 2026, next decision 5 Nov). The sandbox lets you move it, labelled "not a decision by politicians". Its fiscal channel is debt interest (≈£110bn a year, 8p of every £1 spent). In Russia it matters more: the key rate directly drives the budget cost of subsidised mortgages and loans.
2. **Do not build our own macro model.** It takes years and invites the "rigged model" attack. Open building blocks exist: OBR and HMRC publish ready reckoners (cost of 1p on income tax, VAT, etc.), and PolicyEngine UK is an open-source tax-benefit microsimulation with an API. Our edge is the interface, the speed (promise → card in 48 hours), tracking over time and one standard for everyone.
3. **The UK is the test track, not the market.** UK analysis is plentiful (OBR, IFS, Full Fact, PolicyEngine). What is missing is one consumer product linking promise → cost → status. The UK pilot exists to harden the engine, the standard and the design, and to earn outside validation. The bigger value is Russia, where data is worst and promises are plentiful.
4. **The UK pilot needs a neutral brand and a UK entity from day one.** A British tool run by a Russian opposition party is the first thing journalists would write about, and UK election law restricts campaigning by foreign-linked bodies (see the review).
5. **Ranges are not decoration.** No single-number forecasts. The first visible miss would otherwise discredit the whole ledger.
6. **No composite "liar score" in v0.** Show the status distribution and let people judge. A single score is the easiest thing to attack before the methodology has earned trust.

## 5. MVP (UK): in and out

In (≈6–8 weeks for one developer with Claude Code; low-confidence estimate):
* Statement on OBR/HMT data, with a quality label on every number.
* Sandbox tier T0 (ready-reckoner arithmetic) plus debt dynamics, all client-side, scenarios shareable by link.
* Your share (income tax + NI).
* Promise ledger: 50–100 hand-made cards, status ladder, timeline, automatic "deadline passed, silence" event, actor page.
* Follow without accounts (RSS, email alerts) and an anonymous "send us a promise / evidence" form feeding the editors' queue.
* OG images for every card and scenario (the share preview is where virality lives).
* Methodology and sources page.

Out: user accounts, microsimulation (v1), LLM intake from Hansard and TV (v1), demography (v2), backtest (v2), Russia (v3).

## 6. Roadmap

| Stage | Time | Result |
|---|---|---|
| M0–M1 | 2 wks | Next.js app from the prototype; ETL of real OBR/PESA/ONS/BoE data |
| M2–M3 | 3 wks | Sandbox with tests; promise ledger in git (PR = editorial review, history = wording diffs) |
| M3b | 1 wk | Follow (RSS/email) and Contribute (anonymous submissions → editors' queue) |
| M4 | 2 wks | Intake: Hansard/TheyWorkForYou + LLM → draft cards for editors |
| M5 | 3 wks | PolicyEngine UK: "what it means for me" by household type, decile, region |
| M5b | 1 wk | Optional accounts (passkey/magic link): synced follows, contributor credit |
| M6–M7 | 3 wks | Demography and long-term horizon (OBR FSR), backtest, public API |
| M8 | — | Russia adapter (see `docs/RUSSIA.md`) |

## 7. Metrics (from Project 6, adapted to the UK pilot)

* Time from headline promise to card: < 72 h by end of pilot.
* Costed cards: 100 at launch, 300 after six months.
* Media citations: 10 in the first quarter.
* Accepted community submissions: share of new cards that started as a submission.
* Followers per card and alert click-through: does the timeline bring people back.
* Share of cards where the actor used the right of reply: a sign that the people we assess read us.

## 8. Moving to Russia, briefly

Same engine. Three things change: sources (Ministry of Finance, Treasury, Central Bank, procurement portal, decrees and national projects); quality labels (the classified part of the budget and cut-back Rosstat statistics appear on the Sankey as a visible grey zone); and levers (oil and gas revenue and the Urals price, the National Wealth Fund, the exchange rate, key rate → subsidised mortgages, open and classified military spending). The first batch of promises is the May decrees of 2012 and 2018 and the national projects. Accounts are off by default in Russia mode. Details: `docs/RUSSIA.md`.

## 9. What is in the pack

| File | For | What |
|---|---|---|
| `HANDOVER_PROMPT.md` | Claude Code, designer | The two kick-off prompts to paste or send |
| `CLAUDE.md` | Claude Code | Project rules, stack, invariants, working order |
| `docs/PRE_SHIP_REVIEW.md` | Everyone | Known issues ranked by severity, with fixes and owners |
| `docs/PRD.md` | Product, engineering | Users, jobs, features, acceptance criteria |
| `docs/DATA_MODEL.md` | Engineering | Entities and schemas |
| `docs/MODEL.md` | Engineering, economists | Model tiers T0–T3, formulas, ranges, backtest |
| `docs/DATA_SOURCES.md` | Engineering | UK sources with URLs and how to ingest them |
| `docs/PROMISE_STANDARD.md` | Editors | Parameterisation, statuses, submissions |
| `docs/PRIVACY_AND_ACCOUNTS.md` | Product, legal | Follow, contribute, accounts and the data rules around them |
| `docs/DESIGN_HANDOFF.md` | Designer | Screens, components, tokens, mobile |
| `docs/BUILD_PLAN.md` | Claude Code | Milestones with ready-to-paste prompts |
| `docs/RUSSIA.md` | Party team | Russia adaptation |
| `data/seed/*.json` | All | Seed data (P&L 2025-26, levers, promises) |
| `prototype/` | Design, engineering | Clickable prototype; `index.html` is built by `build_prototype.py` |

Confidence in the numbers: 2025-26 totals and the OBR borrowing and debt path are high (OBR, March 2026). Tax-by-tax and function splits are approximate, scaled from PESA 2024-25, and three lines are balancing plugs. Lever coefficients (cost of 1p of tax) are from model memory and labelled `training`; they must be replaced by HMRC tables before public launch.
