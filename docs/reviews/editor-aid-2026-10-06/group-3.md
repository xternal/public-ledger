# Editor-aid second check, group 3

Checked 6 Oct 2026. Sources were read with curl, WebFetch or the browser pane. The Reform PDF returned 403 to curl, so it was read in the browser pane. BBC could not be fetched by any route, so BBC claims were cross-checked against CIOT, LBC and the Newark Advertiser.

---

## 1. uk-disabled-bus-pass-2026

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim in Andy Burnham's quote in the gov.uk press release body (HTML page, no page number). |
| 2 | Date and venue | PASS | The text says "announced today (Tuesday 18 August)". gov.uk metadata shows "Published: 17 August 2026" (an embargoed release). Issued by No 10, DfT, DWP and Andy Burnham, which matches the label. |
| 3 | Evidence | PASS | No event has an evidence_url. The promised event (lift time limits from 1 Apr 2027) matches the release. |
| 4 | Status | PASS | Promised is right. £60m comes from existing DWP/DfT budgets and is not a Budget, Spending Review or estimates line. Trade press (Isle of Thanet News, 18 Aug) says the change still has to go through Parliament. No SI or plan was found by 6 Oct 2026. |
| 5 | Cost and funding | PASS | £60m = £40m DWP + £20m DfT, from "existing" budgets (Additional information section). The release does not say whether this is one-off or yearly, so a null cost is reasonable. |
| 6 | Neutrality | PASS | Descriptive. |
| 7 | Legal risk | PASS | None. |

**Suggested corrections:** None. Optional: note in the source title that gov.uk dates the page 17 Aug 2026.

---

## 2. uk-con-stamp-duty-abolition-2025

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim in the speech text on conservatives.com/news/kemi-badenoch-closes-conference (page dated 8 Oct 2025). |
| 2 | Date and venue | PASS | Closing leader's speech, 8 Oct 2025. |
| 3 | Evidence | PASS | No evidence_url events. Griffith's 5 Oct 2026 speech does contain "Scrapping stamp duty entirely on primary homes." |
| 4 | Status | PASS | Opposition party, so Promised. |
| 5 | Cost and funding | FLAG | The range [4.5, 9.0, 9.0] is a time profile, not uncertainty. IfG and CIOT both say the party gives £9bn **in 2029-30** and "the **current** cost is around £4.5bn". The card's "at today's prices" misreads "current cost". Minor: the policy page says the non-deficit half goes to "tax cuts **and pro-growth measures**". |
| 6 | Neutrality | PASS | Descriptive. |
| 7 | Legal risk | PASS | None. |

**Suggested corrections:**
- Set `how_much_bn_per_year: [8.1, 9.0, 9.9]`, which is the editorial ±10% around the party's 2029-30 figure, and say so in cost_note.
- Change "it notes the cost at today's prices is about £4.5bn (low)" to "it says the current cost is about £4.5bn". Sources: IfG explainer; CIOT conference report, "the current cost is around £4.5 billion".
- In funded_by, change "the rest to tax cuts" to "the rest to tax cuts and pro-growth measures" (conservatives.com/policy).

---

## 3. uk-reform-personal-allowance-15k-2026

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim on printed p.12 (PDF p.15), "How Reform UK will cut taxes". |
| 2 | Date and venue | PASS | Conference at the NEC Birmingham, 3–5 Sep 2026. Jenrick's speech and the document were on 5 Sep (CIOT, LBC, Newark Advertiser). `venue` is blank, which matches other cards built on documents. |
| 3 | Evidence | PASS | No evidence_url events. The promised event text is supported. |
| 4 | Status | PASS | Promised. CIOT supports the claims about the November 2025 retreat and the £20k long-term ambition. |
| 5 | Cost and funding | FLAG | [17.7, 17.7, 21.1] is a time profile: p.13 says "£17.7 billion in this tax year and £21.1 billion in five years". Funding also leaves out timing: the £52bn and £7bn savings are "by the end of the next Parliament" (pp.13–14). |
| 6 | Neutrality | PASS | Descriptive. |
| 7 | Legal risk | PASS | None. |

