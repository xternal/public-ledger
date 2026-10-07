# Junior Editor check: intake 9 September 2026 (11 cards, 3 actors)

Checked on 7 October 2026 (evening, BST) in `wt-intake-0909` (branch `intake-0909-resolve`). Every source was fetched fresh:

- GOV.UK pages: through the GOV.UK content API.
- Hansard: in the browser pane, with whitespace and curly quotes normalised.
- HCWS322: through the Parliament written-statements API.
- legislation.gov.uk: XML data pages.
- SI progress: the Parliament statutory instruments API.
- Members: the Parliament members API.
- Conservative and FleetPoint pages: fetched directly.
- PDFs and spreadsheets: downloaded and read. These were the BICS government response (April 2026), the final BICS impact assessment, the Estates Safety Fund ODS and the curriculum government response.

After the edits, `pnpm validate -- --allow-drafts` shows **0 errors** (78 warnings, all "draft awaiting editors" or "needs editor check").

Every quote matched its source word for word. No card's `status` was changed and no card was removed.

---

## 1. uk-mayors-16-19-budget-2026 (Lucy Powell)

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Exact match in Hansard. It comes from Lucy Powell's oral statement as Secretary of State for Education (1.44pm, 9 Sep 2026). |
| 2 | Date and venue | PASS | 9 Sep 2026, Commons oral statement. |
| 3 | Evidence | PASS | Only a `promised` event. Source titles and dates are right: Cabinet Office 31 Jul, No 10 30 Jul (22:30 BST), and DfE 10 Sep (00:01 BST). |
| 4 | Status | FLAG | `promised` is defensible. But the Rewiring the State Cabinet Statement (31 Jul 2026) already lists "control of the budget for 16- to 19-year-olds" among the agreed reforms. Under §3 that could support `in_plan`. The card also meets the §2 unscoreable test literally: no cost and no date. |
| 5 | Cost and funding | PASS | `how_much_bn_per_year` is rightly absent, because the pledge transfers control and no figure is given. "billions of pounds of funding for 16 to 19-year-olds" is quoted exactly from DfE. `funded_by: null` is right. |
| 6 | Neutrality | PASS | |
| 7 | Legal risk | PASS | |

**Fixed:** nothing.

**For editors:**
- Status: decide `promised` or `in_plan` (on the Rewiring the State statement), and whether the §2 unscoreable test applies (see the cross-card note).
- A GOV.UK search found no devolution white paper published by 7 Oct 2026. Update `when` once it sets the timetable.

## 2. uk-send-inclusion-standards-2026 (Lucy Powell)

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Exact match. It comes from Lucy Powell's answer to Adam Dance in the same statement. |
| 2 | Date and venue | PASS | |
| 3 | Evidence | PASS | No evidence events. The status note's "in due course" is accurate: "We will introduce legislation and set out our response to the consultation in due course." |
| 4 | Status | FLAG (higher) | The schools white paper (23 Feb 2026) names the National Inclusion Standards, puts up to £15m into them by 2028, and says "By 2028, the National Inclusion Standards should guide how schools are meeting the needs of children." A white paper naming the policy is `in_plan` evidence under §3. |
| 5 | Cost and funding | PASS | The £15m is a multi-year total "by 2028", so it is rightly not used as a yearly figure. |
| 6 | Neutrality | PASS | |
| 7 | Legal risk | PASS | |

**Fixed:** nothing.

**For editors:**
- Status: decide whether to move to `in_plan`. The white paper predates the promise, so an `in_plan` event could be dated 9 Sep 2026, citing the white paper.
- Deadline: consider an editorial deadline from the white paper's "by 2028".

## 3. uk-curriculum-proposals-2026 (Lucy Powell)

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Exact match, from the opening statement. |
| 2 | Date and venue | PASS | |
| 3 | Evidence | PASS | The final report and the government response were both published on 5 Nov 2025, as the status note says. |
| 4 | Status | FLAG | `promised` is fine. But the Nov 2025 government response (an official plan) says DfE will consult on new programmes of study and "aim to publish the final revised national curriculum by spring 2027", for first teaching from Sep 2028. So a "when" can be inferred from official documents, and `in_plan` is arguable. |
| 5 | Cost and funding | PASS | No costing; `funded_by: null`. |
| 6 | Neutrality | PASS | |
| 7 | Legal risk | PASS | |

**Fixed:** nothing.

**For editors:**
- Status note: consider adding the spring 2027 timeline from the government response (PDF page section "publish the final revised national curriculum by spring 2027").
- Related item: on 23 Sep 2026 DfE announced new Vocational GCSEs, with a consultation "later in the year". The release does not present this as the promised proposals, so I did not record it as delivery.

