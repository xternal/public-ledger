# Customer journey maps

A customer journey map (CJM) follows one kind of user from what first prompts them, through the screens they use, to the point where we want them to come back. Each map below is a table. The columns are stages. The rows show what the person does, what the product lets them do and when, what we want them to do, how they feel, what can go wrong, which feature or rule answers it, and which analytics events show that the stage worked. Read down a column to see one moment in full, or across a row to follow one thread, such as every risk. Tags in square brackets say when a capability exists. A tag marks the earliest milestone in `docs/BUILD_PLAN.md`, and later milestones keep it.

| Tag | Meaning |
|---|---|
| [prototype] | Works in `prototype/index.html` today: one page, sample data, nothing is sent or stored. |
| [M0] | The prototype ported to the Next.js app (`apps/web`), plus: fan chart table, self-hosted fonts, track record built from cards, provenance on hover and focus. |
| [M1] | Real OBR, HMT, ONS and Bank of England data, plus a year selector. |
| [M2] | Sandbox complete: scenario links (`?s=`), share page `/s/[hash]`, share image. |
| [M3] | Promise ledger: `/promises`, `/promise/[id]`, `/actor/[id]`, card share images, automatic "deadline missed". |
| [M3b] | Follow and Contribute wired up, plus the editors' triage view. |
| [M4] | Draft cards from Hansard and GOV.UK, made by an LLM and merged only by editors. |
| [M5] | "Who gains and loses" and "people like me". |
| [M5b] | Optional accounts. |
| [M6] | Demography and the long term (`/people`). |
| [M7] | Backtest, public API and CSV, method changelog. |
| [gap] | The journey needs it, but no doc specifies or schedules it. See "Gaps and open questions". |

References: F1–F9 are features in `docs/PRD.md`. "Inv 1–9" are the invariants in `CLAUDE.md`. B, H and "review M" IDs are issues in `docs/PRE_SHIP_REVIEW.md`. For example, review M6 is the Google Fonts issue, not milestone [M6]. A § number without a file points to `docs/PROMISE_STANDARD.md`. The personas come from the PRD users table. The reader who contributes and the follower both come from module 6 (Follow & Contribute). They are mapped separately because they use different screens and we store different data about them (`docs/PRIVACY_AND_ACCOUNTS.md`).

## Overview

| Persona | Job to be done | Entry point | "Aha" moment | Action we want | Metric it moves (README §7, PRD) |
|---|---|---|---|---|---|
| Curious voter | "X said Y on TV. Is it affordable, who pays, what's in it for me?" | Shared link to `/promise/uk-bus-cap-2-2026` | "£17 per household a year, 0.04% of spending, and they named who pays." | Follow the promise | Followers per card and alert click-through. PRD: understands the card in under 30 s |
| Journalist | "I need a cited cost and funding source before my deadline." | `/promises` filters, or a card link | A range, its source and its quality label on one stable URL | Cite the card URL and the primary source | Media citations: 10 in the first quarter |
| Campaigner / think tank | "Show the trade-off: what does 3.5% on defence displace?" | `/sandbox`, preset chip | The Statement redraws and borrowing moves, shown as a range | Share the scenario link (`/s/[hash]`) | PRD: scenario URL shared (no README §7 metric yet, see Gaps) |
| Politician or staffer | "That card mis-parameterises our pledge." | Alert on their actor, or a journalist's question | The standard is public, applies to every party, and a reply sits next to the card | File a right of reply with evidence | Share of cards where the actor used the right of reply |
| Reader who contributes | "I saw a promise on TV last night." / "That bill just passed." | "Send us a promise" (`/submit`) or "Add evidence" on a card | No account needed. They get a reference number, and the source is archived | Send a primary-source link with the time in the video | Accepted community submissions (share of new cards that started as one) |
| Follower | "Tell me when this changes." | Follow button on a card or actor page | An alert saying "Deadline passed: no scheme open" | Confirm the follow, then open the card from alerts | Followers per card and alert click-through |
| Editor (internal) | "Turn this speech into cards fast and consistently." | Triage view, intake pull request, nightly deadline pull request | A draft arrives already archived, with the quote matched and parameters pre-filled | A second editor approves and merges within 72 h | Time from headline to card under 72 h. Costed cards: 100 at launch, 300 after six months |

## 1. Curious voter

Arrives from a shared link to the £2 bus-cap card (Andy Burnham, 22 Jul 2026).

