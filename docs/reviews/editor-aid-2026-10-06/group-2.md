# Editor-aid second check: group 2

Checked on 6 October 2026 against live sources. Method: PDFs downloaded and text-extracted with pdftotext; GOV.UK pages read through the GOV.UK content API (raw body text); Hansard read through hansard-api.parliament.uk because hansard.parliament.uk returns a Cloudflare challenge to scripts; IFS and OBR pages read in the browser pane for the same reason. No repo file edited.

---

## uk-abolish-non-dom-2024

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim on manifesto PDF page 21 (printed page 21), left column. |
| 2 | Date and venue | PASS | Manifesto launched 13 Jun 2024; page 21 correct. |
| 3 | Evidence | PASS | Treasury policy summary first published 29 Jul 2024 and says "From 6 April 2025, the government will remove the outdated concept of domicile status from the tax system". Finance Act 2025 Royal Assent 20 Mar 2025; s.40 "Remittance basis not available after tax year 2024-25". HMRC guidance (published 6 Apr 2025): "On 6 April 2025 the 4-year foreign income and gains regime replaced the remittance basis." |
| 4 | Status | PASS | Delivered is the best-supported stage: remittance basis gone and the 4-year FIG regime in force since 6 Apr 2025, as the pledge was worded. |
| 5 | Cost and funding | PASS | Table 5.1 line 20 (Budget PDF page 116) reads +0m, *, +4,170m, +5,895m, +2,545m, +95m; all match. The same figures are in the Policy Costings document (p.31). The costings document does not say outright that the baseline already includes the March 2024 abolition, but scorecard convention supports the card's framing. The manifesto page 127 £5,230m and the £600m footnote are correctly read; the "paid for by ... non-dom loopholes" quote is on manifesto page 10. funded_by holds an explanation (the pledge raises money) rather than a funding source, which is reasonable. |
| 6 | Neutrality | PASS | Descriptive throughout; "loopholes" appears only inside quotes. |
| 7 | Legal risk | PASS | None found. |

Suggested corrections: None.

---

## uk-bus-cap-2-2026

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim in the 22 Jul 2026 GOV.UK press release, in the "Prime Minister Andy Burnham said" block (second paragraph). |
| 2 | Date and venue | PASS | First published 22 Jul 2026 06:35 BST by No 10, HMT and DfT; press_release fits. |
| 3 | Evidence | PASS | The Written Ministerial Statement (Lord Hendy, 22 Jul 2026) confirms the cap from 1 Jan to 31 Dec 2027, "£400 million of extra government funding", and "reprioritising the Department for Energy Security and Net Zero's budget". The DfT guidance change log shows "Information about £2 bus fare scheme for 2027 added" on 22 Jul 2026. SR2025 says "extending the £3 bus fare cap ... until March 2027". The 2023 and 2025 DfT news items are dated 1 Jan 2023 and 1 Jan 2025. |
| 4 | Status | PASS | in_plan is right. Funding is named but not yet in a Budget, SR or Estimates line, and no higher stage is supported. |
| 5 | Cost and funding | PASS | £400m (WMS and press release) and £454m including devolved funding (press release) are correctly read. funded_by matches the press release wording. The note is right that the release does not say whether £400m is the full cost or the extra over the £3 cap. The release also says the £3 cap was funded "until the end of March 2027", so January to March 2027 is partly covered already. |
| 6 | Neutrality | PASS | Neutral. |
| 7 | Legal risk | PASS | None found. |

Suggested corrections (optional; cost_note): add "The £3 cap was already funded to March 2027 (SR2025), so part of the first quarter of 2027 was already covered." Why: it tells readers why £400m may be less than the full-year cost, without guessing a number.

---

## uk-defence-25-2027

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim in the PM's opening statement, Hansard 25 Feb 2025, Commons, "Defence and Security" (debate 8BF58F19…). Read via hansard-api JSON for the same debate ID because the cited hansard.parliament.uk URL is behind Cloudflare. |
| 2 | Date and venue | PASS | 25 Feb 2025, Commons statement. |
| 3 | Evidence | PASS | SR2025: "total NATO-qualifying defence spending is on a clear path to reach 2.6% of ... GDP by 2027". DIP funding explainer (30 Jun 2026): £15.0bn over 2026-27 to 2029-30; NATO % row reads 2.6%, 2.7%, 2.7%, 2.7%. The "2.5% plus intelligence = 2.6%" wording matches Hansard. |
| 4 | Status | FLAG | Funded is defensible, but the reason given ("can only be checked against 2027-28 spending") is a reason not to mark delivered; it does not rule out delivering. The DIP shows the 2026-27 MOD budget (£68.3bn) planned at 2.6% NATO measure in the current year, with money already being spent above the old path. That arguably meets §3 "delivering" (payments flowing). |
| 5 | Cost and funding | PASS | £13.4bn "more on defence every year from 2027" (Hansard). IFS (Zaranko, 25 Feb 2025): "An extra 0.2% of GDP is around £6 billion" and £13bn "only seems to make sense if ... frozen in cash terms". funded_by matches "moving from 0.5% of GNI today to 0.3% in 2027". |
| 6 | Neutrality | PASS | The IFS critique is attributed and paraphrased without the IFS's word "misleadingly". |
| 7 | Legal risk | PASS | No accusation attributed to the card itself; the IFS view is clearly sourced. |

