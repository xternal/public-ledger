# Budget day: Autumn Budget 2026

The plan for **Wednesday 28 October 2026**, the day of the Autumn Budget (date: [House of Commons Library](https://commonslibrary.parliament.uk/research-briefings/cbp-12226/)). Clocks go back on 25 October, so every time here is GMT. The aim: by the next morning, every card the Budget touched shows what it did, with a link to the page that says so, approved by two editors.

[ledgergov.uk/budget](https://ledgergov.uk/budget) does the rest by itself: it lists the government's promises the Budget can still move, and from the day it leads with "What the Budget did", built from every event dated 28 October. It re-renders hourly, so a merged change appears within the hour.

## Timetable

| When (GMT) | What | Who |
|---|---|---|
| Before the day | Read this page and the 14 watched cards; check the follow emails work | Editors |
| About 12:30 | The Chancellor's statement, after Prime Minister's Questions (time from press reports) | Watch, don't edit yet |
| Straight after | The Budget documents on GOV.UK and the OBR's forecast are published | — |
| Afternoon | Read the documents against the checklist below; note each card's page and table | Editors, AI Journalist |
| By 20:00 | One pull request with an entry for every card the Budget touched, each with its evidence link | Drafted by AI Journalist, opened by the owner |
| Evening or next morning | Two editors review and approve; the owner merges | Editors, owner |
| Within an hour of merge | `/budget`, the cards and the feeds update; follow emails go out | Automatic |

## The documents to read

Published on GOV.UK straight after the statement (the Treasury's Budget page links them all) and on obr.uk:

1. **The Budget document** (the "Red Book"). Its table of policy decisions lists every new measure with its cost or yield for each year: this is the official yearly figure a card's cost should use.
2. **Policy costings**: how each of those figures was worked out.
3. **The OBR's Economic and fiscal outlook** (EFO) and its supplementary tables: borrowing, debt, and the OBR's view of the measures. Use it for defence and anything the OBR comments on.
4. **Overview of tax legislation and rates** (OOTLAR): the tax rates and thresholds that will apply. Use it for the tax pledges.
5. **Departmental budget tables**: what each department gets, for promises funded from a department's budget.

Cite the exact page: add `#page=NN` to a PDF link, or link the HTML section.

## What would move each watched card

| Card | Status now | What to look for | What it means for the card |
|---|---|---|---|
| [5% of GDP on national security by 2035](https://ledgergov.uk/promise/uk-nato-5pc-2035-2025) | In plan | Defence spending path in the Budget and the EFO; any new money towards 3.5% core defence | Money allocated on the path: a `funded` event. A new official figure: a cost correction |
| [Cap bus fares at £2](https://ledgergov.uk/promise/uk-bus-cap-2-2026) | In plan | The £400m (England) in DfT's budget for 2026-27 and 2027-28 | Confirmed in Budget documents: `funded` |
| [Cut manufacturers' electricity bills](https://ledgergov.uk/promise/uk-bics-electricity-2026) | In plan | The Exchequer's share of the scheme (due to be scored at this Budget) | Scored: `funded`, and the yearly cost if it changes |
| [No tax rises for working people](https://ledgergov.uk/promise/uk-no-tax-rise-working-people-2024) | In plan | Main rates of income tax, employee National Insurance and VAT in OOTLAR | A rise in one of those rates: `failed` (reads **Not met**) with evidence. Frozen thresholds don't change a rate: say so in the status note and let two editors decide |
| [Cap corporation tax at 25%](https://ledgergov.uk/promise/uk-corp-tax-cap-25-2024) | Legislated | The main rate in OOTLAR | Main rate above 25%: `failed` |
| [Fund 10 major hospital projects and maintenance](https://ledgergov.uk/promise/uk-nhs-capital-1-5bn-2026) | In plan | Estates Safety Fund or NHS capital lines | Money confirmed by year: `funded`, and a yearly cost if one is now published |
| [Free unlimited bus travel for disabled people](https://ledgergov.uk/promise/uk-disabled-bus-pass-2026) | Promised | The £60m in DWP or DfT budgets, and whether it is yearly | Confirmed: `funded`; a yearly figure: cost correction |
| [Mental health strategy before Christmas](https://ledgergov.uk/promise/uk-mental-health-strategy-2026) | Promised | Money for mental health tied to the strategy | Money alone doesn't move it; note it. The strategy presented to Parliament: `in_plan` |
| [Mayors control the 16-19 budget](https://ledgergov.uk/promise/uk-mayors-16-19-budget-2026) | Promised | The devolution white paper, expected alongside the Budget | Published and naming it: `in_plan` |
| [SEND inclusion standards](https://ledgergov.uk/promise/uk-send-inclusion-standards-2026) | Promised | SEND funding or the standards themselves | Funding: note it. Standards published: `delivered` |
| [Curriculum proposals](https://ledgergov.uk/promise/uk-curriculum-proposals-2026), [nude-images law](https://ledgergov.uk/promise/uk-child-nude-images-law-2026), [landlord register](https://ledgergov.uk/promise/uk-landlord-register-2026), [socio-economic duty](https://ledgergov.uk/promise/uk-socio-economic-duty-2026) | — | Unlikely in a Budget; check quickly | Move only if a document names them |

**New promises in the speech** ("we will…") become new cards like any other: the quote word for word from Hansard (as soon as it is published), status Promised, and the Budget's own costing if it gives one. The daily intake picks up the Hansard transcript by itself; editors resolve its drafts as usual.

**The opposition's costed pledges** on `/budget` don't move with the Budget. If an opposition party responds with a new pledge, it is a new card, by the same rules.

## Ready-made entries

A status change is three edits to the card: append the event, change `status`, and update `status_note` (it describes the present, so it is edited, not corrected).

```yaml
# 1. Append to events (never edit an existing one)
  - date: "2026-10-28"
    type: funded
    text: Autumn Budget 2026 allocates £0.4bn in 2027-28 for the £2 fare cap in England
    evidence_url: https://assets.publishing.service.gov.uk/…/Budget_2026.pdf#page=NN
```

```yaml
# 2. The current status
status: funded
# 3. One or two sentences on where it stands now, with what the Budget did
status_note: >-
  The Autumn Budget 2026 confirmed £0.4bn for 2027-28 (Budget document, table N). The cap runs from
  1 January to 31 December 2027.
```

A new official yearly cost is a correction to the version, recorded as in [PROMISE_STANDARD.md §9](PROMISE_STANDARD.md):

```yaml
corrections:
  - date: "2026-10-28"
    path: versions[0].parameters.how_much_bn_per_year
    was: null
    now: [0.36, 0.4, 0.44]
    reason: >-
      The Autumn Budget 2026 published the official yearly cost: £0.4bn in 2027-28 (table N). Low–high is an
      editorial ±10% because the source gives a central figure only.
    source_url: https://assets.publishing.service.gov.uk/…/Budget_2026.pdf#page=NN
```

A broken pledge reads **Not met**, never "broken": the label states the fact, the evidence link carries the rest.

## Rules that matter most on the day

- **Only documents move cards.** The speech, briefings and press coverage are leads; the Budget documents, the OBR and legislation are evidence.
- **One standard.** Every card the Budget touches is updated the same evening, whatever the party.
- **Two editors** approve the pull request before it merges, as always. If only one editor is free, it waits until the morning: being right matters more than being first.
- **No guesses.** If a document gives a total for several years and no yearly split, the card says so, as now.