| | Trigger | Arrive | Understand | Explore | Act | Return |
|---|---|---|---|---|---|---|
| **Doing** | Sees the card's share image in a chat or feed | Taps the link and lands on `/promise/uk-bus-cap-2-2026` on a phone | Reads the quote, the "In plan" pill, three numbers and "Paid for by" | Taps "Run in the sandbox" and sees borrowing of about +£0.1bn. Opens `/me` | Taps "Follow this promise" and picks RSS, email or Telegram | Gets an alert and reopens the card's timeline |
| **Can do today / later** | Card share image [M3] | Card in the home-page list [prototype]<br>Own URL [M3] | Ladder, translation strip, funding line, timeline, status note [prototype] | Run in sandbox, bus card only [prototype], any card [M3]<br>Your share [prototype]<br>People like me [M5] | Follow panel, not wired [prototype]<br>Real follow [M3b] | Alerts within 15 min [M3b]<br>Automatic deadline missed [M3] |
| **Should do** | Tap through rather than stop at the image | Read the three numbers first | Open the status note and the sources | Run it in the sandbox to see the net effect | Follow (nudge: button beside the timeline) | Come back on the alert and share the card |
| **Thinking / feeling** | "Is £2 bus fares real or just talk?" | "Not another dense PDF." | "£17 a household. Smaller than I thought." | "So most of it is paid for, not borrowed." | "I want to know if it starts in January." | "They said they'd tell me, and they did." |
| **Pain points and risks** | Image read out of context | Jargon, slow phone | "In plan" reads as a downgrade (H2). Sample cards unsourced (B4) | "Borrowed on top, in your name" may feel loaded (H9). Your share leaves out VAT (H8) | Fear of landing on a political list (B7) | Alert fatigue. Card has changed since they shared it |
| **Product response** | Image carries quote, status, three numbers, funding line (DESIGN_HANDOFF screen 2) | No account to read (inv 9) | Status note cites the standard. Quality labels (inv 1). Ranges (inv 2) | "Rule of thumb" badges (B3). Salary stays in the browser (inv 7). [M0] uses "Plus borrowing on top"; still test H9 wording | Plain consent copy. Only email and followed IDs are stored (inv 7, F7) | Weekly digest (F7). Public version diff (inv 5) |
| **Analytics events** | `share_image_rendered` | `promise_card_viewed` | `quality_badge_opened`, `source_link_clicked` | `run_in_sandbox_clicked`, `your_share_opened` | `follow_panel_opened`, `follow_started` | `promise_card_viewed` (referrer_kind: alert) |

**Moments that matter**
- The first screen of the card: three numbers and the funding line, understood in under 30 seconds.
- "Run in the sandbox": the slogan becomes about +£0.1bn a year of borrowing, shown as a range.
- The first alert that reports a real change, which proves that following is worth it.

**Must never happen**
- A sign-in wall in front of a card, the Statement or the sandbox (inv 9).
- The salary typed into `/me` sent or stored anywhere (inv 7).
- A number without a source and quality label, or a modelled number without a range (inv 1, inv 2).
- A sample or unsourced card shown to the public as a finding (B4).

## 2. Journalist

Needs a cited cost and funding source before the deadline.

| | Trigger | Find | Verify | Extract | Publish | Return |
|---|---|---|---|---|---|---|
| **Doing** | A pledge breaks, with copy due in three hours | Filters `/promises` by actor, area or status, or opens a card link | Checks the quote, sources, archived link, quality labels and `/method` | Takes the range, per-household figure and funding line. Opens "Show as table" | Links the card URL and uses its share image | Follows the card and rereads the timeline before a follow-up |
| **Can do today / later** | Card within 72 h [M3]<br>Faster drafts [M4] | Promise list [prototype]<br>Filters and sort [M3]<br>Text search [gap] | Sources, method section [prototype]<br>Archived URLs [M3b]<br>Vintage changelog [M7] | Sankey table [prototype]<br>Fan chart table [M0]<br>CSV and API [M7] | Card share image [M3]<br>Copy citation, chart download [gap] | Follow [M3b]<br>Version diff [M3] |
| **Should do** | Check the ledger first | Use the card, not the home-page Sankey | Read the quality label and range, not just the central figure | Quote the range with the funding line | Cite the card URL and the primary source | Follow the card for the next story |
| **Thinking / feeling** | "I need a number I can defend." | "Is the card even up yet?" | "Who costed this?" | "A range is hard to fit in a headline." | "My name is on this." | "Has anything moved since I wrote it?" |
| **Pain points and risks** | No card yet for a fresh pledge | Sankey "other" lines are plugs (B1) | Coefficients from model memory (B2). Unsourced sample cards (B4) | Wide tables are awkward on phones | Card changes after the piece runs | A status quoted as a verdict on a person (B6) |
| **Product response** | Headline-to-card target under 72 h (README §7) | Filters by actor, party, status, area, cost band (F4) | Source, vintage and quality on every number (inv 1). Method page (F6) | Ranges everywhere (inv 2). A table for every chart (CLAUDE.md) | Stable card URLs (F4). Append-only versions (inv 5) | Evidence needed for every status (§3). Right of reply shown (F4) |
| **Analytics events** | `card_published` | `promise_list_filtered`, `promise_card_viewed` | `source_link_clicked`, `method_viewed` | `chart_table_opened`, `data_exported` | `promise_card_viewed` (referrer_kind: news) | `follow_started`, `version_diff_opened` |

