# Editor-aid second check: group 1

Checked 6 October 2026. Seven cards, all with actor `labour` (Labour Party, kind: party).

How I checked:
- **Manifesto:** I fetched the PDF fresh from labour.org.uk (8,128,701 bytes, SHA-1 `ccbd1a3a…`). It is byte-identical to the researcher's copy. I extracted each page with `pdftotext` and matched the quotes after normalising whitespace and quote marks. PDF page numbers equal the printed page numbers throughout.
- **Other PDFs:** Autumn Budget 2024 (AB24), Budget 2025 (B25), Spending Review 2025 (SR25), Plan for Change (PfC), the GBE designation letter and the High Court press summary were each fetched fresh and hash-matched.
- **Web pages:** gov.uk pages were read through the content API. Legislation was read from legislation.gov.uk.

---

## 1. uk-homes-1-5m-2024

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim on manifesto p.36, right column, body text. The same words also appear in the pull-quote. |
| 2 | Date and venue | PASS | Manifesto published 13 Jun 2024 (the PDF was last modified 13 Jun 2024). Page 36 is correct. |
| 3 | Evidence | PASS | **PfC (5 Dec 2024):** "Building 1.5 million homes in England" milestone.<br>**SR25 (11 Jun 2025), paras 4.19a and 5.71:** £39bn, 10-year Affordable Homes Programme.<br>**MHCLG (20 Nov 2025):** 275,600, 9 Jul 2024 to 9 Nov 2025.<br>**Planning and Infrastructure Act 2025 (c.34):** Royal Assent 18 Dec 2025.<br>**MHCLG (24 Sep 2026), Table 1:** 437,900, 9 Jul 2024 to 20 Sep 2026. |
| 4 | Status | PASS | Delivering is right. Homes are being added and measured against the target. 29% is partial delivery, which §3 keeps at Delivering. |
| 5 | Cost and funding | PASS | The £20m for 300 planning officers is on p.127 (2028-29). The "existing budgets or no cost" wording is on p.126. The £39bn is correct. Minor: SR25 para 5.71 spreads the £39bn over 2026-27 to 2035-36, reaching £4bn a year in 2029-30, so most of it falls after this Parliament. The cost_note does not say this. |
| 6 | Neutrality | PASS | Descriptive wording. The figures are correctly called "estimates": they are based on Energy Performance Certificates (EPCs), not final outturn figures. |
| 7 | Legal risk | PASS | Names no person and contains no wording about intent. |

**Suggested corrections**
- Optional: in the cost_note, after "£39bn over ten years", add "(2026-27 to 2035-36, reaching £4bn a year in 2029-30; SR25 para 5.71)".

---

## 2. uk-no-tax-rise-working-people-2024

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim on manifesto p.21, left column. |
| 2 | Date and venue | PASS | 13 Jun 2024; page 21 is correct. |
| 3 | Evidence | PASS | **AB24 para 2.35:** "committed to not increase taxes on working people, which is why it is not increasing the basic, higher or additional rates of income tax, National Insurance contributions or VAT".<br>**AB24 para 2.40:** employer NICs rise from 13.8% to 15% from 6 Apr 2025.<br>**B25 para 2.27:** "not increasing the headline rates of income tax, National Insurance contributions (NICs) or VAT".<br>**B25 para 2.28:** thresholds frozen to April 2031.<br>**Legislation:** National Insurance Contributions (Secondary Class 1 Contributions) Act 2025 (c.11), Royal Assent 3 Apr 2025. Finance Act 2026 ss.4, 5, 7 and 10 confirmed. |
| 4 | Status | FLAG | (a) **Inconsistent with the corp-tax card.** That card is at Legislated because Finance Acts set its rate. FA 2025 s.2 and FA 2026 s.2 likewise set the main income tax rates at 20/40/45% for 2025-26 and 2026-27. By the same rule this card would be Legislated. One possible reason to treat it differently: the "taxes on working people" scope is wider than the three rates, and NI and VAT rates are standing law. Either way the editor needs one rule, written down.<br>(b) **"Budgets … restated the commitment" overstates B25.** B25 only says headline rates are not rising. It does not repeat the "taxes on working people" commitment.<br>(c) **"Dividend, savings and property income rise by 2 points" is too broad.** The dividend additional rate (39.35%) is unchanged (FA 2026 s.4). |
| 5 | Cost and funding | PASS | Null is justified. The p.126 wording is correct. |
| 6 | Neutrality | PASS | Facts on both sides, no loaded words. |
| 7 | Legal risk | PASS | No named person. The employer NI rise is stated next to the pledge without comment, so the card does not allege bad faith. |

