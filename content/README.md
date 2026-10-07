# Content

One YAML file per promise card (`promises/<id>.yaml`) and per actor (`actors/<id>.yaml`).
Rules: `docs/PROMISE_STANDARD.md`. Schema: `packages/schema/src/content.ts`. Checked by `pnpm validate`.

- **Append-only.** Never edit or remove an existing entry in `versions` or `events`. Rewording adds a version and a `reworded` event; a status change adds an event. CI compares every card with `main` and fails on any edit, unless the edit fixes our own mistake and a `corrections` entry records it (`docs/PROMISE_STANDARD.md` §9). The card shows every correction.
- **Verbatim quotes.** `versions[].text` is copied exactly from `source_url`, and `quote_checked_on` records when someone confirmed it there.
- **Evidence.** Every status event except `promised`, `deadline` and `deadline_missed` needs an `evidence_url`.
- **Two editors** approve every pull request that touches this folder.

## Drafts (`drafts/<date>/`)

Automatic intake (`pnpm harvest`, run daily by `.github/workflows/harvest.yml`) writes one draft per candidate promise to `drafts/<date>/<date>-<source id>-<n>.yaml`, and the text of each source it quotes, byte for byte, to `drafts/<date>/sources/<source id>.txt`. They arrive in a draft pull request labelled `intake`, one per day. Schema: `packages/schema/src/drafts.ts`.

- **Not published.** The site never reads drafts. A draft is a suggestion: who said it is only as sure as `speaker.check` says, and every `suggested` field is unverified.
- **The quote is exact.** `quote` is exactly the characters at `source_span` in the stored source text. `pnpm validate` re-checks every draft and fails on any difference, so no invented quote can reach a card.
- **Resolve every draft before merge.** For each one: check the quote at `source.url`, then write a full card in `promises/` (the quote goes in `versions[0].text`, `origin: llm_intake`, `quote_checked_on` set when you checked it; fill the four parameters from the source, using `suggested` only as a pointer), or delete the draft. Delete `drafts/<date>/` with its `sources/` folder when it is empty. Nothing in `drafts/` is ever merged: CI fails while any draft is left, so the pull request turns green only when every draft is resolved.
- **Two editors**, as for every card. The pull request merges only when editors are done: two different people have approved it and CI is green on its latest commit, which means no draft is left (`.github/workflows/intake-merge.yml`; the repository variable `INTAKE_APPROVALS` changes the number). A model never merges anything.
- **Your own transcript:** `pnpm harvest -- upload --url <page> --title "…" --date YYYY-MM-DD --venue speech --file transcript.txt [--speaker "Name"]` (or `--youtube <url>` for captions) writes drafts the same way.