**Moments that matter**
- Finding a live card with a sourced range before the deadline.
- The source and quality label sit one tap from every number.
- The citation still points to the same words after the card changes, because versions are append-only.

**Must never happen**
- A share image or table that shows a number without its range or quality label (inv 1, inv 2).
- A past version or timeline event edited after someone cited it (inv 5).
- The illustrative "Party A/B/C" track-record table, or any unsourced card, made public (B4).

## 3. Campaigner / think tank

Builds a scenario and shares it. Example: the "Defence to 3.5% of GDP" preset.

| | Trigger | Arrive | Build | Check | Share | Return |
|---|---|---|---|---|---|---|
| **Doing** | A debate asks what 3.5% on defence would displace | Opens `/sandbox` and taps the "Defence to 3.5% of GDP" preset | Moves the VAT, income tax and NHS levers, or toggles a measure and its funding | Reads the borrowing range, per-household figure, prices, GDP, debt path and "What moved" | Copies the `/sandbox?s=` link and posts the `/s/[hash]` image | Reopens the link after data updates and follows related cards |
| **Can do today / later** | Editorial presets [prototype]<br>A preset per card [M3] | Sandbox on home page [prototype]<br>Full-screen sandbox [M2] | 8 levers and bus-cap measure [prototype]<br>More levers [M2]<br>Who gains and loses [M5] | Result tiles, fan chart, mortgage note [prototype]<br>Fan chart table [M0] | Scenario link, share page, image [M2] | Real coefficients [M1]<br>Backtest [M7]<br>Saved scenarios [gap] |
| **Should do** | Start from a preset | Note who controls each lever | Name a funding source, not only a cost | Quote the range and read the badges | Share the link, not a screenshot | Recheck after each data update |
| **Thinking / feeling** | "Numbers will make our case." | "Do I need a login?" | "What if VAT paid for it instead?" | "Will they say the model is rigged?" | "I want the image to do the talking." | "Did the numbers move under us?" |
| **Pain points and risks** | Presets seen as taking sides | Bank Rate looks like a government choice | Straight-line costings over wide ranges (H5). Unverified coefficients (B2) | GDP and price tiles look authoritative (B3). Debt priced at Bank Rate (H4). Debt KPI is static (review M10) | Own scenario read as a Public Ledger finding. Election periods (B5) | Old link shows new data without a note |
| **Product response** | Same preset rule for every actor (inv 6, F2) | "Controlled by" on every lever (inv 3) | Ranges limited and labelled "static, before behaviour" (H5). Golden tests (B2) | Ranges (inv 2). "Rule of thumb" badge until an economist signs off (B3) | Share image shows ranges (F2). Label for user-built scenarios [gap] | Vintage shown on every chart (PRD risks). Pinned vintage [gap] |
| **Analytics events** | None (happens off-site) | `sandbox_opened`, `preset_applied` | `lever_changed` | `chart_table_opened`, `quality_badge_opened` | `scenario_shared` | `scenario_link_opened` |

**Moments that matter**
- The first lever move: the Statement redraws and borrowing changes within 50 ms (F2).
- Seeing who controls a lever. Bank Rate is labelled as the Bank of England's decision, not a decision by politicians.
- A shared link that reopens exactly the same scenario for someone else.

**Must never happen**
- A modelled result shown as a single number (inv 2).
- A lever, preset or default that treats one party differently (inv 6).
- An account needed to build or share a scenario (inv 9, PRD non-goals).
- A scenario where the Statement does not balance (inv 4).

## 4. Politician or staffer

Disagrees with a card and uses the right of reply. Hypothetical example: a staffer argues that the bus-cap card should say "funded". The standard keeps it at "in plan" until money appears in an Estimates line (H2).

