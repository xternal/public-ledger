# Promise standard v0

The rules that turn a sentence into a card. Published, versioned, applied to every actor in the same way.

## 1. What counts as a promise

A statement by a person or organisation with power or seeking it, that commits to a **future, checkable change**. In: "We will cap bus fares at £2 from January." Out: descriptions of the past, opinions, predictions about others' behaviour.

Intake sources: manifestos, ministerial statements, speeches, debates (Parliament and TV), interviews, official social media accounts.

## 2. The four parameters

| Parameter | Question | Example (bus cap) |
|---|---|---|
| **Who** | Who benefits / pays? | Bus passengers in England |
| **How much** | £ per year, range | £0.45–0.6bn |
| **When** | Start date and/or deadline | From 1 Jan 2027 |
| **From where** | Funding named at announcement? | £400m climate finance → loans; DESNZ savings; existing DfT money |

Rules:
- Use the actor's own figure if given, plus an independent range. If they gave none, use the best official costing (OBR, HMRC, department) or a documented T0 estimate.
- Every cost says who made its central figure, as `costed_by: { kind, name }` on the version:
  - `official`: the OBR, HMRC, HM Treasury or another UK government department (No 10 included), or a devolved government's equivalent.
  - `party`: the promise-maker's own figure: a party's or candidate's costing, including a figure a party commissions or adopts as its own.
  - `independent`: anyone else: the IFS, think tanks, academics, Tax Policy Associates, campaign groups and the like.
  - `name`: the maker as a reader would say it ("OBR", "HM Treasury", "Labour Party", "IFS").
  - The kind follows who made the figure, not who made the promise. A figure a government department publishes is `official` even when the government made the promise; a figure a party made is `party` even when that party is now in government (Labour's 2024 manifesto costings stay `party`). A minister or Prime Minister speaking for the government (in Parliament, on GOV.UK) gives an `official` figure; the same person speaking for their party (a conference speech, a manifesto) gives a `party` one.
  - If the low, central and high figures come from different makers, `costed_by` follows the central figure; `cost_note` explains the rest.
  - A new figure from a different maker is a correction to `costed_by`, recorded with the cost (§9).
- "From where" is recorded exactly as stated. If nothing was stated: `funded_by: null` and the card shows **"Funding not stated"**. That is a fact about the promise, not a judgement.
- A promise missing two or more of who / how much / when, and not inferable from official documents within 7 days, gets status **unscoreable**. Shown as such. It is a slogan.

## 3. Status ladder

```
promised → in_plan → legislated → funded → delivering → delivered
                                           ↘ failed
           (any stage) ↘ quietly_dropped
unscoreable (separate)
```

| Status | Evidence required |
|---|---|
| promised | Primary source of the statement (video/transcript/document), archived |
| in_plan | Official plan, white paper, departmental plan naming it |
| legislated | Bill passed / statutory instrument made (link to legislation.gov.uk) |
| funded | Money allocated in a Budget, Spending Review or estimates line |
| delivering | Started: scheme open, payments flowing, contracts signed |
| delivered | Outcome met as worded (partial delivery stays `delivering` with a note) |
| failed | Deadline passed and evidence shows it was not met, or officially abandoned |
| quietly_dropped | Deadline passed, no official statement, no evidence of delivery. Auto-flagged by `deadline_missed`, confirmed by an editor after 30 days |

Readers see neutral labels that state the fact, never a verdict on a person: `failed` reads **Not met** and `quietly_dropped` reads **Undone**. The ids stay as they are in the data.

## 4. Rewording

If the actor restates the promise with different terms, add a `PromiseVersion` and a `reworded` event. The card shows a diff (e.g. "2023: £2 cap → 2025: £3 cap → 2026: £2 cap"). Rewording is not failure, but it is visible.

## 5. Right of reply

Any actor (or their office) may dispute a card's parameters. The reply is published next to the card within 5 working days with the editor's response. If the editor accepts, a new version of the parameters is recorded with the reason.

## 6. Editorial process

1. Intake (manual or LLM draft from transcript) → draft card in a pull request. LLM drafts (`content/drafts/`) quote only words found exactly in the stored source, are never published, and each one becomes a card or is deleted before the pull request merges.
2. Editor checks quote against primary source, fills parameters, cites costings.
3. Second editor approves. Two-person rule for every merge.
4. Publish. Nightly job appends `deadline_missed` where due.
5. Quarterly audit: random 5% sample re-checked by an external reviewer.

## 7. Conflicts of interest

Editors declare party membership. An editor never approves a card about their own party; another editor or an external reviewer does.

## 8. Reader submissions

1. Anyone can send a new promise or evidence for an existing card (`PRIVACY_AND_ACCOUNTS.md`).
2. Automatic checks: URL reachable, archived snapshot, transcript exact-match where available, duplicate detection, LLM pre-fill.
3. An editor triages within 3 working days: accept → draft card or new timeline event in a pull request; reject with a reason code (no primary source, not a promise, duplicate, out of scope).
4. Same two-editor rule as any other card. Submission volume never changes a status; only evidence does.
5. Submissions about an editor's own party are reviewed by another editor or an external reviewer, as in §7.
6. Contributor credit only when requested.

## 9. Corrections

History is append-only, but our own mistakes must be fixable. A correction fixes an error *we* made in a version, event or reply: a wrong date, a misread figure, a cost range that was really a time profile, a note that says more than its source. It is not for changes in the world; those are new events or new versions (§3, §4).

1. Change the field, and in the same pull request append an entry to the card's `corrections`: `date`, `path` (e.g. `versions[0].parameters.how_much_bn_per_year`, `events[3].date`), `was`, `now`, `reason`, and a `source_url` when a source shows the right value.
2. CI accepts the change only if undoing the recorded corrections gives back exactly the published entry, and the card's field equals the correction's `now`. Existing corrections never change.
3. The card shows every correction ("Corrected on 7 October 2026: cost range in version 1 …", with the old and new values). Nothing is overwritten silently.
4. A wrong quote is corrected the same way, and the quote check is redone and `quote_checked_on` updated.
5. Fields that describe the present (`status_note`, `outcome_by`, top-level `sources`) are kept current by ordinary edits; they are not history.
6. Same two-editor rule as any other change.
7. A field added to this standard after a version was published (so far only `costed_by`, 9 October 2026) may be filled in once on that version without a correction, because nothing published is changed. Once it has a value it is history like the rest.

## 10. Contracts behind delivery

Once a card is `funded`, `delivering` or `delivered`, it can list the public contracts that carry the promise out: who won, how many bid, and how the value and end date have moved since the first notice.

1. An editor links contracts by hand, in the card's `contracts`: the contract's OCID from Find a Tender (`ocds-h6vhtk-…`), or `{ ocid, notice_url }` for Contracts Finder, with `award_id` when a procurement awarded several contracts. Nothing is matched automatically.
2. A contract is linked only when its notice, or an official page about the award, ties it to the promised programme by name or by its funding. Being on the same subject is not enough.
3. The nightly job reads every linked contract's open data and appends a snapshot when the value or an end date changes. Snapshots are append-only: CI rejects an edited one, and a contract file is never deleted.
4. The same two-editor rule applies to adding or removing a link.

## 11. Who has to deliver it

Every card says which body would have to act to deliver the promise as worded, as of now: `outcome_by`. It is what tells a reader whether a missed deadline belongs to someone in power.

1. `outcome_by` names a body by its role, never a party or a person: `hm-government`, the Scottish or Welsh Government, a council, a mayoral authority or a public body (an actor of kind `government`). CI rejects a party or a person.
2. It is set when a body in power is committed to delivering the promise as worded: because the person or party who made it now leads or speaks for that body, or because the body has taken it on in its own plan, programme or announcement.
3. It is `null` when no body in power is committed to it: an opposition party's pledge, a candidate's, or a pledge that the body able to deliver it has not taken on (for example a devolved party's pledge on a tax set at Westminster). A narrower or different commitment by the government does not count; the card's status note can mention it.
4. The same rule for every party. When power changes hands, the field follows the role, not the party: an opposition pledge the new government adopts gets `hm-government`; a pledge the new holders of power have not taken on becomes `null`, with the change explained in the status note.
5. Once a card reaches Delivered, Not met or Undone, `outcome_by` stays as the body that was responsible then.
6. Every card has it, a value or an explicit `null`; CI fails a card that leaves it out. It describes the present, so it is kept current by ordinary edits (§9.5), with the same two-editor rule.
7. It is not credit. When someone other than the card's own actor brought about an outcome (an opposition pledge the government carried out), `brought_about_by` records that, as before (it was called `outcome_by` until 9 October 2026).

## Changes to this standard

- 9 October 2026: who made a cost's central figure (`costed_by`, §2); who has to deliver a promise (`outcome_by`, §11); the credit field renamed `brought_about_by`; filling in a newly added field (§9.7).
