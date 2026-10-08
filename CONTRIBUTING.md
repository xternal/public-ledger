# Contributing to Public Ledger

Thank you. There are three ways to help, from the easiest. And we are looking for **volunteer editors**, who check promise cards against their sources: about two hours a week, no coding ([ledgergov.uk/editors](https://ledgergov.uk/editors)).

## 1. Send a promise, evidence or a correction

Use the forms on the site: [Contribute](https://ledgergov.uk/#contribute), or "Add evidence" on any promise card. No account and no GitHub needed. What you send goes to the editors as a draft; nothing is published until two editors have checked it against the [promise standard](docs/PROMISE_STANDARD.md).

## 2. Edit a promise card

Each promise is a YAML file in `content/promises/`, each person or party one in `content/actors/` (format: `content/README.md`). Open a pull request that changes one card, with a link to the source for every fact. The rules editors apply:

* **The same standard for everyone.** No party, person or body is treated differently, in code or in wording.
* **History is append-only.** Rewording a promise adds a new version; past versions and timeline events are never changed.
* **Every number has a source**, an edition (vintage) and a quality label.

`pnpm validate` checks the schema and the append-only rule; CI runs it on every pull request.

## 3. Change the code

Read `CLAUDE.md` (the project's rules) and `docs/` first. Before opening a pull request:

```bash
pnpm validate && pnpm typecheck && pnpm test
```

Keep each pull request to one change, write UI copy in plain British English, and keep every chart keyboard-usable with a table view. Workflows on pull requests from outside the repository run once a maintainer approves them.

## Licence of contributions

By contributing you agree that your code is licensed under the [AGPL-3.0-or-later](LICENSE) and your writing under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), the same as the rest of the project.

## Security and privacy

Please don't open a public issue for a security problem or for anything about a reader's personal data; see [SECURITY.md](SECURITY.md).