| | Trigger | Arrive | Check | Reply | Outcome | Return |
|---|---|---|---|---|---|---|
| **Doing** | A journalist asks about the card, or an alert fires on their actor | Opens `/promise/[id]` and `/actor/[id]` | Compares the quote, parameters, funding and status with their own records. Reads `/method` | Sends a reply with evidence, or uses "Add evidence" for a status change | Sees the reply next to the card with the editor's response. A new version if accepted | Follows their own actor page and sends evidence as delivery moves |
| **Can do today / later** | Follow an actor [M3b] | Card [prototype], card page [M3]<br>Actor page [M3]<br>Track record from cards [M0] | Parameters, sources, status note [prototype]<br>Version diff [M3] | Reply shown on card (F4) [M3]<br>Way to file a reply [gap]<br>Add evidence [M3b] | Reply event on the timeline [M3]<br>Alert to followers [M3b] | Evidence becomes a timeline event [M3b] |
| **Should do** | Go to the card, not to social media | Read the evidence behind the status | Point to one parameter and one source | Attach primary evidence and keep it short | Send new evidence when delivery moves | Follow their own actor page |
| **Thinking / feeling** | "Who runs this, and who funds it?" | "Is this a hit piece?" | "We named the money. Why only 'in plan'?" | "Will our reply be buried?" | "They printed it in full, with their answer." | "Better to feed them evidence than fight them." |
| **Pain points and risks** | Suspicion of bias or foreign funding (B5) | Illustrative party table, unsourced cards (B4) | Status read as an accusation (B6). Parameters as hidden editorial power (PRD risks) | No channel or identity check specified [gap] | 5-day deadline missed, or a rejection without reasons | Belief that other parties get softer treatment |
| **Product response** | Neutral brand, UK entity, published funding (B5) | Track record built only from real cards (B4). No "liar score" (F5) | Public standard and evidence for every status (§2–3). "Funding not stated" is a fact | Reply published next to the card within 5 working days (§5) | An accepted change becomes a new version with a reason (inv 5) | One standard for everyone (inv 6). An editor never approves a card about their own party (§7) |
| **Analytics events** | `alert_sent` | `actor_page_viewed`, `promise_card_viewed` | `version_diff_opened`, `method_viewed` | `reply_received` | `reply_published` | `submission_sent` (kind: evidence) |

**Moments that matter**
- The first look at the card: the evidence for the status is visible, not just asserted.
- The reply appears in full next to the card within 5 working days.
- An accepted reply produces a visible new version, never a silent edit.

**Must never happen**
- A `failed` or `quietly_dropped` status without the evidence the standard requires (B6).
- One party's reply handled faster, slower or differently from another's (inv 6).
- A past version or timeline event rewritten because of a reply (inv 5).
- A change from a reply merged by fewer than two editors (§6).

## 5. Reader who contributes

Sends a new promise or evidence for a card, with no account.

| | Trigger | Arrive | Send | Wait | Outcome | Return |
|---|---|---|---|---|---|---|
| **Doing** | Hears a minister make a pledge on TV, or sees a bill pass | Taps "Send us a promise" (`/submit`) or "Add evidence" on a card | Pastes the link and adds the time in the video, who said it and their words. Email and credit are optional | Gets a reference number (e.g. S-2026-10-0412). Automatic checks run | An editor triages it within 3 working days. Accepted means a draft card or event. Rejected means a reason code | Sees "Started from a reader submission" on the card |
| **Can do today / later** | Add evidence button [prototype] | Form, URL check, nothing sent [prototype]<br>`/submit` wired [M3b] | Spam check, rate limit, dedupe [M3b]<br>Delete my email [M3b] | Reference number, archive, quote match [M3b]<br>Look up by reference [gap] | Status email if email given [M3b]<br>Reason codes [M3b] | Credit by handle [M3b]<br>Submission history [M5b] |
| **Should do** | Note the time in the video | Search for an existing card first | Give a primary source, not a post about it | Keep the reference number | Read the reason code if rejected | Send evidence on cards they care about |
| **Thinking / feeling** | "Someone should keep a record of this." | "Do I have to sign up?" | "Will this put me on a list?" | "Did anyone actually read it?" | "My link became a card." | "I'm helping keep them honest." |
| **Pain points and risks** | The clip is deleted before they send it | Google Fonts and CDN scripts on the prototype's form page (review M6, fixed in [M0]) | Submissions reveal political opinions (B7). Invalid URL or rate limit | No email means no news. Queue backlog | A rejection feels personal. Brigading | No way to see past submissions in v0 |
| **Product response** | Archive snapshot on arrival (PRIVACY_AND_ACCOUNTS) | Self-hosted fonts and no third-party scripts on form pages (inv 7, [M3b]) | Email optional and no IP stored (inv 7). Form error states (DESIGN_HANDOFF) | Triage within 3 working days (§8) | Reason codes. Volume never changes a status (§8). Two editors (inv 8) | Credit is opt-in (F8). Accounts optional (inv 9, [M5b]) |
| **Analytics events** | None (happens off-site) | `submit_form_opened` | `submission_sent`, `submission_blocked` | `submission_auto_checked` | `submission_triaged` | `card_published` (origin: reader_submission) |