## 4. uk-child-nude-images-law-2026 (HM Government)

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Exact match in the DCMS press release (published 9 Sep 2026, 13:42 BST). |
| 2 | Date and venue | FLAG | Right for the quoted release. But Lisa Nandy's oral statement to the Commons on **8 Sep 2026** already said "the government is today committing to introducing primary legislation to require major tech platforms to build in device-level protections for children" (GOV.UK, /government/speeches/lisa-nandys-statement-on-protecting-children-online). |
| 3 | Evidence | PASS | |
| 4 | Status | PASS | `promised`. It meets the §2 unscoreable test literally ("as soon as possible", no cost). |
| 5 | Cost and funding | PASS | |
| 6 | Neutrality | PASS | The "world's strongest" claim appears only in the source title. |
| 7 | Legal risk | PASS | Apple and Google are not named in the card. |

**Fixed:** nothing.

**For editors:**
- Decide whether to keep 9 Sep (the press release) or re-base the card on the 8 Sep Commons statement. That would mean `made_on` 2026-09-08, venue `parliament`, and possibly a new `lisa-nandy` actor.
- At minimum, mention the 8 Sep statement in the status note.

## 5. uk-nhs-capital-1-5bn-2026 (HM Government)

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Exact match in the DHSC release (9 Sep 2026). |
| 2 | Date and venue | PASS | |
| 3 | Evidence | FLAG, fixed | The 11 Sep ESF publication (updated 16 Sep) gives totals **by trust**: 169 trusts, 966 schemes, £1,305.21m in total (my sum of the ODS). It does not itemise the 10 major projects. For example, Bristol Royal Infirmary shows £8.5m against £41m in the release, and Wycombe, St George's Stafford and the John Howard Centre are not listed. The status note and the `in_plan` event implied the list covered everything. |
| 4 | Status | FLAG | `in_plan` is defensible. You could argue `funded`, because the ESF sits within the SR2025 health capital budget and allocations are published. But that only covers the roughly £1.3bn part; the £200m of major projects has no published allocation. |
| 5 | Cost and funding | PASS | `null` is right, because allocations span 2026-27 to 2029-30. "Equivalent to £750 million per year over 9 years" is quoted correctly. |
| 6 | Neutrality | FLAG, fixed | `funded_by` stated "record capital budget" in the card's own voice. |
| 7 | Legal risk | PASS | |

**Fixed:**
- `status_note`: now says the list gives about £1.3bn for more than 950 schemes as totals by trust, so the 10 major projects named in the release cannot be matched to it. Source: ESF page and ODS.
- `events[1].text`: now "about £1.3bn for more than 950 schemes, given as totals by NHS trust rather than by project".
- `funded_by`: the "record" claim is now attributed to DHSC in quotation marks, matching how party claims are attributed on the Conservative cards.

**For editors:** decide between `in_plan` and `funded`.

## 6. uk-landlord-register-2026 (HM Government)

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Exact match in the MHCLG release (9 Sep 2026). |
| 2 | Date and venue | PASS | |
| 3 | Evidence | PASS | The draft regulations were laid 9 Sep 2026 in both Houses (draft affirmative, not yet made, per the SI tracker). Regional dates run from 15 Dec 2026 (West Midlands) to 15 Aug 2027 (South West), as the event says. RRA 2025 s.75 is "Prospective", so not in force. |
| 4 | Status | PASS | `in_plan`. The Act has passed, but the duty it creates is not in force and the dated regulations are only in draft. |
| 5 | Cost and funding | FLAG, fixed | The fee description was loose. Under the draft regulations, the fee is for making or renewing (every 12 months) each dwelling entry, and in some cases for reactivating one: regs 6(5), 10(2), 12(5) and 14. |
| 6 | Neutrality | FLAG, fixed | "spot rogue landlords" appeared in the card's own voice. |
| 7 | Legal risk | PASS | |

**Fixed:**
- `cost_note`: fee wording made precise.
- `who`: the purpose is now attributed to the government in quotation marks.
- Added a `deadline` event for 2027-11-14. Every existing card with a `deadline` has one; this card did not.

**For editors:** consider moving to `legislated` once the regulations are approved and made.

