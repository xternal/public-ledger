# Content

One YAML file per promise card (`promises/<id>.yaml`) and per actor (`actors/<id>.yaml`).
Rules: `docs/PROMISE_STANDARD.md`. Schema: `packages/schema/src/content.ts`. Checked by `pnpm validate`.

- **Append-only.** Never edit or remove an existing entry in `versions` or `events`. Rewording adds a version and a `reworded` event; a status change adds an event. CI compares every card with `main` and fails on any edit.
- **Verbatim quotes.** `versions[].text` is copied exactly from `source_url`, and `quote_checked_on` records when someone confirmed it there.
- **Evidence.** Every status event except `promised`, `deadline` and `deadline_missed` needs an `evidence_url`.
- **Two editors** approve every pull request that touches this folder.