Suggested corrections: either (a) move to `delivering` with an evidence_url for 2026-27 spending (e.g. the DIP explainer, or MOD Main Estimates 2026-27), or (b) keep `funded` and reword the status_note to: "Money is allocated to 2029-30; the card will move to Delivering when a source confirms spending at the higher level and to Delivered when 2027-28 outturn shows 2.5%." Why: the current wording gives a reason that belongs to a different stage, which a reader or the actor could challenge.

---

## uk-nato-5pc-2035-2025

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim in the NSS PDF on PDF page 6 (printed page 5), PM Foreword. |
| 2 | Date and venue | PASS | GOV.UK first published the NSS 24 Jun 2025; "PM's foreword, page 5" is correct. No `venue` enum fits a strategy document, so leaving it out is fine. |
| 3 | Evidence | FLAG | The status_note says the NSS and the DIP "name the commitment (3.5% ... and 1.5% ...)". The NSS PDF states only the 5% total, with no 3.5% or 1.5%. The DIP explainer states "3.5% of GDP on defence spending by 2035" and mentions the "Defence Investment Pledge", but not the 1.5%. The split appears in the No 10 press release ("projected split of 3.5% (core defence) and 1.5% (resilience and security)"). The in_plan event text itself is supported. |
| 4 | Status | PASS | in_plan is right; the DIP plans only to 2029-30 at 2.7%. The plan covers only the 3.5% element; nothing official plans the 1.5%. |
| 5 | Cost and funding | FLAG | IFS: "from 2.3% of GDP last year to 3.5% by 2035 ... £36 billion ... a year in current terms" (26 Sep 2025). (a) The baseline is 2024 spending, so the £36bn includes the rise to 2.5–2.7% already costed on uk-defence-25-2027 (£6–13.4bn), and the two cards double-count if summed. (b) "Today's terms" means 2025 terms. Scaling the IFS figure (my own arithmetic, not a published costing), the rise from the planned 2.7% to 3.5% is roughly £24bn. funded_by: null is correct. |
| 6 | Neutrality | PASS | "historic" appears only in the quote. |
| 7 | Legal risk | PASS | None found. |

Suggested corrections:
- status_note: replace the parenthesis with "The National Security Strategy commits to 5% of GDP on national security by 2035; No 10's 23 June 2025 press release gives a projected split of 3.5% core defence and 1.5% resilience and security; the June 2026 Defence Investment Plan restates the 3.5% for 2035, but money is set out only to 2029-30, at 2.7% of GDP." Why: each claim then points to the document that actually contains it.
- cost_note: add "The IFS figure is measured from 2024 spending (2.3% of GDP), so it overlaps with the rise to 2.5% on the separate 2027 defence card; in 2025 terms." Why: it prevents readers or the sandbox from counting the same money twice.
- sources: the No 10 press release title says 24 Jun 2025, but GOV.UK dates it 23 Jun 2025 (22:30 BST). Change to "23 Jun 2025".

---

## uk-nhs-18-weeks-2024

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim, lowercase included, on Plan for Change PDF page 8 (printed page 6), in the foreword's list of milestones. |
| 2 | Date and venue | PASS | Published 5 Dec 2024; foreword page 6 is correct. No venue enum fits. |
| 3 | Evidence | FLAG (minor) | NHS England plan (6 Jan 2025): "We will meet the 18-week standard by March 2029 ... 65% nationally" by March 2026, which matches. SR2025 link to 92% matches. The press notices say "In 65.3% of cases" (March 2026, published 14 May 2026) and "In 65.4% of cases" (July 2026, published 10 Sep 2026). These are RTT pathways, not patients: 7.1m pathways against about 6.0m unique patients. The delivering event and the status_note both say "patients". |
| 4 | Status | PASS | Delivering is the best fit: the plan is running and the interim goal was met; 92% has not been met. |
| 5 | Cost and funding | PASS | £29bn real-terms rise in NHS day-to-day spending, 2023-24 to 2028-29, matches SR2025. Null cost with explanation is appropriate. |
| 6 | Neutrality | FLAG (minor) | "still well short of 92%" is evaluative. The source wording is "thus not meeting the 92% standard". |
| 7 | Legal risk | PASS | None found. |