## 7. uk-socio-economic-duty-2026 (Bridget Phillipson)

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Exact match in HCWS322 (9 Sep 2026, Bridget Phillipson, Minister for Women and Equalities). |
| 2 | Date and venue | PASS | |
| 3 | Evidence | PASS | Status note verified on legislation.gov.uk: s.1 is in force in Scotland from 1.4.2018 and in Wales from 31.3.2021 "for specified purposes", with no commencement for England. |
| 4 | Status | PASS | `promised`. It meets the §2 unscoreable test literally: no cost and no date. |
| 5 | Cost and funding | PASS | |
| 6 | Neutrality | PASS | |
| 7 | Legal risk | PASS | |

**Fixed:** nothing. **For editors:** the unscoreable question (cross-card note).

## 8. uk-mental-health-strategy-2026 (Andy Burnham)

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Exact match. It is the PM's answer to Daisy Cooper (Q12) at PMQs on 9 Sep 2026. |
| 2 | Date and venue | PASS | |
| 3 | Evidence | PASS | The call for evidence was published on 15 May 2026 and is for "a new strategic cross-government approach to mental health". |
| 4 | Status | PASS | `promised`. |
| 5 | Cost and funding | PASS | |
| 6 | Neutrality | PASS | |
| 7 | Legal risk | PASS | |

**Fixed:** added a `deadline` event for 2026-12-24 (editorial date), for consistency with every other card that has a deadline.

**For editors:** 24 Dec is an editorial reading of "before Christmas". The Commons usually rises a few days earlier, so consider the last sitting day once it is announced.

## 9. uk-bics-electricity-2026 (Blair McDougall)

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Exact match. It comes from McDougall's statement on JLR redundancies (2.43pm, 9 Sep 2026). |
| 2 | Date and venue | PASS | |
| 3 | Evidence | PASS | The 1 Oct release (00:01 BST) confirms that applications are open until 30 Nov and support starts in April 2027. |
| 4 | Status | FLAG | `in_plan` is the conservative choice. Applications opening could count as "scheme open", which is `delivering` under §3. But relief starts only in April 2027, the regulations are not made, and the Exchequer funding is to be scored at Budget 2026. The `in_plan` event (1 Oct, applications open) is really a delivery step. Plan evidence would be the April 2026 government response or the draft regulations laid on 7 Sep. |
| 5 | Cost and funding | FLAG, fixed | The ±10% range around £600m p.a. and the `funded_by` text match the April 2026 response and press release. But the `cost_note` said the impact assessment was still to come. The final-stage IA, dated 7 Sep 2026 and signed by McDougall on 3 Sep, is published. It gives an eight-year present value of £3.8bn (2027-28 to 2034-35, 2025 prices) including the one-off payment, or £3.2bn without it. |
| 6 | Neutrality | PASS | |
| 7 | Legal risk | PASS | |

**Fixed:**
- `status_note`: adds that the draft Renewables Obligation and Electricity Capacity (Amendment) (BICS Excluded Electricity) Regulations 2026 were laid on 7 Sep 2026 and need approval by both Houses (SI tracker: draft affirmative, not made).
- `cost_note`: replaced "full funding details will be in the impact assessment" with the IA's figures, marked as a discounted eight-year total that is not used for the range.
- Sources and cost sources: added the draft SI and the IA.

**For editors:**
- Decide between `in_plan` and `delivering`, and whether to re-type or re-date the 1 Oct event.
- Compare the IA's eight-year total with the £600m central figure. The range was left unchanged.
- Funding was not restated in the 9 Sep statement. `funded_by` uses the April 2026 wording; the cheap power plan card does the same with earlier party statements, so both sides are treated alike.

## 10. uk-con-zev-mandate-abolition-2026 (Conservatives)

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Exact match. Julia Lopez, 2.51pm. |
| 2 | Date and venue | PASS | |
| 3 | Evidence | PASS | The policy page (24 Apr 2026) and FleetPoint (15 Dec 2025) support every claim: "completely abolish", the 2030 ban, and £3.8bn over the next decade. |
| 4 | Status | PASS | `promised`. It meets the §2 unscoreable test literally: no cost, and "next Conservative Government" as the only timing. |
| 5 | Cost and funding | PASS | The ten-year total is rightly not used as a yearly figure. |
| 6 | Neutrality | FLAG, fixed | Wrong title. The event called Lopez "Shadow Secretary of State". The Deputy Speaker did call "the shadow Secretary of State", but the Parliament members site lists her as **Shadow Minister (Business, Innovation, Science and Trade)** from 31 Aug 2026. Her Shadow SoS (Science, Innovation and Technology) post ended that day. |
| 7 | Legal risk | PASS | |

**Fixed:** the event now reads "Conservative frontbencher Julia Lopez tells the Commons…". That is true under either title.