**Suggested corrections:**
- Pick one year and apply ±10%, e.g. fifth year `[19.0, 21.1, 23.2]` (this matches the steady-year choice on the Conservative and SNP cards). Record "£17.7bn in the first year (2026-27 incomes)" in cost_note as the profile.
- funded_by: add "by the end of the next Parliament" after the £52bn welfare and £7bn government-size figures (PDF pp.13–14).

---

## 4. uk-ld-free-personal-care-2024

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim on manifesto PDF p.37 (printed p.37). |
| 2 | Date and venue | PASS | Manifesto launched 10 Jun 2024 (IFS reaction is dated the same day). Note: the press release page shows "8 Jun 2024", but it was embargoed for 22:30 Mon 3 June and the Health Foundation replied on 4 June. |
| 3 | Evidence | PASS | No evidence_url events. |
| 4 | Status | FLAG | The status (Promised) is right, but status_note is out of date. On 29 Sep 2026 PM Andy Burnham promised a National Care Service with "free personal care for older people" in the next parliament, paid for by changing the triple lock from April 2030 (labour.org.uk, "Six things…"). A government spokesperson confirmed it covers over-65s only (Disability News Service, 1 Oct 2026). No official plan, legislation or funding yet, so it is not in_plan. |
| 5 | Cost and funding | FLAG | The high end of 7.0 is a time profile. The Health Foundation says "around £6bn extra in 2026/27, rising to £7bn by 2035/36". £2.7bn and the £4.3bn bank-tax funding match the 2024 press release (costings PDF: £4,250m). The IFS £8.4bn comment is accurately summarised. |
| 6 | Neutrality | PASS | Descriptive. |
| 7 | Legal risk | PASS | None. |

**Suggested corrections:**
- Replace the last clause of status_note with: "On 29 September 2026 Prime Minister Andy Burnham promised free personal care for people over 65 through a National Care Service in the next parliament; it does not cover working-age adults, and no plan, legislation or funding has been published, so the card stays at Promised."
- Consider a separate Burnham card for that pledge.
- Set `how_much_bn_per_year: [2.7, 6.0, 6.6]`, with the high end being the editorial +10% on the Health Foundation's 2026/27 figure. Move "rising to £7bn by 2035/36" into cost_note as growth over time.

---

## 5. uk-green-wealth-tax-2024

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim on PDF p.13, the spread for printed pp.20–21. The text sits in the left half, so p.20 is correct. |
| 2 | Date and venue | PASS | Launch on 12 Jun 2024 (Green press release). |
| 3 | Evidence | PASS | No evidence_url events. The Polanski speech of 18 Mar 2026 has "1% … over £10 million and 2% over £1 billion would raise around £15 billion per year". |
| 4 | Status | PASS | Promised. |
| 5 | Cost and funding | FLAG | £16bn by the end of the Parliament and 22,000 taxpayers match budget-background-v3.pdf p.3–4, and £15bn matches the speech. But the range [-16, -15, -15] has central equal to high and is narrower than the uncertainty the note itself describes. Tax Policy Associates quotes the party's own breakdown as £14bn ("why the Greens think they can raise £14bn"). The Spain €632m (2023) and Wealth Tax Commission points are accurate. |
| 6 | Neutrality | FLAG | Minor: "so the yield is highly uncertain" reads as the card's own verdict. |
| 7 | Legal risk | PASS | None. |

**Suggested corrections:**
- Set `how_much_bn_per_year: [-16.0, -15.0, -14.0]` (all three are party figures) and add "£14bn in the party's 2024 breakdown, as cited by Tax Policy Associates" to cost_note.
- Change "so the yield is highly uncertain" to "and questions whether the yield can be achieved".

---

