# Public Ledger — an open P&L of the state

**Live at [ledgergov.uk](https://ledgergov.uk).** This file covers the concept, the product logic and the build order. Specs for implementation live in `CLAUDE.md` and `docs/`; known issues in `docs/PRE_SHIP_REVIEW.md`. To run it yourself, see [Run it locally](#run-it-locally); to help, see [CONTRIBUTING.md](CONTRIBUTING.md).

**Who is behind it.** Public Ledger is built by [Pavel Guzhikov](https://guzh.uk), a UK resident, as an active citizen: someone who wants a better-informed society and new, more accountable forms of government. It is run through Empatiq Limited, Pavel Guzhikov's company, which holds any data readers give the site ([privacy notice](https://ledgergov.uk/privacy)). Empatiq Limited has no clients or contracts with government, political parties or any body this site tracks; if that ever changes, it will be declared here. It is independent. No party, campaign or government funds or directs it, and it holds every party, in government or opposition, to the same published standard.

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

The worked example (real, autumn 2026; figures corrected against official sources in M3):

* On 22 July 2026 Prime Minister Andy Burnham announced a return to a £2 single bus fare cap in England outside London for 2027, backed by £400m of extra funding (DfT written statement).
* There is no surplus. In 2025-26 income was £1,231bn, spending £1,366bn, borrowing £134bn (ONS outturn).
* Funding named: an extra £454m, including the devolved governments' share, from reprioritising DESNZ's budget by switching international climate finance into loans (No 10 press release).
* In the sandbox: +£0.4bn spending, −£0.4bn from international spending, so the net effect on borrowing is about zero (range ±£0.04bn). The measure costs **£14 per household a year, 0.03% of spending**. Had no source been named, all of it would have been borrowed. (The first draft of this example used a press figure of "over £500m", which no official source gives.)

That is the product: a headline phrase becomes three numbers a person understands and one line on what pays for it.

Sources: DfT written statement (https://www.gov.uk/government/speeches/2-bus-fares-from-january-2027), No 10 press release (https://www.gov.uk/government/news/cheaper-travel-for-millions-with-a-third-off-fares), ONS public sector finances.

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

1. **Bank Rate in the UK is not a government lever.** The independent Bank of England sets it (3.75%, held 17 Sep 2026, next decision 5 Nov). The sandbox lets you move it, labelled "not a decision by politicians". Its fiscal channel is debt interest (≈£110bn a year, 8p of every £1 spent).
2. **Do not build our own macro model.** It takes years and invites the "rigged model" attack. Open building blocks exist: OBR and HMRC publish ready reckoners (cost of 1p on income tax, VAT, etc.), and PolicyEngine UK is an open-source tax-benefit microsimulation with an API. Our edge is the interface, the speed (promise → card in 48 hours), tracking over time and one standard for everyone.
3. **The gap is the product, not the data.** UK analysis is plentiful (OBR, IFS, Full Fact, PolicyEngine). What is missing is one consumer product linking promise → cost → status, readable in seconds by anyone.
4. **Independent and neutral from day one.** A tool that scores parties must not be run or funded by one. Publish who funds it, keep the brand neutral, and take advice on UK election law before regulated campaign periods (see the review).
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

Out: user accounts, microsimulation (v1), LLM intake from Hansard and TV (v1), demography (v2), backtest (v2).

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

## 7. Metrics

* Time from headline promise to card: < 72 h by end of pilot.
* Costed cards: 100 at launch, 300 after six months.
* Media citations: 10 in the first quarter.
* Accepted community submissions: share of new cards that started as a submission.
* Followers per card and alert click-through: does the timeline bring people back.
* Share of cards where the actor used the right of reply: a sign that the people we assess read us.

## 8. What is in the pack

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
| `docs/EDITORS.md` | Editors | The editors' guide: the rules in plain words, how to review a card on GitHub, the declaration |
| `docs/BUDGET_DAY.md` | Editors | The plan for Budget day (28 Oct 2026): documents, what moves each watched card, ready-made entries |
| `docs/PRIVACY_AND_ACCOUNTS.md` | Product, legal | Follow, contribute, accounts and the data rules around them |
| `docs/DESIGN_HANDOFF.md` | Designer | Screens, components, tokens, mobile |
| `docs/BUILD_PLAN.md` | Claude Code | Milestones with ready-to-paste prompts |
| `data/seed/*.json` | All | Seed data (P&L 2025-26, levers, promises) |
| `prototype/` | Design, engineering | Clickable prototype; `index.html` is built by `build_prototype.py` |

Confidence in the numbers: 2025-26 totals and the OBR borrowing and debt path are high (OBR, March 2026). Tax-by-tax and function splits are approximate, scaled from PESA 2024-25, and three lines are balancing plugs. Lever coefficients (cost of 1p of tax) are from model memory and labelled `training`; they must be replaced by HMRC tables before public launch.

## Run it locally

You need Node 22 (see `.nvmrc`), pnpm 12 (`corepack enable pnpm`) and, for the data pipeline, Python 3.14.

```bash
pnpm install
pnpm dev          # the site at http://localhost:3000
pnpm test         # engine, schema and server tests
pnpm validate     # schemas, the balance check, promise lint
```

Nothing else is needed to read and edit locally: without a `DATABASE_URL` the app uses an in-process database, writes mail to an outbox table and skips the Claude pre-fill (`apps/web/.env.example`). For the data pipeline: `python3.14 -m venv etl/.venv && etl/.venv/bin/pip install -r etl/requirements.txt`, then `pnpm etl`. Running the live service (database, mail, alerts, intake) is in `docs/OPERATIONS.md`.

## Licence

* **Code** (everything in this repository that is software): [GNU Affero General Public License v3.0 or later](LICENSE). You may run, study, change and share it; if you run a changed version as a website, you must offer its source to the people who use it.
* **Our writing** (status notes, cost notes, summaries, method pages, the promise cards' own text): [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Credit Public Ledger with a link to the page.
* **Official figures** keep their own licences, mostly the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/); quotes from Parliament are under the [Open Parliament Licence](https://www.parliament.uk/site-information/copyright-parliament/open-parliament-licence/); other quotes are short extracts whose rights stay with the speaker. See `/method#licence` on the site.

Copyright © 2026 Pavel Guzhikov and contributors.
