# Analytics database

The analytics database exists to answer, at any point, two questions about the product: **how much** (quantity) and **how good** (quality). It is designed now, before there is traffic or a large ledger, so the history is there when we need it.

It is a DuckDB file built from what the repo already commits. It holds no person, email, IP, salary or follow list (CLAUDE.md invariant 7).

```bash
etl/.venv/bin/python -m etl.warehouse.load --report   # builds data/warehouse/ledger.duckdb (gitignored) and prints the core questions
```

Schema: `etl/warehouse/schema.sql`. Loader: `etl/warehouse/load.py`.

## Four areas

| Area | Tables | Filled from | Since |
|---|---|---|---|
| Data | `dim_source`, `dim_series`, `fact_observation`, `fact_statement_line` | `data/build/observations/<source>/<vintage>.csv`, `data/build/statements/*.json` | M1 |
| Pipeline | `etl_run`, `etl_artifact`, `etl_check` | `data/build/history/*.csv` (append-only, one row per build, file and check) | M1 |
| Content | `dim_actor`, `fact_card_snapshot`, `fact_card_event` | `content/promises/*.yaml` and git merge dates | M3 |
| Usage | `fact_usage_daily` | The analytics sink (`apps/web/lib/analytics.ts`), as daily counts only | When a sink is chosen |

Design choices:
- **Old vintages are kept.** Every source edition is a separate file. That lets us measure how much numbers are revised, which is a quality signal for the sources and for our own forecasts (M7 backtest).
- **Every fact has a date or a build id**, so every question can be asked as a trend.
- **Content is snapshotted daily**, so we can chart the ledger's size and health over time without reconstructing it from git.
- **Usage is aggregated at write time:** one row per day per event per property value. There are no visitor rows to leak, and funnels are ratios of totals (docs/CUSTOMER_JOURNEYS.md, analytics privacy rules).

## Questions it answers

| Question | Kind | View |
|---|---|---|
| How many series, sources and observations do we hold, and how is that growing? | Quantity | `v_data_volume` |
| What share of each year's Statement is sourced, estimated or a balancing figure? | Quality | `v_statement_quality` |
| Is any source overdue for a new edition? | Quality | `v_source_freshness` |
| How much did a number move between editions? | Quality | `v_revisions` |
| Is the pipeline getting healthier or worse? | Quality | `v_check_trend` |
| How many cards, how many costed, without sources, overdue, with replies, from readers; days from promise to card? | Both | `v_ledger_health` (M3) |
| Daily events and funnel steps | Quantity | `v_usage_events` (needs a sink) |

## Rules

1. No identifiers of people, devices or sessions in any table.
2. Follow and submission counts carry no promise or actor id (analytics privacy rule 6).
3. Analytics never change a finding: views and counts are not evidence for a status.
4. Russia mode: server totals only (docs/RUSSIA.md).