**Moments that matter**
- No sign-up wall at the form.
- A reference number straight after sending.
- Seeing "Started from a reader submission" on a live card.

**Must never happen**
- A submission that reaches a public page without the two-editor merge (inv 8).
- An IP address stored, or a submission linked to a person anywhere, including analytics (inv 7, B7).
- Credit shown for someone who did not ask for it (F8).
- The number of submissions changing a status. Only evidence does (§8).

## 6. Follower

Follows a promise, actor, policy area or deadline window, and comes back on alerts.

| | Trigger | Subscribe | Confirm | Alert | Return | Manage |
|---|---|---|---|---|---|---|
| **Doing** | Cares about a card, an actor, an area or "everything due this quarter" | Taps Follow on `/promise/[id]` or `/actor/[id]`, picks a channel and reads the consent copy | Clicks the double opt-in link, or sends `/follow` to the Telegram bot | Gets an alert about a status change, a missed deadline, a rewording, a cost change or a reply | Taps through to the card's timeline | Opens `/follow` from the email link, switches to the weekly digest, or leaves |
| **Can do today / later** | Follow panel, not wired [prototype] | RSS, email, Telegram [M3b]<br>Web push (v1) [gap] | Double opt-in [M3b] | Alerts within 15 min [M3b]<br>Deadline missed [M3] | Timeline with today marker [prototype]<br>Version diff [M3] | Unsubscribe and delete [M3b]<br>Synced follows [M5b] |
| **Should do** | Follow rather than bookmark | Pick a channel they actually read | Confirm straight away | Open the card, not just the alert | Share the change or run it in the sandbox | Choose the digest rather than unsubscribe |
| **Thinking / feeling** | "I'll forget to check back." | "What do they keep about me?" | "Another email to confirm." | "So the deadline passed and nothing started." | "Glad someone's keeping track." | "Easy to leave if I want to." |
| **Pain points and risks** | A follower count reads as a popularity vote | Follows reveal political opinions (B7). DPIA still open | Confirmation lost in spam | Too many alerts on a busy card | "Deadline missed" read as "dropped" before an editor confirms | A delete that does not really delete |
| **Product response** | Aggregate count only, hidden below 50 (F7) | Explicit consent. Email and followed IDs only, encrypted (inv 7) | Plain confirmation copy (DESIGN_HANDOFF screen 8) | Weekly digest. No tracking pixels or click tracking (F7) | `quietly_dropped` needs an editor's confirmation after 30 days (§3) | One-click unsubscribe and real delete (F7) |
| **Analytics events** | `follow_panel_opened` | `follow_started` | `follow_confirmed` | `alert_sent` | `promise_card_viewed` (referrer_kind: alert) | `digest_chosen`, `unsubscribe_completed`, `data_deleted` |

**Moments that matter**
- The consent screen says in plain words what is stored and what is not.
- The first alert reports a real change, such as a deadline passing with no scheme open.
- Leaving takes one click and really deletes the data.

**Must never happen**
- Showing anyone who follows what, or showing a follower count below 50 (inv 7, F7).
- Tracking pixels or per-person click tracking in alerts (PRIVACY_AND_ACCOUNTS).
- Follow lists shared, sold or used for ads (PRIVACY_AND_ACCOUNTS).
- An account needed to follow (F7, inv 9).

## 7. Editor (internal)

Takes a promise from intake, through the two-editor merge, to a live card, then keeps its timeline up to date.

