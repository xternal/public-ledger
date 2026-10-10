# Moving Public Ledger onto OpenPromises

The plan for moving Public Ledger's promise cards and their checks onto the OpenPromises engine, and what we found when we tried it. This document changes no code. Under [RFC 0001](https://github.com/xternal/openpromises/blob/main/docs/RFC-0001.md), decision 9, work on the move starts on **Thursday 29 October 2026**, after Budget day. Nothing touches the live site in Budget week.

| | |
|---|---|
| Written | 9 October 2026 |
| Public Ledger | `main` at `e7e924d` (after #67: who must deliver, and who made each cost): 54 cards, 19 actors |
| OpenPromises | release 0.1.0 (`81276cf`), its own built command-line tool, run unchanged |
| Read first | RFC 0001 §7–§10 and §12; OpenPromises `docs/FORMAT.md`, `docs/COMPARISON.md`, `docs/DECISIONS.md`, `docs/MIGRATING.md` |

## Update, 10 October 2026: what has changed since this was written

The findings below are from OpenPromises 0.1.0 on 9 October and stay as the record. Since then:

- **OpenPromises 0.3.0** (released 10 October) answers every question in §4. Who made the cost is `cost.by` inside each version's cost (decision 14; `costed_by` moves there, correction paths included). The engine has late fields like #67's (decision 13). Who must deliver is the core field `responsible`, and credit is `brought_about_by` (decision 14). Cost changes are feed entries with our ids. The 29 cost quality labels are filled in once after the conversion with no corrections, because the configuration keeps `legacy: "public-ledger"` (decision 15). `migrate` moves comments into fields and lists the ones it cannot place: 37 of 63 lines move, 10 are left for an editor (decision 16). Our intake keeps its own draft format until the engine's intake package (decision 17).
- **The OpenPromises dry run** against Public Ledger at `1bb4f81` and the live site finds nothing worse in any of its 12 areas; all 560 live feed entries are identical.
- **Steps 1 and 6 are prepared**: `openpromises.config.ts`, the engine's check in CI as a report that never blocks, and `docs/OPERATIONS.md` §15. On today's content the check reports 83 errors and nothing else: 54 cards without editors' approvals and 29 costs without a quality label. They land as soon as 0.3.0 is a day old (pnpm's minimum release age; no exclusions), from 09:07 BST on Sunday 11 October.
- **Pavel decided on 10 October** (§9): the owner's past approvals are not imported as an editor's, so every card needs two editors' reviews; and the conversion lands **after Tuesday 17 November 2026**, when the 30-day build series ends, not on 29 October or by 11 November.
- **What now sets the pace is the editors list**, kept private as the CI secret `OPENPROMISES_EDITORS` (decision 10). Until it has at least two people, no card can pass the approvals rule. The read-only list of past approvals is in the owner's notes (`engine/approvals-import-2026-10-10.md`): 15 cards have one approval, all from the owner's account; 39 have none.

## In short

