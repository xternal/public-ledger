# PRD — Public Ledger (UK pilot)

## Problem

People hear "£2 bus fares", "3.5% on defence", "cut income tax by 2p" and have no way to see, in seconds, what it costs, who pays, what it displaces, and whether it ever happened. Official sources (OBR, HMT, HMRC, ONS) publish the numbers, but as PDFs and spreadsheets for specialists. Promise trackers track; fiscal watchdogs cost; nobody links the two in a consumer interface.

## Users and jobs

| User | Job to be done | Success looks like |
|---|---|---|
| Curious voter | "Politician X said Y on TV. Is it affordable, who pays, what's in it for me?" | Lands on a card from a shared link, understands it in <30 s |
| Journalist | "I need a cited cost and funding source for this pledge before my deadline." | Copies a chart + sourced number + link into an article |
| Campaigner / think tank | "Show the trade-off: what does 3.5% on defence displace?" | Builds and shares a scenario URL |
| Politician / staffer | "That card mis-parameterises our pledge." | Files a right-of-reply that is published next to the card |
| Editor (internal) | "Turn this speech into cards fast and consistently." | Draft card from LLM extraction, reviewed and merged in <72 h |

## Scope v0 (MVP)

### F1. Statement
- Sankey: receipts by tax (≈12 lines) + borrowing → public purse → spending by function (≈11 lines). Borrowing and debt interest share a colour ("the cost of the gap").
- Unit toggle: £bn · per household · pence per £1 spent.
- Year selector: 2019-20 to latest forecast year (outturn vs forecast marked).
- Click any node → drill-down drawer: sub-lines (e.g. Social protection → State pension, Universal Credit, disability benefits…), 10-year trend sparkline, sources, quality badge.
- Text/table alternative for every chart.
- **Acceptance:** balances to £0.1bn every year; every node shows a quality badge on hover/focus; renders <1 s on 4G.

### F2. Sandbox
- Levers v0: Bank Rate (central bank), income tax basic/higher/additional rates, personal allowance, employee NICs, VAT, corporation tax, fuel duty, capital gains tax lower/higher rates (HMRC's own steps only, no slider), defence % GDP, NHS budget %, state pension level %, plus "point measures" tied to promises (e.g. bus fare cap) with funding options.
- Presets: one per promise card that has `lever_id`s; plus editorial presets.
- Outputs (year one and to the end of forecast horizon): Δ borrowing, per household, CPI one-off, GDP year one, debt % GDP path. All as low/central/high.
- "What moved" list in plain language. Mortgage translation for Bank Rate.
- Shareable: scenario encoded in URL (`?s=` compact string). Share page renders OG image with headline numbers.
- **Acceptance:** results within 50 ms of slider input; golden tests per lever; scenario round-trips through URL.

### F3. Your share
- Salary → income tax + NI (UK rates for selected year; Scotland toggle in v1) → split by spending function + "borrowed on top in your name".
- Recomputes under the current scenario.
- Client-side only.

### F4. Promise ledger
- Card: text (verbatim), actor, date, venue, source links, parameters (who/how much/when/funded by), status on ladder, deadline, linked levers, timeline, versions (diff), right of reply.
- Status ladder: `promised → in_plan → legislated → funded → delivering → delivered` or terminal `failed`, `quietly_dropped`; separate `unscoreable`.
- Auto events: when `deadline` passes with no terminal status, a `deadline_missed` event is appended by a nightly job ("silence becomes visible").
- Translation strip: £/year, per household, share of spending (ranges).
- "Run in sandbox" applies the card's levers.
- Lists: filter by actor, party, status, policy area, cost band; sort by date / cost / overdue.
- **Acceptance:** schema validation blocks merge on missing source or parameters (unless `unscoreable`); every card has a stable URL and OG image.

### F5. Actor page (credit history)
- Promises made, delivered, delivering, failed, quietly dropped, unscoreable; total pledged £/yr; share funded vs unfunded at announcement.
- No composite "liar score" in v0. Show the distribution and let people judge. (A score invites the "rigged" attack before the methodology is trusted.)

### F7. Follow (no account in v0)
- Follow a promise, an actor, a policy area or a deadline window.
- Channels: RSS/Atom, email (double opt-in), Telegram bot. Web push in v1.
- Alerts fire on: status change, new timeline event (incl. automatic `deadline_missed`), new version (rewording), cost range change, right-of-reply published.
- Weekly digest option instead of instant alerts.
- Aggregate follower count on cards, hidden below 50.
- **Acceptance:** a status change merged to main produces RSS, email and Telegram alerts within 15 minutes; one-click unsubscribe and delete; no third-party tracking in emails.

### F8. Contribute (no account in v0)
- "Send us a promise": link (required), time in video, who, the words, optional email, opt-in credit.
- "Add evidence" on any card: link + what changed.
- On arrival: URL check, archive snapshot, transcript fetch and exact-match of the quote where possible, LLM pre-fill for the editor, dedupe.
- Submitter gets a reference number; optional email update when the submission becomes or changes a card.
- Card shows "Started from a reader submission" and the handle if credit was requested.
- **Acceptance:** spam controls on; nothing reaches a public page without the two-editor merge; submitter can delete their email at any time.

### F9. Accounts (v1, optional)
- Passkey or magic link. Sync follows across devices, see own submission history, public handle for credit.
- Contributor trust levels (accepted submissions) change review order only.
- "Cost this next" voting for verified members (ties to the member registry, Project 1). Votes change queue order, never findings.
- Never: public profiles, public follow lists, comments.

### F6. Method & sources
- Plain-language methodology, model tiers, quality labels, changelog of data vintages, link to repo.

## v1+
- LLM promise intake from Hansard, TheyWorkForYou, manifestos, debate transcripts → draft cards (M4).
- PolicyEngine UK distributional results: by decile, region, household type (M5).
- Demography and long-term pressures (OBR Fiscal risks and sustainability) (M6).
- Public backtest ledger (M7). Public API + CSV exports.
- Personal mode v2: "people like me" (household type, region, tenure).

## Non-goals
- Our own macroeconomic model in v0–v1.
- Fact-checking statements that are not promises.
- Any data about citizens' finances. Accounts are never needed to read, build or share scenarios.
- Comments, likes on findings, public user profiles.

## Risks
| Risk | Mitigation |
|---|---|
| "The model is rigged" | Open code, public sources, ranges, ensemble, backtest, independent methodology board |
| Parameterisation is hidden editorial power | Public standard (`PROMISE_STANDARD.md`), `unscoreable` status, right of reply |
| False precision | Ranges everywhere, quality badges, no single-number forecasts |
| Seen as partisan, or as a campaign in disguise | Independent and self-funded, published funding, one standard for every party, neutral brand |
| Stale data | Nightly ETL, vintage shown on every chart, staleness alert in CI |
| Follow lists reveal political opinions (UK GDPR Art. 9) | Explicit consent, minimal storage, aggregates only, DPIA, see PRIVACY_AND_ACCOUNTS.md |
| Brigading via submissions | Editor gate, dedupe, rate limits; volume never changes a status |
| Defamation from status labels on named people | Evidence standard per status, right of reply, legal review of templates |
| UK election law (non-party campaigning) | Legal advice before launch and before each regulated period; UK entity and funding |