| | Intake | Triage | Draft | Review | Publish | Maintain |
|---|---|---|---|---|---|---|
| **Doing** | Watches the news, the submissions queue and LLM draft pull requests | In the triage view, checks whether the source is archived, the quote matched or it is a duplicate. Accepts or rejects with a reason | Checks the quote against the primary source. Fills who, how much, when and from where. Sets the status from evidence | A second editor reviews the pull request. CI checks sources, parameters and append-only history | Merges. The card goes live, the share image builds and alerts go out | Reviews the nightly deadline-missed pull request, confirms `quietly_dropped` after 30 days and answers replies |
| **Can do today / later** | Manual card in a pull request [M3]<br>Submissions [M3b]<br>LLM drafts [M4] | Triage view, accept makes a draft pull request [M3b] | Schema and CI validator [M3]<br>LLM pre-fill [M3b] | Two-editor merge via pull request [M3] | Share image [M3]<br>Alerts [M3b] | Deadline missed [M3]<br>Reply and 30-day tools [gap]<br>Backtest [M7] |
| **Should do** | Aim for under 72 h from headline to card | Reject with a reason code, never in silence | Use the actor's figure plus an independent range. Write "Funding not stated" if nothing was named | Recheck the quote and evidence, not only the format | Check the share image numbers and funding line | Confirm or clear every missed deadline |
| **Thinking / feeling** | "Three speeches today and two of us." | "Is this a promise or an opinion?" | "Is it 'in plan' or 'funded'?" | "Am I harder on one side?" | "This will be quoted. Is it right?" | "Silence is a finding, but only with evidence." |
| **Pain points and risks** | LLM invents quotes or follows injected text (H10) | Brigading. A backlog breaks the 3-day promise | Disputed status calls (H2). Cost unknown (B4) | Too few second editors. Pull requests are hard for non-technical editors | Defamation from status wording (B6). Election periods (B5) | Workload of 30-day checks, replies and audits |
| **Product response** | Exact-match quotes with offsets. Never auto-merge (H10, [M4]) | Reason codes, dedupe and rate limits (§8) | Four parameters and evidence for every status (§2–3) | Two-person rule. CI blocks a missing source (§6, F4) | Legal review of status templates. Every source archived (B6) | Append-only history (inv 5). 5% external audit (§6) |
| **Analytics events** | `draft_created`, `intake_candidate_dropped` | `submission_triaged` | `ci_check_failed` | `draft_approved` | `card_published`, `alert_sent` | `deadline_missed_appended`, `status_changed`, `reply_published` |

**Moments that matter**
- A draft arrives already archived, with the quote matched, so the editor checks rather than types.
- The second editor's approval is the only way to publish.
- "Deadline missed" makes silence visible, and an editor confirms it with evidence.

**Must never happen**
- A merge with one editor, or an automatic merge from intake (inv 8, [M4]).
- A past version or timeline event rewritten (inv 5).
- A status set without the evidence the standard requires (B6).
- A different rule or speed for any party, including one an editor belongs to (inv 6, §7).

## Analytics plan

The goal is to see whether each stage works without learning anything about any person. Events count what happened to content (a card, a lever, a preset). They never record who did it.

Property values are limited to:
- content IDs: `promise_id`, `actor_id`, `lever_id(s)`, `preset_id`, `chart_id`;
- fixed lists: `unit`, `status`, `referrer_kind` (shared_link, social, search, news, alert, rss, internal, direct), `device_class` (phone, tablet, desktop), `channel`, `target_kind`, `kind`, `outcome`, `reason_code`;
- counts and durations.

There is never free text, and never a salary, email, Telegram ID or IP.

### Event catalogue