**Suggested corrections**
- **Restatement wording.** In the status_note, replace "Budgets in October 2024 and November 2025 restated the commitment, and" with: "Autumn Budget 2024 restated the commitment (para 2.35), Budget 2025 said the headline rates were not increasing (para 2.27), and".
- **Rate rises wording.** Replace "tax rates on dividend, savings and property income rise by 2 points from 2026 and 2027" with: "the dividend ordinary and upper rates rise by 2 points from April 2026, and tax rates on savings and property income by 2 points from April 2027 (Finance Act 2026 ss.4, 5 and 7)".
- **Status rule.** Pick one rule for rate-hold pledges across this card and uk-corp-tax-cap-25-2024, then do one of two things:
  - add a `legislated` event citing https://www.legislation.gov.uk/ukpga/2026/11/section/2/enacted (Royal Assent 18 Mar 2026), or
  - add one sentence to the status_note explaining why this card stays at In plan.
- **Optional, "who" field.** Income tax rates on non-savings income for Scottish taxpayers are set by the Scottish Parliament. "Across the UK" is exact only for NI and VAT.
- **Optional, status_note.** B25 also caps NI relief on salary-sacrifice pension contributions at £2,000 from April 2029. This is another change affecting employee NI.

---

## 3. uk-corp-tax-cap-25-2024

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim on manifesto p.31, left column. |
| 2 | Date and venue | PASS | 13 Jun 2024; page 31 is correct. |
| 3 | Evidence | PASS | **Corporate Tax Roadmap (30 Oct 2024):** "capping the headline rate of Corporation Tax at 25% for the duration of parliament".<br>**FA 2025 s.13:** "main rate … for [FY2026] is 25%", Royal Assent 20 Mar 2025.<br>**FA 2026 s.11:** FY2027 rate 25%, Royal Assent 18 Mar 2026. |
| 4 | Status | PASS | Legislated is well supported. Delivering could be argued, since the rate has been held since July 2024. Legislated rests on firmer evidence. See the consistency point under card 2. |
| 5 | Cost and funding | PASS | Null is justified. The p.126 wording is correct. |
| 6 | Neutrality | PASS | — |
| 7 | Legal risk | PASS | — |

**Suggested corrections**
- None for this card on its own. Resolve the cross-card status rule under card 2.

---

## 4. uk-vat-private-schools-2024

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim on manifesto p.82, left column. |
| 2 | Date and venue | PASS | 13 Jun 2024; page 82 is correct. |
| 3 | Evidence | PASS | **HMRC tax information and impact note:** first published 30 Oct 2024. It covers VAT from 1 Jan 2025 and the end of rates relief from April 2025.<br>**FA 2025 s.49:** in force 30 Oct 2024, applying to supplies on or after 1 Jan 2025. Royal Assent 20 Mar 2025.<br>**Non-Domestic Rating (Multipliers and Private Schools) Act 2025 (c.12):** Royal Assent 3 Apr 2025. s.5 removes relief (England only); s.6(2) applies it to financial years from 1 Apr 2025. |
| 4 | Status | FLAG | Delivered is supported: both tax changes are in force, and the spending clause is explicitly out of scope. But the status_note is out of date on the court case:<br>- **Court of Appeal:** dismissed the appeal on 27 Feb 2026, [2026] EWCA Civ 170.<br>- **Supreme Court:** gave permission to appeal on 22 May 2026 and listed a hearing for 1–2 Dec 2026 (UKSC 2026/0056 and 2026/0045). |
| 5 | Cost and funding | PASS | Matches AB24 Table 5.1 lines 22–23 and HMRC: £1,665m + £85m = £1.75bn in 2028-29. The £1,510m on p.127 is VAT and business rates combined for 2028-29. Range order [-1.75, -1.75, -1.51] is valid. Minor: the 2027-28 figures (£1,610m VAT, £85m rates) are left out of the other-years list. |
| 6 | Neutrality | PASS | Minor: "who" says families "pay more". HMRC says whether fees rise is a commercial decision for each school. |
| 7 | Legal risk | PASS | The court case is named by anonymised claimants only. |

**Suggested corrections**
- **Court case wording.** In the status_note, replace the High Court sentence with: "The High Court dismissed a human rights challenge to the VAT change on 13 June 2025 and the Court of Appeal dismissed an appeal on 27 February 2026; the Supreme Court gave permission to appeal on 22 May 2026 and has listed a hearing for 1–2 December 2026."
- **Sources to add:**
  - https://caselaw.nationalarchives.gov.uk/ewca/civ/2026/170
  - https://www.supremecourt.uk/cases/uksc-2026-0056
  - https://www.supremecourt.uk/cases/uksc-2026-0045
