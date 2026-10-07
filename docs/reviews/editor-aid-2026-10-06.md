# Second check of the 21 promise cards, 6 October 2026

**What this is:** an automated editor aid. Three independent checkers re-read every card against its live sources and tried to find what is wrong with it. They worked to [the brief below](#method).

**What this is not:** the two-editor review (invariant 8) or a legal review. Both are still needed before any card is public. This document is meant to make that work faster.

Full per-card reports, with every source the checkers read:
- [group 1: Labour manifesto](editor-aid-2026-10-06/group-1.md)
- [group 2: government](editor-aid-2026-10-06/group-2.md)
- [group 3: opposition](editor-aid-2026-10-06/group-3.md)

## Headline

| Check | Result |
|---|---|
| Quotes are word for word at the cited source | **21 of 21** |
| `made_on` date and venue are correct | **21 of 21** |
| Evidence links support their events | 17 of 21 (4 small fixes) |
| Status is the best-supported stage | 15 of 21 clear; 6 need an editor decision or a better note |
| Cost and funding match the sources | 13 of 21; **3 cost ranges are time profiles, not uncertainty**, and 1 is too narrow |
| Neutral wording | 18 of 21 (3 small wording fixes) |
| Legal risk (a named person could read it as an accusation of bad faith or a false statement) | **0 flagged**. A lawyer should still read the cards that name people. |

## A. Corrections to notes and sources (safe to apply; not history)

These change `status_note`, `cost_note`, `who`, `funded_by` or source titles. None of these fields is append-only. Each comes with the checker's source.

| Card | Correction |
|---|---|
| uk-no-tax-rise-working-people-2024 | Budget 2025 said headline rates were not increasing (para 2.27); it did not restate the "working people" commitment. Dividend ordinary and upper rates rise 2 points from April 2026, savings and property from April 2027 (FA 2026 ss.4, 5, 7). The dividend additional rate is unchanged. |
| uk-vat-private-schools-2024 | Court case is out of date. The Court of Appeal dismissed the appeal on 27 Feb 2026. The Supreme Court gave permission on 22 May 2026, with a hearing listed for 1–2 Dec 2026. Add the three judgment/case sources. |
| uk-nhs-40000-appointments-2024 | cost_note mixes years. The £1.8bn is 2024-25 money, "since July", and is not part of the 2025-26 £22.6bn rise. The 3.6m appointments are for the first eight months. |
| uk-great-british-energy-2024 | Annual report published 14 Sep 2026, not 30 Sep. The source titles also carry the wrong date. |
| uk-neighbourhood-police-2024 | Add the same release's falls: officers −566 FTE, PCSOs −55 FTE, specials −324 headcount. The neighbourhood measure counts trainees and leaves out specials. |
| uk-nato-5pc-2035-2025 | The 3.5%/1.5% split is in No 10's 23 Jun 2025 release, not the NSS or the DIP. The IFS £36bn is measured from 2024 spending, so it overlaps the 2027 defence card. Source date: 23 Jun, not 24 Jun. |
| uk-nhs-18-weeks-2024 | "patients" should be "waiting-list pathways (cases)". Replace "still well short of 92%" with the gap in percentage points. |
| uk-electricity-vat-2026 | Northern Ireland gets "comparable" funding, not "equivalent". `who` should include non-VAT-registered small businesses that qualify for domestic energy VAT relief. |
| uk-defence-25-2027 | The status_note reason belongs to Delivered, not Delivering. Reword it to say what moves the card to each stage. |
| uk-con-stamp-duty-abolition-2025 | "today's prices" should be "current cost". funded_by should read "tax cuts and pro-growth measures". |
| uk-reform-personal-allowance-15k-2026 | funded_by: the £52bn and £7bn savings are "by the end of the next Parliament". |
| uk-ld-free-personal-care-2024 | status_note: on 29 Sep 2026 PM Andy Burnham promised free personal care for over-65s in the next parliament, with no plan, law or funding yet, so the card stays at Promised. |
| uk-green-wealth-tax-2024 | Attribute "highly uncertain" to its source. Add the party's own £14bn breakdown. |
| uk-snp-two-child-cap-2024 | Cost source is Table 4.1 line 6, not 2.1. Add DWP's 8 Jul 2026 statistics as a source for the 6 April date. |
| uk-two-child-limit-2025 | funded_by: "our welfare system", as said. Add the readable Hansard link. |
| uk-plaid-cost-of-living-2024 | "names no measure" → "names no specific measure". |
| Optional | homes £39bn timing; bus cap's £3 cap already funded to March 2027; private schools 2027-28 figures. |

## B. Corrections to history (need the correction mechanism)

Versions and events are append-only (invariant 5). A wrong fact in them must be corrected *visibly*: a dated correction note on the card ("Corrected on …: was X, now Y, because Z"), as newspapers do. The fact must never be quietly overwritten.

| Card | What is wrong | Proposed correction |
|---|---|---|
| uk-con-stamp-duty-abolition-2025 | Cost `[4.5, 9.0, 9.0]` mixes current-year and 2029-30 costs (a time profile) | `[8.1, 9.0, 9.9]`: the party's 2029-30 figure ±10% editorial |
| uk-reform-personal-allowance-15k-2026 | Cost `[17.7, 17.7, 21.1]` is year 1 to year 5 | `[19.0, 21.1, 23.2]`: year-five figure ±10%, matching the steady-year rule on other cards |
| uk-ld-free-personal-care-2024 | High `7.0` is the 2035/36 figure | `[2.7, 6.0, 6.6]`: the Health Foundation's 2026/27 £6bn +10% as the high |
| uk-green-wealth-tax-2024 | Central equals high; the party's own £14bn is missing | `[-16.0, -15.0, -14.0]`: all three are party figures |
| uk-great-british-energy-2024 | Annual report event dated 30 Sep 2026 | 14 Sep 2026 |
| uk-nhs-40000-appointments-2024 | Event omits "in its first eight months" | Add the qualifier |
| uk-neighbourhood-police-2024 | SR25 event omits the base period | "from 2023-24 to 2028-29" |

## C. Decisions for editors (judgement, not error)

1. **Rate-hold pledges need one rule.** The corporation tax card is Legislated because Finance Acts set the rate. Finance Acts 2025 and 2026 also set the income tax rates, yet the "no tax rises on working people" card is In plan. Either move it to Legislated, or write down why its wider scope keeps it lower.
2. **Great British Energy:** the quote promises to *create* the company, which is done, so the card would read as Delivered. The £8.3bn capitalisation that makes it Delivering is on the same page but outside the quote. The Spending Review also now counts the £8.3bn across GBE and GBE–Nuclear, which may be a rewording under §4.
3. **Defence 2.5% by 2027:** Funded, or Delivering? The 2026-27 budget is planned at 2.6% and money is flowing.
4. **Electricity VAT** is zero-rated until 31 Mar 2027. Is a time-limited measure in force Delivered, or Delivering until it ends?
5. **End-of-Parliament date:** ten deadlines use 2029-07-01 (editorial). The latest possible automatic dissolution is 9 Jul 2029. Either move the date, or say "before the latest possible dissolution".
6. **Balance:** Plaid Cymru's only card is the set's only unscoreable card. Add a concrete Plaid card before launch, e.g. the £4bn HS2 consequentials (manifesto p.3).
7. **New card?** PM Andy Burnham's 29 Sep 2026 pledge of free personal care for over-65s.

## Method

Each checker read `docs/PROMISE_STANDARD.md`, then for each card:
- fetched the cited source fresh (PDFs hash-checked, GOV.UK through its content API, Hansard through its API where the site blocks scripts);
- marked seven checks PASS or FLAG: quote, date and venue, evidence, status, cost and funding, neutrality, legal risk.

Checkers could not edit the repository. One checker ran a single read-only `git log`. BBC pages could not be fetched; claims sourced there were cross-checked against CIOT, LBC and local press.