| Event | Fired when | Properties | Funnel | README §7 metric it feeds | Screen exists from |
|---|---|---|---|---|---|
| `share_image_rendered` | A platform or browser fetches a card or scenario share image | kind, promise_id or preset_id | A | Reach of the share loop | [M2], [M3] |
| `promise_card_viewed` | `/promise/[id]` loads | promise_id, status, referrer_kind, device_class | A, B | Alert click-through. Media citations (proxy: referrer_kind news) | [M3] |
| `statement_viewed` | `/` or `/statement/[year]` loads | referrer_kind, device_class | None | None (reading base) | [prototype], [M1] |
| `unit_changed` | Unit toggle used | unit | None | None | [prototype] |
| `quality_badge_opened` | Quality label tapped or focused | quality | None | None (trust signal) | [prototype] |
| `source_link_clicked` | Source link on a card opened | promise_id | None | Media citations (proxy) | [prototype] |
| `chart_table_opened` | "Show as table" used | chart_id | None | Media citations (proxy) | [prototype], [M2] |
| `method_viewed` | `/method` loads | section | None | None | [prototype] |
| `promise_list_filtered` | A filter is applied on `/promises` | filter_kind | None | None | [M3] |
| `version_diff_opened` | Version diff opened on a card | promise_id | E | Right-of-reply share (context) | [M3] |
| `actor_page_viewed` | `/actor/[id]` loads | actor_id, referrer_kind | E | Right-of-reply share (context) | [M3] |
| `your_share_opened` | `/me` loads. No values are ever sent | device_class | None | None | [prototype] |
| `run_in_sandbox_clicked` | "Run in the sandbox" on a card | promise_id | A | None | [prototype] |
| `data_exported` | API or CSV download | dataset, format | None | Media citations (proxy) | [M7] |
| `sandbox_opened` | `/sandbox` loads | referrer_kind, device_class | A | Scenario shares (proposed, see Gaps) | [M2] |
| `preset_applied` | Preset chip tapped | preset_id | A | Scenario shares (proposed) | [prototype] |
| `lever_changed` | A lever is released (once per lever, not per tick) | lever_id | A | Scenario shares (proposed) | [prototype] |
| `scenario_shared` | Share link copied or share button used | lever_ids, preset_id | A | Scenario shares (proposed) | [M2] |
| `scenario_link_opened` | `/sandbox?s=` or `/s/[hash]` opened | lever_ids, referrer_kind | A | Scenario shares (proposed) | [M2] |
| `follow_panel_opened` | Follow button tapped | target_kind | B | Followers per card (context) | [prototype] |
| `follow_started` | Channel chosen and consent given (server count) | target_kind, channel | B | Followers per card | [M3b] |
| `follow_confirmed` | Double opt-in done, or bot follow (server count) | target_kind, channel | B | Followers per card | [M3b] |
| `alert_sent` | One alert batch goes out for one change | promise_id, change_type, channel, recipients_total | B, E | Alert click-through (denominator) | [M3b] |
| `digest_chosen` | Cadence switched to weekly | channel | B | Alert click-through (fatigue) | [M3b] |
| `unsubscribe_completed` | Unsubscribe done | channel | B | Followers per card | [M3b] |
| `data_deleted` | "Delete my data" done | kind (subscriber, submitter) | B, C | None (privacy check) | [M3b] |
| `submit_form_opened` | `/submit` or the contribute form is served (server count) | kind, entry (nav, card_button, direct) | C | Accepted submissions | [prototype], [M3b] |
| `submission_sent` | Submission accepted by the server | kind | C | Accepted submissions | [M3b] |
| `submission_blocked` | Form error | reason (invalid_url, rate_limited, spam_check) | C | Accepted submissions | [prototype], [M3b] |
| `submission_auto_checked` | Automatic checks finish | kind, archived, quote_matched, duplicate | C | Accepted submissions | [M3b] |
| `submission_triaged` | Editor accepts or rejects | kind, outcome, reason_code, days_to_triage | C | Accepted submissions | [M3b] |
| `draft_created` | A draft card pull request opens | origin (submission, llm_intake, manual) | C, D | Headline to card under 72 h | [M3], [M4] |
| `intake_candidate_dropped` | LLM candidate dropped for lack of an exact quote match | reason | D | Headline to card under 72 h | [M4] |
| `ci_check_failed` | Validator blocks a pull request | rule | D | Costed cards | [M3] |
| `draft_approved` | Second editor approves | hours_in_review | D | Headline to card under 72 h | [M3] |
| `card_published` | A merge adds a new card | promise_id, origin, status, costed, hours_to_card | C, D | Headline to card. Costed cards. Accepted submissions | [M3] |
| `status_changed` | A merge changes a status | promise_id, from_status, to_status | B | Followers per card (alert source) | [M3] |
| `deadline_missed_appended` | Nightly job adds the event | promise_id | B | Alert click-through (alert source) | [M3] |
| `reply_received` | A right of reply reaches the editors | promise_id | E | Right-of-reply share | [gap] |
| `reply_published` | Reply merged next to the card | promise_id, editor_response, working_days_to_publish | E | Right-of-reply share | [M3] |

`hours_to_card` counts from the statement date (`made_on`) to the merge. Per-card follower totals come from the subscription store, not from events (see rule 6).

### Funnels

Each funnel is worked out as a ratio of daily or weekly totals at each step. It does not follow one visitor from step to step.

- **A. Share to sandbox:** `share_image_rendered` → `promise_card_viewed` (referrer_kind shared_link or social) → `run_in_sandbox_clicked` → `scenario_shared` → `scenario_link_opened`.
- **B. Follow and return:** `promise_card_viewed` → `follow_panel_opened` → `follow_started` → `follow_confirmed` → `alert_sent` → `promise_card_viewed` (referrer_kind alert or rss).
- **C. Contribute to card:** `submit_form_opened` → `submission_sent` → `submission_auto_checked` (quote matched) → `submission_triaged` (accepted) → `card_published` (origin reader_submission).
- **D. Headline to card:** `draft_created` → `draft_approved` → `card_published`, with the share of cards under 72 h.
- **E. Right of reply:** `reply_received` → `reply_published` within 5 working days, plus cards with at least one reply as a share of live cards.