- Optional: add "£1,610m and £85m in 2027-28" to the cost_note.
- Optional: in "who", change "(pay more)" to "(bear the cost, through fees or school budgets)".

---

## 5. uk-nhs-40000-appointments-2024

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim on manifesto p.95, left column. |
| 2 | Date and venue | PASS | 13 Jun 2024; page 95 is correct. |
| 3 | Evidence | PASS | **AB24:** "supporting the NHS to deliver 40,000 extra elective appointments a week … This includes an additional £1.8 billion to support elective activity since July".<br>**DHSC (16 Feb 2025):** "almost 2.2 million more elective care appointments", July to November 2024 compared with a year earlier.<br>**UK Statistics Authority (UKSA) letter (16 Jul 2025):** "The OSR has verified the accuracy of the figure of 3.6 million additional elective appointments".<br>**B25 para 2.67:** "extra 5.2 million NHS appointments for planned care". Minor: the 3.6 million covers "the first eight months of its term", which the event text leaves out. |
| 4 | Status | PASS | Delivering is right for an every-year pledge. |
| 5 | Cost and funding | FLAG | Minor year mix-up. The cost_note puts the £1.8bn "in 2024-25, within a £22.6bn rise in the health department's day-to-day budget for 2025-26 compared with 2023-24". AB24 says the £1.8bn is "since July" (2024-25 money). The £22.6bn compares the 2025-26 budget with 2023-24, so a 2024-25 sum is not part of that rise. Everything else checks out: £1,010m on p.127 (2028-29), ±10% labelled, and funded_by matches p.10 ("paid for by cracking down on tax avoidance and non-dom loopholes"). |
| 6 | Neutrality | PASS | — |
| 7 | Legal risk | PASS | Helen Morgan MP appears only in a source title. The card does not repeat her letter's "possible misrepresentation" claim. |

**Suggested corrections**
- **cost_note.** Replace the comparison sentence with: "For comparison, Autumn Budget 2024 included an additional £1.8bn to support elective activity since July 2024, and a £22.6bn rise in the health department's day-to-day budget in 2025-26 compared with 2023-24."
- **3.6 million period.** In the 2025-07-16 event text and in the status_note, add "in its first eight months" after "3.6 million additional elective appointments".

---

## 6. uk-great-british-energy-2024

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim on manifesto p.53. The sentence runs from the foot of the left column to the top of the right. The hyphen in "publicly-owned" falls at a line break, but it is a real hyphen: p.10 prints "publicly-owned" unbroken. |
| 2 | Date and venue | PASS | 13 Jun 2024; page 53 is correct. |
| 3 | Evidence | FLAG | **Wrong date on the annual report.** Both gov.uk pages show "Published 14 September 2026" (HC 592, ordered printed 14 Sep 2026). 30 Sep 2026 is only a later timestamp on the HTML version.<br>All other events are supported:<br>- **AB24:** £125m in 2025-26; headquarters in Aberdeen.<br>- **GBE Act 2025 (c.16):** Royal Assent 15 May 2025.<br>- **Designation notice:** dated 19 May 2025, in effect from 00:00 on 21 May 2025.<br>- **SR25 para 4.57:** "more than £8.3 billion over this Parliament" (para 5.90 says "over the SR").<br>- **Annual report:** "£255m in its Solar Partnerships Scheme … 250 schools, 260 NHS sites and multiple military sites". |
| 4 | Status | FLAG | Editor decision. The quoted text only promises to create a publicly owned company. That is done: the Act is passed, the company is designated, it is wholly owned by the Secretary of State and it is investing. Read narrowly, that is Delivered. Delivering depends on the £8.3bn capitalisation, which is on p.53 but outside the quote. Also, SR25 now counts the £8.3bn across GBE and GBE–Nuclear together, while the manifesto put it on GBE alone. That may be a rewording under §4. |
| 5 | Cost and funding | PASS | £1.7bn annual average on p.128; ±10% labelled. funded_by matches p.10 and p.128. The £5.3bn (2025/26 to 2029/30) and the "£8.3 billion over this Parliament" for GBE and GBE-N both match the report. |
| 6 | Neutrality | PASS | — |
| 7 | Legal risk | PASS | — |