Suggested corrections:
- New event or status_note wording: "65.3% of waiting-list pathways (cases) were under 18 weeks". Why: it matches the official measure, which counts pathways, not people. The original event cannot be edited, so fix this in status_note and any future events.
- status_note: replace "still well short of 92%" with "26.6 percentage points below the 92% standard". Why: it gives the same information as a number rather than a judgement.
- Optional: SR2025 "ties" the settlement to the target; "links" (the word the event uses) is closer to the source's "will support".

---

## uk-two-child-limit-2025

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim in the Chancellor's Budget speech (hansard-api JSON, debate 0FD15A2E…). It is the second half of a sentence that starts "So because I am tackling fraud and error ...". |
| 2 | Date and venue | PASS | 26 Nov 2025, Commons, Financial Statement. |
| 3 | Evidence | PASS | Budget 2025 Table 5.1 line 6 reads -2,365m, -2,590m, -2,815m, -3,095m, -3,235m. Act c.13: Royal Assent 18 Mar 2026; "have effect in relation to assessment periods commencing on or after 6 April 2026". DWP statistics (published 8 Jul 2026): "removed in April 2026, taking effect for assessment periods beginning on or after 6 April 2026." |
| 4 | Status | PASS | Delivered: the limit was removed in full from April 2026, as worded. |
| 5 | Cost and funding | PASS | All years match. OBR EFO para 1.16 / 3.20: "£3 billion by 2029-30", "560,000 families ... averaging £5,310 per year" in 2029-30. funded_by matches the speech, except the speech says "our welfare system" where the card says "the". |
| 6 | Neutrality | PASS | The card does not repeat the speech's loaded terms. |
| 7 | Legal risk | PASS | None found. |

Suggested corrections (optional): (a) funded_by: "our welfare system" to follow §2 "exactly as stated". (b) Add the human-readable Hansard link (hansard.parliament.uk/commons/2025-11-26/...) next to the API JSON. Why: readers can check the quote without reading raw JSON.

---

## uk-electricity-vat-2026

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim in the 21 Jul 2026 GOV.UK press release, PM quote block (third paragraph). |
| 2 | Date and venue | PASS | First published 21 Jul 2026 06:05 BST by No 10, HMT and DESNZ. |
| 3 | Evidence | PASS | SI 2026/987 was made 7 Sep 2026 and is in force 1 Oct 2026; it applies to supplies "beginning with 1st October 2026 and ending with 31st March 2027" in England, Wales and Scotland. HMT news (1 Oct 2026): "Removal of VAT from electricity bills starts today." |
| 4 | Status | PASS | Delivered matches how other cards treat an in-force measure (e.g. the two-child limit). The zero rate is temporary and the note says so. If editors prefer to treat a time-limited measure as "delivering" until 31 Mar 2027, that would also be defensible, but it is a policy choice, not an error. |
| 5 | Cost and funding | FLAG (minor) | Cost (£850m in 2026-27) and funded_by (Digital ID, £1.8bn over three years) match. But `who` and the status_note say Northern Ireland gets "equivalent funding"; the source says "comparable funding". `who` also leaves out "Small businesses who qualify for the domestic energy VAT relief and are not registered for VAT", which the release names. |
| 6 | Neutrality | PASS | Neutral. |
| 7 | Legal risk | PASS | None found. |

Suggested corrections: in `who` and the status_note, change "equivalent" to "comparable", and add "non-VAT-registered small businesses that qualify for domestic energy VAT relief". Why: both are the press release's own terms; "equivalent" claims more than the government said. In cost_note, "the only year of the measure" could read "the only year announced so far (the government said further action would be considered at the Budget)". Why: the release leaves an extension open.

---

## Summary

| Card | Checks flagged | Most important issue |
|---|---|---|
| uk-abolish-non-dom-2024 | none | none |
| uk-bus-cap-2-2026 | none | Optional: note that the £3 cap was already funded to Mar 2027 |
| uk-defence-25-2027 | 4 | Status reason confuses delivering with delivered; the 2026-27 budget at 2.6% arguably supports Delivering |
| uk-nato-5pc-2035-2025 | 3, 5 | status_note says NSS and DIP name the 3.5%/1.5% split; neither does (it is in the No 10 release). £36bn overlaps with the 2027 defence card |
| uk-nhs-18-weeks-2024 | 3 (minor), 6 (minor) | Says "patients" where the statistic counts pathways; "well short" is evaluative |
| uk-two-child-limit-2025 | none | Optional: funded_by "the" should be "our" |
| uk-electricity-vat-2026 | 5 (minor) | "equivalent funding" for NI where the source says "comparable"; `who` leaves out qualifying small businesses |
