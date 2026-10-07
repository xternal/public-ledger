# CLAUDE.md — Public Ledger

You are building **Public Ledger**: an open, consumer-grade P&L of the state (UK pilot, Russia later). Three linked modules: the **Statement** (Sankey of income → spending), the **Sandbox** (levers → ranged consequences), and the **Promise ledger** (every political promise as a card with cost, funding and a status timeline). A promise card *is* a sandbox scenario plus a timeline. Read `README.md` (concept) and `docs/PRE_SHIP_REVIEW.md` (known issues), then `docs/PRD.md`, `docs/DATA_MODEL.md`, `docs/MODEL.md` before writing code.

The clickable reference for look and behaviour is `prototype/index.html` (built from `prototype/template.html` + `data/seed/*.json` by `build_prototype.py`). Port it, including the visual direction in `docs/DESIGN_HANDOFF.md` (white, one typeface, numbers first, three data colours). Do not redesign it unless `docs/DESIGN_HANDOFF.md` or a newer design says so.

## Non-negotiable invariants

1. **Every number carries provenance.** Any value rendered in the UI must come from an `Observation` (or a computation over observations) that has `source_id`, `vintage`, and `quality ∈ {sourced, approx, training, modelled}`. No literal numbers in components. A value with `quality: training` must render a visible badge.
2. **Ranges, never points, for anything forecast or modelled.** Model outputs are `{low, central, high}`. Components that display model results must accept and show the range. Outturn data may be a point.
3. **Lever ownership is shown.** Each lever declares `controlled_by ∈ {government, central_bank, demography, external}`. Bank Rate is `central_bank`.
4. **The Statement balances.** `sum(receipts) + borrowing == sum(spending)` for every period and every scenario. A unit test enforces this.
5. **Promise history is append-only.** Rewording a promise creates a new `PromiseVersion`; the diff is shown publicly. Never mutate past versions or timeline events.
6. **One standard for everyone.** No code path, flag or field that treats one party/actor differently.
7. **Minimal personal data, never about citizens' finances.** The "Your share" calculator runs client-side only; salary input is never sent or stored. Follow and Contribute store only what `docs/PRIVACY_AND_ACCOUNTS.md` allows (email + followed IDs; submissions). Follows reveal political opinions: never expose individual follows, show aggregates only above a threshold, no third-party trackers on pages with forms.
8. **Nothing a reader submits is published without two editors.** Submissions create drafts in the editors' queue, never cards.
9. **Reading never requires an account.** Accounts (v1) add sync and credit only.

## Stack

- **App:** Next.js (App Router) + TypeScript (strict) + Tailwind. Charts with d3 (`d3-sankey`, `d3-shape`, `d3-scale`); no heavy chart frameworks.
- **Model T0 (arithmetic):** pure TypeScript in `packages/engine`, runs in the browser, deterministic, unit-tested with Vitest. Must return in <50 ms.
- **Model T1 (microsim):** PolicyEngine UK through its public API, behind a `T1Provider` interface in `packages/server/src/model/` (decision and reasons: `docs/MODEL.md` T1). Called only when a reader asks for distributional output; cached by scenario. A self-hosted `services/model` (FastAPI + `policyengine-uk`) can replace it if microdata access is granted. **T2+ (macro):** later.
- **Data:** Python ETL in `etl/` (pandas, httpx). Output: versioned, normalised JSON/Parquet in `data/build/` + a manifest. Committed to git so every change in data is a reviewable diff. DuckDB for local querying.
- **Promises v0:** YAML files in `content/promises/*.yaml`, validated by a Zod schema at build. Editorial workflow = pull requests. Git history = public change log. Move to Postgres only when volume demands it (>2,000 cards or non-technical editors).
- **Follow/Contribute (M3b):** small Postgres (e.g. Supabase or Neon) holding only subscriptions and submissions; transactional email via a provider with tracking disabled; Telegram bot. Accounts in v1 via passkeys (WebAuthn) with magic-link fallback.
- **Hosting:** Vercel for the app; the Python model service on a container host. Nightly ETL via GitHub Actions.

## Repo layout (target)

```
apps/web/                 Next.js app
packages/engine/          T0 scenario engine (TS) + tests
packages/schema/          Zod schemas shared by app, ETL validators, content
services/model/           FastAPI + policyengine-uk (M5)
etl/                      sources/*.py, normalise.py, quality.py, build.py
content/promises/         one YAML per promise
content/actors/           one YAML per actor
services/alerts/          change detection on content + data, fan-out to RSS/email/Telegram (M3b)
services/intake/          submissions API, URL archiving, transcript matching (M3b/M4)
data/seed/                seed JSON (prototype data; replace via ETL)
data/build/               ETL output (committed)
docs/                     specs
prototype/                reference prototype
```

## Working rules

- Work milestone by milestone from `docs/BUILD_PLAN.md`. Finish acceptance criteria and tests before moving on.
- Engine changes need golden tests: for each lever, a test that 1 unit of change reproduces the source costing within tolerance.
- When you need a number you don't have, add it to `data/seed` with `quality: "training"` and a `TODO(source)` note, never silently.
- Copy: plain British English, active voice, no jargon in the UI ("borrowing", not "PSNB"; tooltips may give the technical term).
- Accessibility: keyboard-operable sliders, visible focus, charts have text alternatives (a table view of every chart).
- Keep the UI fast on a mid-range phone: no chart re-layout on every slider tick beyond 60 fps; debounce to animation frames.

## Commands (to create in M0)

```
pnpm dev            # app
pnpm test           # engine + schema tests
pnpm etl            # run all ETL sources → data/build
pnpm validate       # schemas, balance check, promise lint
```