## 6. uk-snp-two-child-cap-2024

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim on printed p.05 (PDF p.7), "Our key pledges". |
| 2 | Date and venue | PASS | Swinney's launch speech is dated 19 Jun 2024. |
| 3 | Evidence | FLAG | The funded event (Budget 26 Nov 2025: £2.4bn → £3.2bn) is supported. The legislated event is supported: 2026 c.13, Royal Assent "[18th March 2026]". The delivered event's evidence (DWP, 9 Jul 2026) does not mention 6 April or assessment periods. That wording comes from the Act s.1(4). |
| 4 | Status | PASS | Delivered is right. The Act removes the limit and revokes the exceptions, including the non-consensual conception ("rape clause") exception (regs 24A, 24B, Sch 12). Housing Benefit's limit also ended from 6 Apr 2026. DWP's 8 Jul 2026 statistics confirm removal and say it is the final release. |
| 5 | Cost and funding | FLAG | Minor: the figures (-2,365 / -2,815 / -3,235 £m) are correct but sit in "Table 4.1 Budget 2025 policy decisions" (section 5.1), line 6, not "Table 2.1". The ±10% is correctly applied. |
| 6 | Neutrality | PASS | "The change the SNP asked for happened, not who made it" is careful. |
| 7 | Legal risk | PASS | None. |

**Suggested corrections:**
- Delivered event evidence_url: use DWP's "Universal Credit claimants statistics on the two child limit policy, April 2026" (published 8 Jul 2026), which says the policy "was removed in April 2026, taking effect for assessment periods beginning on or after 6 April 2026": https://www.gov.uk/government/statistics/universal-credit-claimants-statistics-on-the-two-child-limit-policy-april-2026/universal-credit-claimants-statistics-on-the-two-child-limit-policy-april-2026
- If the card is already on main, append this as a source instead, because events are append-only.
- Change the cost_source title to "Table 4.1, line 6".

---

## 7. uk-plaid-cost-of-living-2024

| # | Check | Result | Note |
|---|---|---|---|
| 1 | Quote | PASS | Verbatim on PDF/printed p.2, "Introduction By Rhun ap Iorwerth MS". |
| 2 | Date and venue | PASS | Launch on Thu 13 Jun 2024 at the Temple of Peace, Cardiff (partyof.wales). The £4bn HS2 figure appears on pp.3 and 58. |
| 3 | Evidence | PASS | No evidence_url events. |
| 4 | Status | PASS | Unscoreable fits §2: no amount and no date. |
| 5 | Cost and funding | PASS | Parameters are null, as an unscoreable card requires. |
| 6 | Neutrality | FLAG | The status_note says it "names no measure", but the sentence names two broad means: supporting families and devolving powers. Selection risk: this is Plaid's only card and the only unscoreable card in the set, while the other parties are shown by concrete pledges. |
| 7 | Legal risk | PASS | Low. The card avoids the word "slogan". |

**Suggested corrections:**
- In status_note, change "names no measure, amount or date" to "names no specific measure, amount or date".
- Before publishing, add at least one concrete Plaid card, e.g. "Secure the £4bn owed to Wales from HS2" (manifesto p.3), so the party is not represented only by an unscoreable sentence.

---

## Summary

| Card | Checks flagged | Most important issue |
|---|---|---|
| uk-disabled-bus-pass-2026 | none | None. Note that gov.uk dates the page 17 Aug. |
| uk-con-stamp-duty-abolition-2025 | 5 | The [4.5, 9, 9] range mixes current-year and 2029-30 costs. "Today's prices" misreads "current cost". |
| uk-reform-personal-allowance-15k-2026 | 5 | The [17.7, 17.7, 21.1] range is the year-1 to year-5 profile. |
| uk-ld-free-personal-care-2024 | 4, 5 | The status_note missed Burnham's 29 Sep 2026 over-65 free personal care pledge. The £7bn high is a 2035/36 figure. |
| uk-green-wealth-tax-2024 | 5, 6 | The range has central equal to high and leaves out the party's £14bn figure. "Highly uncertain" is unattributed. |
| uk-snp-two-child-cap-2024 | 3, 5 | The delivered event's evidence doesn't show the 6 Apr date; use DWP's 8 Jul 2026 statistics. The table should be 4.1, not 2.1. |
| uk-plaid-cost-of-living-2024 | 6 | Plaid's only card is the set's only unscoreable card (selection balance). "Names no measure" is slightly inaccurate. |