### Privacy rules for analytics

1. **First-party and cookieless.** Events go to our own endpoint on our own domain. No cookies, no stored visitor IDs and no fingerprinting, so reading pages need no cookie banner (LEGAL to confirm).
2. **No identity at all.** No user, session, account or device ID, even hashed. No IP address, raw or hashed, is kept with events. No full referrer URL is stored: it is turned into `referrer_kind` and then dropped.
3. **Aggregate only.** Events are stored as counts per day for each combination of properties. Raw rows are deleted once counted (suggested: within 24 hours, LEGAL to confirm). Funnels compare totals, never the path of one person.
4. **No third-party scripts on pages with forms.** This covers `/submit`, `/follow`, the contribute form and the follow channel chooser. These pages also run no analytics script. They are counted on the server from the request itself (inv 7, PRIVACY_AND_ACCOUNTS).
5. **No events tied to an identity.** Analytics never read or join the subscription, submission or account stores. There is no third-party analytics on signed-in pages ([M5b], PRIVACY_AND_ACCOUNTS).
6. **Follows and submissions as totals only.** Follow and submission events carry no promise, actor or area ID, so they can never be matched back to a subscriber by time and target. Per-card follower totals come from the subscription store and are shown, inside the team too, only at 50 or more (F7).
7. **Alerts carry no tracking.** No pixels and no per-recipient link tokens. Every alert link carries the same fixed tag (for example `via=alert`), so a click counts as `referrer_kind: alert` and nothing more (F7).
8. **Salary never leaves the browser.** `your_share_opened` carries no values (inv 7).
9. **Analytics never change a finding.** Views, follows and submission counts are never evidence for a status (§8, PRIVACY_AND_ACCOUNTS).
10. **The DPIA covers analytics** as well as follows and submissions (B7).

### Open question for product: which analytics stack?

We do not pick a vendor here. Whatever we choose must:
- be first-party or self-hostable;
- run cookieless, with no consent banner on reading pages;
- count server-side for form pages;
- store aggregates only;
- keep no IPs, including in host and CDN logs;

Owner: product, with ENG and LEGAL.

## Gaps and open questions

| # | Gap or question | Journeys affected | Suggested owner |
|---|---|---|---|
| 1 | How an actor or their office files a right of reply, and how we check they speak for that actor. No milestone builds reply intake (F4 lists the reply, the M3 prompt does not) | Politician, editor | LEGAL, ED, ENG |
| 2 | Whether actors get notice before a `failed` or `quietly_dropped` status goes live | Politician, editor | LEGAL, ED |
| 3 | Empty and error states beyond the two listed: no card yet for a fresh pledge, an actor with no cards, a follow with no changes yet, an empty triage queue, a sandbox link from an old data vintage | All readers | DES |
| 4 | Text search on `/promises`. Only filters are specified | Journalist, contributor | DES, ENG |
| 5 | Citation tools: copy citation, chart download or embed, a permalink to one version of a card | Journalist | DES, ENG |
| 6 | Share page labelling that marks a user-built scenario as not a Public Ledger finding, and rules for election periods | Campaigner | DES, LEGAL |
| 7 | Whether an old `?s=` link reruns on new data or pins the vintage it was made with | Campaigner, journalist | ENG, ECON |
| 8 | Checking a submission's status by reference number without an email, and the wording of rejection notices | Contributor | ENG, ED |
| 9 | Editor tooling for replies and 30-day `quietly_dropped` checks, and a path for non-technical editors before the move to Postgres | Editor | ENG, ED |
| 10 | Analytics has no milestone in BUILD_PLAN. The DPIA scope and IP retention in host logs are unstated | All | ENG, LEGAL |
| 11 | Alert click-through is a README metric, but email click tracking is disabled. Confirm the fixed `via=alert` tag is acceptable | Follower | LEGAL, ENG |
| 12 | No README metric for scenarios built or shared. Media citations need manual monitoring, because referrer data is only a proxy | Campaigner, journalist | ED, ENG (product decides) |
| 13 | Who counts as a "verified member" for "cost this next" voting in the UK pilot. A link to a party member registry may clash with the neutral brand (B5) | Contributor | LEGAL |
| 14 | Web push (v1), the `/line/[node]` drill-down with related promises, and a public submission credit for evidence (not only new cards) have no milestone | Voter, follower, contributor | ENG, DES |