**Suggested corrections**
- **Annual report date.** In the event and in both source titles, change 2026-09-30 / "30 Sep 2026" to 2026-09-14 / "14 Sep 2026".
- **Status basis.** In the status_note, state what the status is measured against. Quote p.53 directly: "Labour will capitalise Great British Energy with £8.3 billion, over the next parliament". Otherwise reconsider Delivered for the creation pledge as quoted.
- **Rewording.** Decide whether SR25's combined GBE and GBE–Nuclear £8.3bn needs a `reworded` event under §4.

---

## 7. uk-neighbourhood-police-2024

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim on manifesto p.64, right column. The funded_by quote is verbatim on p.65. |
| 2 | Date and venue | PASS | 13 Jun 2024; page 64 is correct. |
| 3 | Evidence | PASS | **AB24 para 4.20:** "on track to start to deliver the manifesto pledge … 13,000 more neighbourhood officers and [PCSOs]".<br>**PfC:** 13,000 milestone, including special constables.<br>**Home Office funding statistics:** "£200 million Neighbourhood Policing Grant", financial year ending 31 Mar 2026.<br>**Home Office news (10 Apr 2025):** "3,000 additional … within the next 12 months"; "13,000 more officers into communities by 2029".<br>**SR25 para 3.23:** 2.3% a year in real terms.<br>**Police workforce statistics (22 Jul 2026):** 20,989 FTE, +3,814 on the 31 Mar 2025 baseline.<br>Minor: the SR25 event leaves out the base period (2023-24 to 2028-29). "Spending power" also includes council tax. |
| 4 | Status | FLAG | Delivering is right, but the status_note reports only the rise in neighbourhood roles. The same release shows falls over the year to 31 Mar 2026:<br>- police officers −566 FTE<br>- PCSOs −55 FTE<br>- special constables −324 (headcount)<br>The neighbourhood measure counts officers in training and moves between roles, and excludes specials. The quote promises growth "by recruiting thousands of new" officers, PCSOs and specials, so the note is one-sided without these figures. |
| 5 | Cost and funding | PASS | £400m on p.129. It covers both the 13,000 and the 999 domestic abuse advisers, and the quoted costing line makes that clear. ±10% labelled. Optional: the year-two grant (2026-27) rose by £163m (81.7%), to about £363m. |
| 6 | Neutrality | PASS | No loaded words. See the balance point under check 4. |
| 7 | Legal risk | PASS | — |

**Suggested corrections**
- **Workforce context.** In the status_note, after the 3,814 sentence, add: "Over the same year the total number of police officers fell by 566 FTE, PCSOs by 55 FTE and special constables by 324 (headcount); the neighbourhood measure counts officers and PCSOs, including those in training, but not special constables (Home Office, Police workforce, 31 March 2026)."
- **SR25 event.** In the 2025-06-11 event, change to "by an average 2.3% a year in real terms from 2023-24 to 2028-29".
- Optional: add the year-two Neighbourhood Policing Grant to the cost_note.

---

## Cross-card note (not counted as a flag)

Five cards use 2029-07-01 as "End of the Parliament (editorial date)". Under the Dissolution and Calling of Parliament Act 2022 s.4, this Parliament (first met 9 Jul 2024) dissolves automatically at the start of 9 Jul 2029. Consider either:
- moving the date to 2029-07-09, or
- relabelling it "editorial date, before the latest possible dissolution on 9 July 2029".

## Summary

| Card | Checks flagged | Most important issue |
|---|---|---|
| uk-homes-1-5m-2024 | none | Optional: the £39bn runs 2026-27 to 2035-36, mostly after this Parliament |
| uk-no-tax-rise-working-people-2024 | 4 | Status rule differs from the corp-tax card (FA 2025 and FA 2026 s.2 set income tax main rates). B25 did not restate the "working people" commitment. The dividend additional rate is unchanged. |
| uk-corp-tax-cap-25-2024 | none | Needs the same rate-hold status rule as the no-tax card |
| uk-vat-private-schools-2024 | 4 | status_note out of date: Court of Appeal dismissed the appeal 27 Feb 2026; Supreme Court hearing 1–2 Dec 2026 |
| uk-nhs-40000-appointments-2024 | 5 | cost_note mixes years (the 2024-25 £1.8bn is not part of the 2025-26 rise of £22.6bn); the 3.6m is for 8 months |
| uk-great-british-energy-2024 | 3, 4 | Annual report published 14 Sep 2026, not 30 Sep. Status depends on the £8.3bn, which is outside the quote. |
| uk-neighbourhood-police-2024 | 4 | status_note leaves out that total officers, PCSOs and specials fell over the same year, while the quote promises recruitment |