- **Every card and actor converts to format v1.** OpenPromises' Public Ledger converter reads all 54 cards and 19 actors. Converted, they rewrite no history (the engine's append-only check finds nothing), and read back into Public Ledger's own shape they give the same data as today for all 73 files, apart from YAML comments (below).
- **One thing blocks validation today: `costed_by`.** #67 added it inside each version's cost (who made the central figure). Format v1 has no place for it, so the 29 costed cards fail the format check. It needs a change in OpenPromises (question 1).
- **Two more gaps once that is fixed, both already known:** no editors' approvals are recorded in any card (54 cards), and the 29 costs have no quality label. No pull request that changed a card has two approvals on GitHub, so importing past approvals (OpenPromises decision 11) gives at most one per card. Editors will need to review all 54 cards.
- **Two things would be lost silently:** `openpromises migrate` drops YAML comments (63 lines, including why each contract is linked), and the engine has no equivalent of #67's rule that lets a newly required field be filled in on published entries without a correction (`LATE_FIELDS`).
- **The site can stay exactly as it is.** Public Ledger keeps its own pages, API and feeds, and reads v1 files into its current internal shape. The parity check built for this move (`pnpm parity:snapshot` before, `pnpm parity:check` after; draft #69) proves the published output is unchanged, byte for byte.
- **Estimate:** about 4–5 working days in Public Ledger, plus 1–2 days of OpenPromises changes, plus about 14–27 editor-hours to review and approve the 54 cards. Converting the files should land by Wednesday 11 November, or else after AI Journalist goes public around 16 November.

## 1. What was run

Everything ran on copies in a scratch folder. Nothing was changed, committed or built in either repository.

1. Copied `content/promises/` and `content/actors/` from Public Ledger at `e7e924d`.
2. Configured the engine with its own Public Ledger configuration (`fixtures/public-ledger/openpromises.config.ts`), set to read the legacy format (`legacy: "public-ledger"`).
3. `openpromises validate --no-base` on the legacy files, converted as they were read.
4. On a second copy, moved each version's `costed_by` to a card-level field, so it lands in `x` and the remaining problems show. Ran `validate` again, then `openpromises migrate`, then `validate --base main` against the legacy copy committed as `main`.
5. Added a Public Ledger `x` schema to the configuration (§3.5) and checked that it catches a card with no `outcome_by`.
6. Read every converted file back into Public Ledger's own format with a small script, and compared it with the original as data (key order ignored).

## 2. Conversion report

### 2.1 Summary

| | Result |
|---|---|
| Cards read and converted | 54 of 54 |
| Actors read and converted | 19 of 19, all valid |
| Format check, cards as they are | 25 pass; **29 fail**: `versions[0].parameters.costed_by` is not a field of format v1 |
| All rules, with `costed_by` set aside | 0 cards fully valid; 83 problems of two kinds: 54 × no approvals in the card (`approvals`), 29 × cost without a quality label (`cost`) |
| Rules that pass on every card | `vocabulary`, `languages`, `headline`, `evidence`, `first-event`, `event-order`, `versions`, `status-event`, `scoreable`, `corrections` (every correction replays exactly), `quotes` (every version has `quote_checked_on`), `references`, `modules` |
| Append-only after `openpromises migrate` | 54 published cards compared with the legacy base: **no history changed** |
| Round trip, v1 back to Public Ledger's format | 73 of 73 files give the same data, apart from comments and one harmless detail (§2.4) |

### 2.2 Every card

"As converted" is the result today. "Left to do" is what remains once `costed_by` has a home in format v1 (question 1). Every card also needs two editors' approvals recorded in the card ("approvals").

`outcome_by` is who must deliver it, as of now (PROMISE_STANDARD §11). `costed_by` is who made the cost's central figure (§2).

| Card | Status | `outcome_by` | `costed_by` | As converted | Left to do |
|---|---|---|---|---|---|
| uk-abolish-non-dom-2024 | delivered | hm-government | official: HM Treasury | costed_by | quality, approvals |
| uk-awaabs-law-all-hazards-2027 | promised | hm-government | — | ok | approvals |
| uk-awaabs-law-hazards-2026 | in_plan | hm-government | official: Ministry of Housing, Communities and Local Government | costed_by | quality, approvals |
| uk-awaabs-law-private-renters-2026 | promised | hm-government | — | ok | approvals |
| uk-bics-electricity-2026 | in_plan | hm-government | official: Department for Business and Trade | costed_by | quality, approvals |
| uk-bus-cap-2-2026 | in_plan | hm-government | official: Department for Transport | costed_by | quality, approvals |
| uk-carried-interest-2024 | delivered | hm-government | official: HM Treasury | costed_by | quality, approvals |
| uk-child-nude-images-law-2026 | promised | hm-government | — | ok | approvals |
| uk-con-cheap-power-plan-2026 | promised | null | — | ok | approvals |
| uk-con-iht-family-home-2026 | promised | null | independent: Tax Policy Associates | costed_by | quality, approvals |
| uk-con-landlord-cgt-relief-2024 | promised | null | party: Conservative Party | costed_by | quality, approvals |
| uk-con-no-cgt-rise-2024 | promised | null | — | ok | approvals |
| uk-con-stamp-duty-abolition-2025 | promised | null | party: Conservative Party | costed_by | quality, approvals |
| uk-con-zev-mandate-abolition-2026 | promised | null | — | ok | approvals |
| uk-corp-tax-cap-25-2024 | legislated | hm-government | — | ok | approvals |
| uk-curriculum-proposals-2026 | promised | hm-government | — | ok | approvals |
| uk-defence-25-2027 | funded | hm-government | official: No 10 | costed_by | quality, approvals |
| uk-disabled-bus-pass-2026 | promised | hm-government | — | ok | approvals |
| uk-electricity-vat-2026 | delivered | hm-government | official: No 10 | costed_by | quality, approvals |
| uk-fiscal-rules-2026 | promised | hm-government | — | ok | approvals |
| uk-great-british-energy-2024 | delivering | hm-government | party: Labour Party | costed_by | quality, approvals |
| uk-green-bank-windfall-tax-2026 | promised | null | party: Green Party | costed_by | quality, approvals |
| uk-green-cgt-align-2024 | promised | null | party: Green Party | costed_by | quality, approvals |
| uk-green-wealth-tax-2024 | promised | null | party: Green Party | costed_by | quality, approvals |
| uk-homes-1-5m-2024 | delivering | hm-government | — | ok | approvals |
| uk-kings-series-nnr-2026 | delivering | natural-england | — | ok | approvals |
| uk-landlord-register-2026 | in_plan | hm-government | — | ok | approvals |
| uk-ld-cgt-reform-2024 | promised | null | party: Liberal Democrats | costed_by | quality, approvals |
| uk-ld-free-personal-care-2024 | promised | null | independent: Health Foundation | costed_by | quality, approvals |
| uk-ld-personal-allowance-15k-2026 | promised | null | party: Liberal Democrats | costed_by | quality, approvals |
| uk-mayors-16-19-budget-2026 | promised | hm-government | — | ok | approvals |
| uk-mayors-income-tax-2026 | promised | hm-government | — | ok | approvals |
| uk-mental-health-strategy-2026 | promised | hm-government | — | ok | approvals |
| uk-nato-5pc-2035-2025 | in_plan | hm-government | official: OBR | costed_by | quality, approvals |
| uk-neighbourhood-police-2024 | delivering | hm-government | party: Labour Party | costed_by | quality, approvals |
| uk-nhs-18-weeks-2024 | delivering | hm-government | — | ok | approvals |
| uk-nhs-40000-appointments-2024 | delivering | hm-government | party: Labour Party | costed_by | quality, approvals |
| uk-nhs-capital-1-5bn-2026 | in_plan | hm-government | — | ok | approvals |
| uk-no-tax-rise-working-people-2024 | in_plan | hm-government | — | ok | approvals |
| uk-plaid-cgt-equalise-2024 | promised | null | party: Plaid Cymru | costed_by | quality, approvals |
| uk-plaid-childcare-20-hours-2026 | in_plan | welsh-government | independent: IFS | costed_by | quality, approvals |
| uk-plaid-cost-of-living-2024 | unscoreable | null | — | ok | approvals |
| uk-pubs-business-rates-cut-2026 | promised | hm-government | official: No 10 | costed_by | quality, approvals |
| uk-reform-energy-bills-250-2026 | promised | null | party: Reform UK | costed_by | quality, approvals |
| uk-reform-personal-allowance-15k-2026 | promised | null | party: Reform UK | costed_by | quality, approvals |
| uk-send-inclusion-standards-2026 | promised | hm-government | — | ok | approvals |
| uk-snp-income-tax-bands-rates-2026 | promised | scottish-government | — | ok | approvals |
| uk-snp-two-child-cap-2024 | delivered | hm-government | official: HM Treasury | costed_by | quality, approvals |
| uk-socio-economic-duty-2026 | promised | hm-government | — | ok | approvals |
| uk-triple-lock-2030-2026 | promised | hm-government | — | ok | approvals |
| uk-two-child-limit-2025 | delivered | hm-government | official: HM Treasury | costed_by | quality, approvals |
| uk-union-learning-fund-2026 | promised | hm-government | official: HM Treasury | costed_by | quality, approvals |
| uk-vat-private-schools-2024 | delivered | hm-government | official: HM Treasury | costed_by | quality, approvals |
| uk-your-first-home-2026 | promised | hm-government | — | ok | approvals |

Totals: `outcome_by` is hm-government on 35 cards, null on 16, and natural-england, welsh-government and scottish-government on one each. `costed_by` is official on 13 cards, party on 13 and independent on 3. One card (uk-snp-two-child-cap-2024) also has `brought_about_by`.

### 2.3 Actors

All 19 convert and pass: andy-burnham, blair-mcdougall, bridget-phillipson, conservatives, green-party, hm-government, john-healey, keir-starmer, labour, liberal-democrats, lucy-powell, matthew-pennycook, natural-england, plaid-cymru, rachel-reeves, reform-uk, scottish-government, snp, welsh-government. `standing: government` becomes `in_power`. People take their standing from their party. scottish-government and welsh-government, added by #67, have no `standing`, which the engine accepts (see question 7).

### 2.4 What a round trip keeps and loses

Read back from v1 into Public Ledger's own format, all 54 cards and 19 actors give the same data as the originals: every field, every correction, every review and every contract link. Three things do not come back:

1. **YAML comments.** `migrate` writes files afresh, so comments go. Public Ledger has 9 comment lines in 3 cards, saying why each contract is linked (PROMISE_STANDARD §10.2 requires that link to be justified), and 54 in the 19 actor files (the source of each actor's description and when its official pages were checked). Question 5.
2. **An explicit `how_much_bn_per_year: null`** (14 cards) becomes an absent cost. Format v1's cost range cannot be null. No Public Ledger code tells the two apart, so nothing on the site changes.
3. **`costed_by`**, until format v1 has a place for it (question 1). In the test copy it was carried in `x` and came back intact, but `x` is not the right home (§3.2).

## 3. Field mapping

"Home" says where each field goes: **v1** is a field of format v1, **module** is module data under `links`, **x** is the site's own fields (validated by our own schema, editable, not part of history), and **change** means OpenPromises needs to change.

### 3.1 The card

| Public Ledger | Format v1 | Home | Notes |
|---|---|---|---|
| (none) | `format: openpromises/1` | v1 | Added by `migrate`. |
| `id`, `actor_id`, `made_on`, `venue`, `origin`, `sources` | the same | v1 | |
| `headline`, `venue_label`, `status_note` | `{ en: … }` | v1 | |
| `policy_area` | `area` | v1 | The ten areas, their labels and their published URL slugs go in the configuration, so `/promises/area/…` addresses stay the same. |
| `status` | `status` | v1 | `national` ladder. The engine's default labels are already "Not met" and "Undone". |
| `deadline` (on the card) | `versions[last].parameters.deadline` | v1 | Decision 3. Every card has one version, so nothing moves in time. From then on, a moved deadline is a new version (or a correction if we got it wrong), not an edit. |
| `lever_settings`, `preset_label` | `links.lever: { settings, label: { en } }` | module | `lever` module. |
| `contracts` | `links.contracts` | module | `contracts` module. The comments explaining each link are lost (question 5). |
| `outcome_by` (who must deliver: required, an actor id or null, of kind government) | `x.outcome_by` | x, or change | The converter puts it in `x`, and an `x` schema can require it (§3.5). The rule that it names a government or public body needs the actors list, so it stays in Public Ledger's own check unless OpenPromises takes the field (question 4). |
| `brought_about_by` (credit when someone else did it) | `x.brought_about_by` | x | Lands in `x` through the converter's pass-through. Its rule (only once a card is legislated or later) stays in Public Ledger's own check. |
| `submission_ref`, `credit` | `x.submission_ref`, `x.credit` | x | |
| `editor_check_required` | `x.editor_check_required` | x | Superseded by approvals in the card. Keep it until every card has its approvals, then drop it. |

### 3.2 Versions and costs

| Public Ledger | Format v1 | Home | Notes |
|---|---|---|---|
| `version`, `text`, `recorded_on`, `source_url`, `archived_url`, `quote_checked_on` | the same | v1 | |
| `parameters.who`, `when`, `funded_by` | `{ en: … }`; `funded_by: null` stays null | v1 | |
| `parameters.how_much_bn_per_year` | `parameters.cost.range` | v1 | The unit (£bn a year) moves into the configuration. An explicit null becomes absent (§2.4). |
| `parameters.cost_note`, `cost_sources` | `parameters.cost.note.en`, `parameters.cost.sources` | v1 | |
| `parameters.costed_by` | **none** | change | Format v1 refuses it. It cannot go in `x`: `x` belongs to the card, not the version, so it would leave history (the append-only check ignores `x`), and Budget-day corrections (`versions[0].parameters.costed_by`) could not point at it. Question 1. |
| (none) | `parameters.cost.quality` | change | Required by v1 with a range. Public Ledger's API works it out today: `sourced` when a cost has sources, otherwise `approx`, which makes all 29 `sourced`. Adding it to published versions needs question 2. |

### 3.3 History

| Public Ledger | Format v1 | Home | Notes |
|---|---|---|---|
| `events[]` | the same, `text` as `{ en }` | v1 | Future `deadline` markers are allowed out of date order. |
| `replies[]` | the same, `editor_response` as `{ en }` | v1 | None published yet. |
| `corrections[]` | the same; paths and values follow the fields (`.parameters.how_much_bn_per_year` → `.parameters.cost.range`); text values and `reason` become `{ en }` | v1 | All 38 corrections convert and replay. The API publishes `corrections[].path`, `was` and `now`, so the site must map them back (§5, step 2) to keep API output unchanged. |
| `reviews[]` | the same, `note` as `{ en }` | v1 | The automated reviews stay `kind: automated`, which never approves. |
| GitHub pull request approvals | `reviews[]` with `kind: editor, approves: true` | v1 | Decision 4. None are in the cards today (§5, step 5). |
| `LATE_FIELDS` (#67: a newly required field may be filled in once on a published entry without a correction) | **none** | change | Question 2. |

### 3.4 Actors

| Public Ledger | Format v1 | Home |
|---|---|---|
| `name`, `short_name`, `roles[].title` | `{ en: … }` | v1 |
| `kind`, `party_id`, `same_as` | the same | v1 |
| `standing`: government, opposition, public_body | in_power, opposition, public_body | v1 |
| `parliament_member_id`, `parliament_party_id` | `identifiers.…` | v1 |
| Comments (sources, dates checked) | none | change (question 5) |

### 3.5 Public Ledger's `x` schema

Tested in the scratch run. It catches a card with no `outcome_by` (`x.outcome_by: is required`):

```ts
x: {
  card: z.strictObject({
    outcome_by: z.strictObject({ actor_id: z.string(), note: z.string().optional() }).nullable(),
    brought_about_by: z.strictObject({ actor_id: z.string(), note: z.string().optional() }).optional(),
    submission_ref: z.string().regex(/^S-\d{4}-\d{2}-\d{4}$/).optional(),
    credit: z.string().min(1).max(40).optional(),
    editor_check_required: z.boolean().optional(),
  }),
},
```

### 3.6 Processes

| Public Ledger | With OpenPromises | Home |
|---|---|---|
| Two editors = two GitHub approvals, or the owner's merge | Two `kind: editor` approvals in the card, checked against an editors list kept private (decision 10), with the party check in code | v1 |
| `scripts/deadlines.ts` appends `deadline_missed` | `openpromises deadlines`, with `deadlines.text` set to our current wording so feeds and the API read the same | v1 |
| Intake drafts: `content/drafts/<date>/<id>.yaml`, their own format, sources beside them, every draft resolved before merge | Drafts are full cards in `content/drafts/<id>.yaml` with `source_text` spans into `content/sources/` (decision 5) | change (question 6) |
| Reader submissions: a skeleton card full of TODOs written to `content/promises/` in the pull request; evidence appended to an existing card | A new promise becomes a v1 draft; evidence stays an appended event (with `text: { en }`) | Public Ledger change |
| Feeds and open data built by Public Ledger | `@openpromises/publish` has event, rewording and reply entries with the same ids, but none of ours for cost changes, contracts, data editions or deadline windows | change (question 7) |

## 4. Questions for the OpenPromises session

For Pavel to pass on. Each is a change to OpenPromises, not to Public Ledger, and each has a recommendation.

1. **A home for `costed_by`.** Add `costed_by: { kind: official | party | independent, name }` to the cost in core. Have `fromPublicLedger` move `parameters.costed_by` into `parameters.cost.costed_by`, correction paths included, and add an optional setting to require it on every cost with a range. *Recommended* because it describes the figure, so it belongs in the version's history next to the range, where corrections can reach it. Keeping Public Ledger's name means the API and AI Journalist need no renaming. Any site can use it; Borough Book and the bilingual site cost promises too.
2. **Late fields in the append-only check.** Let the configuration list fields that may be filled in once on a published entry that never had them, without a correction, as Public Ledger's `LATE_FIELDS` does since #67. Once filled, a change is a correction as usual. *Recommended* because without it, adding the 29 quality labels (and any future standard field) to published versions would mean 29 public "corrections" for errors nobody made. Without it, the check would also reject the next field the standard adds.
3. **Quality labels on Public Ledger's costs.** With question 2 in place, editors add `quality` to the 29 costs after the conversion, starting from what the API shows today (`sourced` on all 29) and changing any that an editor finds should be `approx` or `modelled`. *Recommended* over making the converter work labels out, because the converter rightly never invents a value. Starting from the published label means readers see no change unless an editor decides otherwise.
4. **`outcome_by` (who must deliver), in core or in `x`.** It works in `x` today, and an `x` schema can require it. The rule that it names a government or public body needs the actors list, which `x` schemas cannot see. *Recommended:* an optional core field with a configured list of allowed actor kinds, because AI Journalist uses the same idea on Borough Book (its administration's pledges), and one rule keeps one standard. If OpenPromises prefers to keep it site-only, Public Ledger keeps the kind check in its own script, which works. Either way, `docs/COMPARISON.md` still describes the old meaning ("only one card"), and `fromPublicLedger` should list `brought_about_by` by name instead of passing it through.
5. **Keep YAML comments when migrating.** Edit the parsed YAML document in place rather than writing the data out afresh, so comments survive. *Recommended* because Public Ledger's comments carry editorial reasons (why a contract is linked, where an actor's description comes from) that format v1 has no field for. Losing them would quietly undo checks editors have done. Otherwise, give contract links a `note` and actors a documented place for sources.
6. **Drafts.** The engine reads only files directly in `drafts/`, so Public Ledger's dated draft folders are ignored rather than checked. In format v1 a draft needs an `actor_id` and an `area`, which an intake draft may not have yet: the speaker may be unknown, and the area is only suggested. Fields like `speaker.check`, `suggested`, `why`, `confidence` and `model`, and evidence for an existing card, have no v1 form. *Recommended:* Public Ledger keeps its own draft format and its exact-quote check until the intake package is extracted (RFC step E4), and the engine confirms that ignoring subfolders is intended.
7. **Smaller points.** (a) FORMAT.md §11 says `standing` is required with `standing: manual`, but the engine does not check it; the two devolved governments have none. Either check it or reword the doc. (b) `@openpromises/publish` lacks Public Ledger's cost-change, contract, edition and deadline-window entries. Until it has them, Public Ledger keeps its own feeds (§5, step 8), so nothing is needed now. (c) The engine needs Node 22.18 or later for a TypeScript configuration. Public Ledger's CI runs 22.22, but its `engines` field still allows 22.12.

## 5. The plan, step by step

The principle: **the files move, the site does not.** Public Ledger keeps `PromiseFile` and `CardView` as its internal shape and reads format v1 into them. Every page, feed, email, API response and share card is then built by the same code as today. OpenPromises takes over the checks first; pages move onto `@openpromises/react` later, and only where they render the same.

**Before 29 October (no Public Ledger change).** The parity check (#69) is merged. Pavel passes on the questions in §4. OpenPromises answers them in a release (0.1.x). On 29 October we re-run §1 on the cards as they stand after Budget day, because Budget-day corrections will have changed some costs and `costed_by` values.

**Step 1: configuration and a check that reports (half a day).** Add `openpromises.config.ts` (the engine's fixture configuration plus the `x` schema in §3.5, `deadlines.text`, `legacy: "public-ledger"`). Add `@openpromises/core`, `files` and `cli` as pinned development dependencies only; the site's runtime needs none of them. In CI, run `openpromises validate` with the private editors list from a secret (decision 10). It runs as a step that reports without blocking (`continue-on-error: true`), next to `pnpm validate`.

**Step 2: a reader for both formats (1½ days).**
- In `packages/schema`, add a pure reader that turns a v1 card or actor into today's `PromiseFile` / `ActorFile`: language maps back to strings, `cost.*` back to `how_much_bn_per_year` / `cost_note` / `cost_sources` / `costed_by`, the current version's `deadline` back onto the card, `links` and `x` back to their fields, and correction paths and values back to their legacy form. Legacy files pass through unchanged, so the site reads either format. It is the inverse of `fromPublicLedger`, and the scratch round trip (§2.4) shows it is exact.
- Route every reader through it: `content-files.ts` / `seed.ts` (all pages and the API), `alerts/content.ts` `parseCard` (alerts compare cards across commits, including across the conversion commit), `harvest/drafts.ts` (the index of quotes already on cards), and `etl/contracts.py` (reads `links.contracts` as well as `contracts`).
- Record the "before" output with `pnpm parity:snapshot` on the commit the migration branch starts from (§6). Not a later `main`: a newer nightly `data/build` shows up as differences. After rebasing the branch, take the baseline again from its new starting commit.

**Step 3: writers and examples (1 day).** `scripts/deadlines.ts` switches to `openpromises deadlines` or writes `text: { en }`. Triage writes new promises as v1 drafts and evidence events as v1 events. Update the drafts and fields described in `content/README.md`, and the YAML examples in `docs/EDITORS.md`, `docs/BUDGET_DAY.md` (ready-made entries), `PROMISE_STANDARD.md` §9 (correction paths become `versions[0].parameters.cost.range`) and `docs/DATA_MODEL.md`.

**Step 4: the conversion pull request (half a day, plus two editors' review).** `openpromises migrate` and nothing else, as MIGRATING.md says. In this pull request:
- `openpromises validate --base origin/main` must report no history change.
- `pnpm validate`'s own append-only check would compare legacy YAML on `main` with v1 YAML here and fail. So in step 2 it reads both sides through the reader (or hands this check to the engine) before comparing.
- `pnpm parity:check` (§6) must pass against that baseline: no difference. Its `.parity/report.txt` goes in the pull request.
- The alerts test must show no change between the last legacy commit and the converted one, so no follower gets an email, Telegram message or feed entry about the conversion.

**Step 5: approvals in the cards (editor time; runs alongside).** No pull request that changed a card has two approvals on GitHub; three have one, from the owner's account on intake pull requests. Under decision 11, approvals are imported only from people on the editors list. Whether the owner counts as an editor here is Pavel's call (§9). Either way, every card needs at least one more editor review, recorded with `openpromises review`. The engine's `approvals` rule stays non-blocking until all 54 cards pass. Until then Public Ledger's present merge rule (two GitHub approvals, or the owner) still guards what gets published.

**Step 6: quality labels (after question 2).** Editors add `quality` to the 29 costs, starting from today's published `sourced` (question 3). The API then reads the label from the card instead of working it out. `pnpm parity:check` shows no change unless an editor changed a label.

**Step 7: switch over (half to one day).** When `openpromises validate` passes, make it blocking and remove `legacy` from the configuration. Remove from `scripts/validate.ts` what the engine now covers: the card schema, the append-only check for cards and the reference checks. `pnpm validate` keeps what is ours: the balance check, the "no data in components" lint, share images, contracts and forecasts append-only, the intake drafts' quote check, and Public Ledger's own rules (`outcome_by` names a government body, `brought_about_by` only once something has happened, `costed_by` goes with every cost, if OpenPromises does not take these). The intake merge job counts approvals in the card instead of GitHub reviews. GitHub reviews stay for discussion.

**Step 8: pages (RFC step E2, later).** Move promise pages onto `@openpromises/react` only where they render the same. The parity check covers each route type's title, meta and share tags, not whole pages (build hashes and markup change with every build), so pages are compared with screenshots before and after (§6, point 5). Keep Public Ledger's feeds, API, Markdown, JSON-LD and `llms.txt` code reading the same `CardView` until `@openpromises/publish` produces the same output, including ids. Feed entry ids already match for events, rewordings and replies (`tag:ledgergov.uk,2026:promise/<id>/event/<n>`). Cost, contract, edition and deadline-window entries exist only in Public Ledger's code.

### What stays the same, area by area

| Area | How it stays the same |
|---|---|
| Schema (`packages/schema`) | `PromiseFile` and `CardView` stay the internal shape; v1 is read into them. Existing schema tests keep running; reader tests are added. |
| `scripts/validate.ts` and the append-only check | Reads both sides through the reader during the move (step 4), then hands card history to the engine (step 7). Invariant 5 is checked throughout. |
| Intake and harvest | Draft format and exact-quote check unchanged until E4 (question 6). The quote index reads cards through the reader. |
| Triage | Writes v1 drafts and v1 events (step 3). Model suggestions stay as comments in drafts, which editors remove. |
| API v1 | Same code over the same `CardView`, so the same JSON and CSV, field for field, including `corrections[].path`, `cost.quality` and `cost.costed_by`. Proved by `pnpm parity:check`. |
| Feeds and alerts | Same code and the same `tag:` ids. The conversion commit produces no alert (step 4). |
| SEO and sharing | Markdown, JSON-LD, `llms.txt`, sitemap, `robots.txt`, page titles, descriptions, canonical URLs, Open Graph and Twitter tags, and area URLs come from the same code and configuration. Proved by `pnpm parity:check`. |
| ETL | `etl/contracts.py` reads `links.contracts`. Nothing else in `etl/` reads cards. |
| Tests | Add: reader round trip on every card, alerts across the conversion commit. Run `pnpm parity:check` on each migration pull request (steps 4, 6 and 7). Server tests keep their legacy-format fixtures, which the reader still accepts. |

## 6. Proving the site is the same

1. **Data.** A test reads every card and actor in v1 back into Public Ledger's shape and compares it with the legacy file at the base commit (as in §2.4). Any difference fails.
2. **Output.** The parity check (`scripts/parity.ts`, draft #69, documented in `docs/OPERATIONS.md` §14). `pnpm parity:snapshot`, on the commit the migration branch starts from, builds the site for production, serves it locally and writes `.parity/baseline`. `pnpm parity:check` on the branch does the same into `.parity/current`, prints a diff grouped by file (also in `.parity/report.txt`) and fails on any difference. It compares, byte for byte with status code and content type: every `/api/v1` endpoint as JSON and CSV, every feed (all, updates, deadlines, one per area, actor and promise), `sitemap.xml`, `robots.txt`, `llms.txt`, `llms-full.txt` and every card's Markdown. For every sitemap page, every actor page and each route type, it also compares the page metadata: title, description, canonical, robots, alternates, Open Graph, Twitter tags and JSON-LD. Both builds pin the site address, turn the alpha gate off and fix the clock at the baseline moment. Only the API's `data_build` stamp and the MP pages' `dateModified` are normalised; MP pages are a sample of three because they call UK Parliament's live API. Whole-page HTML is left out, because build hashes and markup change with every build: point 5 covers pages.
3. **History.** `openpromises validate --base origin/main` reports no history change, and `pnpm validate` agrees.
4. **Alerts.** Comparing the last legacy commit with the converted one finds no change, so no email, Telegram message or feed entry goes out.
5. **Pages, by eye.** Screenshots of one page per route type, at 375px wide and at desktop width, before and after, compared side by side. Include a costed card and a card with corrections among the promise pages. This replaces an HTML diff, which build hashes would make noisy.

## 7. Rollback

- **Before the conversion pull request merges:** nothing to undo. Steps 1–3 only add a reader that accepts both formats and a check that reports.
- **After it merges, before any card is edited in v1:** revert the merge commit. The reader accepts the legacy files again, and the history check passes because the files return to exactly what was published.
- **After cards have been edited in v1:** convert back with the reader (the inverse of `fromPublicLedger`; exact apart from comments, §2.4) in a pull request of its own. Keep the reader and a `to-legacy` script in the repository until the engine's check has been blocking for a month.
- **Feeds, API and alerts** never depended on the file format, so rollback cannot change a feed id or an API field.

## 8. Estimate and timing

| Work | Who | Time |
|---|---|---|
| Questions 1, 2, 4 and 5 in OpenPromises, released | OpenPromises session | 1–2 days |
| Steps 1–4 and 7 in Public Ledger (the parity check is built separately) | Public Ledger | about 4–5 working days |
| Reviewing the conversion pull request | Two editors | about 1 hour each |
| Approvals: about 15 minutes per card, per editor, 54 cards, at least one review each (two if the owner's approvals are not imported) | Editors | about 14–27 editor-hours |
| Quality labels on 29 costs | Editors, as part of the same review | included above |
| Pages on `@openpromises/react` (E2) | Public Ledger | 3–5 days, later |

**Timing.** Start Thursday 29 October; code and the conversion pull request ready around Friday 6 November. AI Journalist goes public around Monday 16 November and reads `/api/v1/promises`. The API is designed to stay identical, but a surprise in launch week would cost more than a few days' wait. So merge the conversion by **Wednesday 11 November**, or else after AI Journalist has gone public. Approvals continue after the conversion, and the engine's approvals rule becomes blocking once all 54 cards pass, likely late November.

## 9. Decisions for Pavel

These are Public Ledger's to make, not OpenPromises':

1. **Decided 10 October: no.** *Is the owner on the editors list for importing past approvals?* If yes, three intake pull requests give one imported approval to the cards they published, and those cards need one more editor review. If no, every card needs two. Recommended: no. Those three approvals are the owner's, on intake pull requests the owner then merged. The editors' guide keeps the two roles apart (editors approve, the owner merges), and counting them would make the person who publishes one of the two who check.
2. **Decided 10 October: after Tuesday 17 November 2026,** when the 30-day build series ends. *When the conversion lands:* the options were by Wednesday 11 November, or after AI Journalist's launch (§8).
3. **Editors' time:** about 14–27 hours across the editors in November for the approvals and quality labels.
