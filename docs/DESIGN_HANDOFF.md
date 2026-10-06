# Design handoff brief

For a product designer (or a design pass by Claude). The clickable prototype `prototype/index.html` is the baseline: interaction model and information hierarchy are agreed; visual polish, mobile and share formats are open.

## Product in one line

The annual report of the country for its 69 million shareholders, with a calculator next to every page and a credit history for every promise.

## Design principles

1. **Ten-second read.** The Statement must be understood without reading any text, like the Alphabet and Amazon income-statement Sankeys: big flows, few labels, one number per node.
2. **The gap is the protagonist.** Borrowing and debt interest share one colour and a hatched texture. Every screen should make the gap visible, because "where does the money come from" is the question we exist to answer.
3. **Ranges are visual.** Fans, bands and "£0.45–0.6bn" strings. No component may display a modelled number without its range.
4. **Provenance is one glance away.** Quality badge (sourced / approx / modelled / training) on hover/focus of every number; source link one tap away.
5. **Neutral voice.** No red-for-bad on actors. Red means spending, amber means borrowing, green means income-side improvement only in deltas.
6. **Lever ownership.** Every lever shows who controls it (Government, Bank of England, demography).

## Information architecture

```
/                       Statement (current year) + Sandbox dock + headline promise cards
/statement/[year]       Full Statement, year selector, drill-down drawer
/line/[node]            One budget line: trend, sub-lines, related promises
/sandbox?s=…            Sandbox full screen; shareable scenario
/s/[hash]               Share page for a scenario (OG image)
/promises               Ledger: filters, sort, overdue view
/promise/[id]           Card page (OG image)
/actor/[id]             Credit history
/me                     Your share calculator (client-side)
/submit                 Send a promise or evidence (no account)
/follow                 Manage alerts (from email link; no account)
/account                v1: follows, submissions, handle, delete
/method                 Methodology, sources, data vintages, changelog
```

## Screens to design (priority order)

1. **Home / Statement** desktop + mobile. Mobile uses ranked bars (implemented in the prototype); refine tap-to-expand into sub-lines.
2. **Promise card page** and its **OG image** (1200×630). The OG image carries: quote, actor + date, status pill, three numbers (£/yr, per household, share of spending), "Paid for by: …" or "Funding not stated". This is the main growth surface.
3. **Sandbox** desktop dock + mobile bottom sheet with lever groups (Taxes, Spending, Rates, Measures), presets row, result summary sticky.
4. **Scenario share page** + OG image ("If VAT went to 22%: −£17bn borrowing, +1.2pp on prices, …").
5. **Actor page**: credit-history stack bar, list, total pledged vs funded.
6. **Line drill-down drawer**.
7. **Method page**.
8. **Follow flow**: button on card and actor page → channel choice (RSS, email, Telegram) → consent copy that says plainly what we store → confirmation; email templates for an alert and a weekly digest; manage/unsubscribe page.
9. **Contribute flow**: "Send us a promise" and "Add evidence" forms (prototype has a first version), confirmation with reference number, status email, "Started from a reader submission" credit on cards.
10. **Editor triage view** (internal): queue, auto-check results (archived, quote matched/not), accept/reject with reason codes.

## Components and states

| Component | States / variants |
|---|---|
| KPI strip | default, scenario-changed (value highlighted + delta) |
| Sankey | base, scenario (delta labels on changed nodes), focus on node, units: £bn / per household / pence |
| Lever slider | at base, changed (amber value), disabled (not applicable to year), with "controlled by" note and quality badge |
| Measure toggle | off, on + funding select |
| Preset chip | idle, active |
| Result tile | neutral, up (worse), down (better), with range line |
| Fan chart | baseline dashed, scenario solid + band |
| Promise card (list) | each status; with "needs editor check"; with "overdue" |
| Status ladder | linear stages; terminal states; unscoreable variant |
| Timeline | event types: promised, reworded, funded, legislated, delivered, deadline, deadline_missed (auto), reply, today marker |
| Quality badge | sourced, approx, modelled, training |
| Empty states | no promises match filters; scenario with no changes |
| Follow button | not following, following, channel chooser open |
| Submission form | empty, invalid URL, sending, sent (reference number), rate-limited |
| Follower count | hidden (<50), shown |
| Quality badge `plug` | dashed red; used only in internal builds |

## Visual direction

Modern, clean, informational. Think public data product (Our World in Data, Linear, Stripe docs, FT data pages), not a poster or an "AI-generated" landing page.

- White page, one neutral grey scale, hairline dividers instead of boxes. Boxes only for controls (sandbox) and forms.
- One typeface (Geist) for everything, tabular figures for numbers. No monospace, no uppercase letter-spaced labels, no eyebrow kickers.
- Numbers carry the weight: large, semibold, tight tracking. Labels are small, grey, sentence case.
- Three data colours only: income blue, spending neutral grey, borrowing & debt interest orange (hatched for borrowing). Red/green only for deltas and statuses.
- Quality shown as a small coloured dot + word, not as an outlined badge.
- No middle-dot (·) separators anywhere in the UI. Separate items with layout (gap, alignment, line breaks) or plain punctuation (comma).
- Sticky translucent top bar with section links; the sandbox and the promise detail panel are sticky on desktop.
- Mobile: the Sankey becomes two ranked bar lists ("Where it came from" / "Where it went") with a total row between them. The prototype implements this below 720px.

## Tokens (from the prototype)

| Token | Light | Dark |
|---|---|---|
| bg / surface | `#FFFFFF` | `#09090B` |
| sunk (control surfaces) | `#F5F5F6` | `#141417` |
| line / line-strong | `#E7E7EA` / `#D4D4D8` | `#232328` / `#33333A` |
| ink / muted / faint | `#0B0B0D` / `#61616B` / `#9A9AA3` | `#F4F4F5` / `#A1A1AA` / `#6B6B74` |
| accent, income | `#2457F5` | `#6F93FF` |
| spending | `#52525B` | `#A1A1AA` |
| borrowing & interest | `#F2600C` | `#FF7A2E` |
| good / warn / bad | `#15803D` / `#B45309` / `#DC2626` | `#4ADE80` / `#FBBF24` / `#F87171` |

- Type: Geist 400–700 (self-host in production). Scale: 46 / 28 / 22 / 17 / 15 / 13 / 12. Big numbers 26–28px, weight 600, tracking −0.03em.
- Radius: 8px controls, 12px panels, pills for chips and statuses. Shadows: none except the active segmented control.
- Spacing: 64px between sections, 40px column gaps, 24px inside panels.

## Copy rules

Plain British English. "Borrowing", not "PSNB". "Debt interest", not "net interest on PSND". Every number with unit and period. Promise quotes verbatim, in quotation marks, with date and venue.

## Accessibility

WCAG 2.1 AA contrast in both themes; charts have a table view; sliders operable by keyboard with value announced; colour is never the only signal (borrowing is also hatched; statuses also have text).

## Deliverables

- Figma (or Claude Design canvas) with the 7 screens × desktop/mobile, light/dark.
- Component sheet with states above.
- OG templates for promise and scenario.
- Updated tokens file if anything changes → `apps/web/styles/tokens.css`.