## 11. uk-con-cheap-power-plan-2026 (Conservatives)

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Exact match. Julia Lopez. |
| 2 | Date and venue | PASS | |
| 3 | Evidence | PASS | All the party figures are verified: "almost £8 billion a year" (6 Oct 2025), £200 a family (policy page), over £320bn by 2050 (19 Aug 2026), £1.6bn green subsidies (savings list) and "would be paid for by getting Britain drilling" (8 Apr 2026). |
| 4 | Status | PASS | `promised`. It meets the §2 unscoreable test literally. |
| 5 | Cost and funding | PASS | Savings on bills are kept separate from public-finance figures, and no multi-year total is used as a range. |
| 6 | Neutrality | FLAG, fixed | Two problems. The note called Claire Coutinho "Shadow Energy Secretary", but Andrew Bowie has held that post since 31 Aug 2026 (members site). And "carbon tax" was used in the card's own voice. |
| 7 | Legal risk | PASS | |

**Fixed:**
- `status_note`: "Claire Coutinho, then Shadow Energy Secretary", and "Carbon Tax" now appears only inside the party's quoted words.
- Event: Lopez is now described as "Conservative frontbencher".

---

## Actors

| Actor | Result | Note |
|---|---|---|
| lucy-powell | PASS | GOV.UK and the members site agree: Secretary of State for Education from 20 Jul 2026. |
| bridget-phillipson | PASS | GOV.UK: Minister for Women and Equalities from 8 Jul 2024 (current), and Secretary of State for Education from 5 Jul 2024 to 20 Jul 2026. The members site shows a reappointment as Minister for Women and Equalities on 20 Jul 2026; it is the same role held continuously, so no change. |
| blair-mcdougall | PASS | PUSS (Minister for Reindustrialisation) in BIST and DESNZ from 22 Jul 2026. Before that, PUSS in DBT from 7 Sep 2025 to 22 Jul 2026. The file's title matches the members site; GOV.UK names that earlier role "Minister for Small Business and Economic Transformation" if you want it added. |

## Cross-card note for editors: the §2 unscoreable test

Under §2, a card missing two or more of who, how much and when is unscoreable. Read literally, that catches five cards: mayors 16-19, child images law, socio-economic duty, Conservative ZEV and Conservative cheap power. The curriculum card is borderline: its "when" can be inferred from official documents (spring 2027).

That is three or four government cards and two Conservative cards, so whatever editors decide should be applied to all of them alike. The open question is whether "how much" applies to regulatory or non-spending pledges. The precedent is the corp-tax-cap card: `how_much` is null, but it has a "when", so it stays scoreable.

Not done: none of the 11 cards has a `reviews` entry. The reference cards carry a Junior Editor review. Add one at merge if that is the practice.

## Summary

| Card | Quote | Date/venue | Evidence | Status | Cost | Neutral | Legal | Edited |
|---|---|---|---|---|---|---|---|---|
| uk-mayors-16-19-budget-2026 | PASS | PASS | PASS | FLAG (in_plan? unscoreable?) | PASS | PASS | PASS | No |
| uk-send-inclusion-standards-2026 | PASS | PASS | PASS | FLAG (in_plan supported) | PASS | PASS | PASS | No |
| uk-curriculum-proposals-2026 | PASS | PASS | PASS | FLAG (spring 2027 timeline) | PASS | PASS | PASS | No |
| uk-child-nude-images-law-2026 | PASS | FLAG (8 Sep Commons) | PASS | PASS (unscoreable?) | PASS | PASS | PASS | No |
| uk-nhs-capital-1-5bn-2026 | PASS | PASS | FLAG, fixed | FLAG (funded?) | PASS | FLAG, fixed | PASS | Yes |
| uk-landlord-register-2026 | PASS | PASS | PASS | PASS | FLAG, fixed | FLAG, fixed | PASS | Yes |
| uk-socio-economic-duty-2026 | PASS | PASS | PASS | PASS (unscoreable?) | PASS | PASS | PASS | No |
| uk-mental-health-strategy-2026 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | Yes (deadline event) |
| uk-bics-electricity-2026 | PASS | PASS | PASS | FLAG (delivering?) | FLAG, fixed | PASS | PASS | Yes |
| uk-con-zev-mandate-abolition-2026 | PASS | PASS | PASS | PASS (unscoreable?) | PASS | FLAG, fixed | PASS | Yes |
| uk-con-cheap-power-plan-2026 | PASS | PASS | PASS | PASS (unscoreable?) | PASS | FLAG, fixed | PASS | Yes |
| Actors (3) | | | | | | | | No, all PASS |
