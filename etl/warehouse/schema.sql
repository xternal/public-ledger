-- Public Ledger analytics warehouse (DuckDB).
--
-- Purpose: understand what is happening with the product, in quantity and in
-- quality, from the first build onwards. Four areas:
--   1. data      what numbers we hold, where from, how fresh, how often revised
--   2. pipeline  every build, every downloaded file, every check that failed
--   3. content   promise cards, their versions and timeline events (filled from M3)
--   4. usage     product events as daily aggregate counts only (filled when a sink exists)
--
-- Rules carried over from CLAUDE.md invariant 7 and docs/PRIVACY_AND_ACCOUNTS.md:
-- no table holds a person, an email, an IP, a salary or a follow list. Usage is
-- counts per day per event per property value, never rows per visitor.
--
-- Naming: dim_* describe things, fact_* record measurements or events,
-- v_* are the questions we ask. Every fact carries build_id or a date so trends
-- can be queried.

-- ---------------------------------------------------------------- pipeline

CREATE TABLE IF NOT EXISTS etl_run (
  build_id      VARCHAR PRIMARY KEY,      -- e.g. 2026-10-06T19:40:12Z
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ,
  git_sha       VARCHAR,                  -- code version that ran
  trigger       VARCHAR,                  -- manual | nightly | ci
  status        VARCHAR NOT NULL,         -- ok | failed
  observations  INTEGER,
  errors        INTEGER,
  warnings      INTEGER
);

CREATE TABLE IF NOT EXISTS etl_artifact (
  build_id      VARCHAR NOT NULL,
  source_id     VARCHAR NOT NULL,
  url           VARCHAR NOT NULL,
  sha256        VARCHAR NOT NULL,
  bytes         BIGINT,
  fetched_at    TIMESTAMPTZ NOT NULL,
  vintage       VARCHAR,
  changed       BOOLEAN,                  -- sha differs from the previous build's file for this URL
  fetched_url   VARCHAR,                  -- where the bytes came from: url after redirects, or an Internet Archive copy
  archived_at   TIMESTAMPTZ               -- set when read through the Internet Archive: when it captured the file
);

CREATE TABLE IF NOT EXISTS etl_check (
  build_id      VARCHAR NOT NULL,
  check_id      VARCHAR NOT NULL,         -- balance | staleness | coverage | identity | schema | mapping
  level         VARCHAR NOT NULL,         -- error | warning | info
  subject       VARCHAR,                  -- source id, series id or period
  message       VARCHAR NOT NULL,
  value         DOUBLE                    -- the measured gap, days stale, etc.
);

-- ---------------------------------------------------------------- data

CREATE TABLE IF NOT EXISTS dim_source (
  source_id     VARCHAR PRIMARY KEY,
  title         VARCHAR NOT NULL,
  publisher     VARCHAR NOT NULL,
  url           VARCHAR NOT NULL,
  licence       VARCHAR,
  cadence_days  INTEGER NOT NULL,
  grace_days    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dim_series (
  series_id     VARCHAR PRIMARY KEY,
  domain        VARCHAR NOT NULL,         -- receipts | spending | fiscal | macro | people | reckoner | tax | psf
  label         VARCHAR,
  unit          VARCHAR NOT NULL
);

-- Every observation from every vintage we have seen. Keeping old vintages is
-- what lets us measure revisions (a quality signal for us and for sources).
CREATE TABLE IF NOT EXISTS fact_observation (
  series_id     VARCHAR NOT NULL,
  period        VARCHAR NOT NULL,         -- 2025-26 | 2026-08 | 2026-09-18 | 2025
  period_type   VARCHAR NOT NULL,         -- fiscal_year | month | date | year
  period_start  DATE NOT NULL,            -- first day of the period, for ordering and joins
  geography     VARCHAR NOT NULL,
  value         DOUBLE NOT NULL,
  unit          VARCHAR NOT NULL,
  kind          VARCHAR NOT NULL,         -- outturn | forecast | projection
  source_id     VARCHAR NOT NULL,
  vintage       VARCHAR NOT NULL,
  quality       VARCHAR NOT NULL,         -- sourced | approx | modelled | training
  method_note   VARCHAR,
  first_seen_build VARCHAR NOT NULL
);

-- What the Statement actually showed, line by line, in each build.
CREATE TABLE IF NOT EXISTS fact_statement_line (
  build_id      VARCHAR NOT NULL,
  period        VARCHAR NOT NULL,
  kind          VARCHAR NOT NULL,         -- outturn | forecast
  side          VARCHAR NOT NULL,         -- receipt | spending | financing
  line_id       VARCHAR NOT NULL,
  bn            DOUBLE NOT NULL,
  quality       VARCHAR NOT NULL,
  plug          BOOLEAN NOT NULL,
  source_id     VARCHAR
);

-- ---------------------------------------------------------------- content (M3)

CREATE TABLE IF NOT EXISTS dim_actor (
  actor_id      VARCHAR PRIMARY KEY,
  name          VARCHAR NOT NULL,
  kind          VARCHAR NOT NULL,         -- person | party | government
  party_id      VARCHAR
);

-- One row per card per build: a daily snapshot, so we can chart the ledger's size and health over time.
CREATE TABLE IF NOT EXISTS fact_card_snapshot (
  snapshot_date DATE NOT NULL,
  promise_id    VARCHAR NOT NULL,
  actor_id      VARCHAR,
  policy_area   VARCHAR,
  status        VARCHAR NOT NULL,
  made_on       DATE NOT NULL,
  published_on  DATE,                     -- first merge to main
  origin        VARCHAR,                  -- manual | reader_submission | llm_intake
  costed        BOOLEAN NOT NULL,         -- has a how_much range
  funding_named BOOLEAN NOT NULL,
  sources       INTEGER NOT NULL,
  versions      INTEGER NOT NULL,
  events        INTEGER NOT NULL,
  has_reply     BOOLEAN NOT NULL,
  overdue       BOOLEAN NOT NULL,
  editor_check_required BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS fact_card_event (
  promise_id    VARCHAR NOT NULL,
  event_date    DATE NOT NULL,
  event_type    VARCHAR NOT NULL,
  auto          BOOLEAN NOT NULL,
  recorded_on   DATE                      -- when the event entered the ledger (git merge date)
);

-- ---------------------------------------------------------------- usage (aggregate only)

-- Daily counts per event and property value. No visitor, session or device id,
-- no free text. Follow and submission events carry no promise or actor id
-- (docs/CUSTOMER_JOURNEYS.md, analytics privacy rule 6).
CREATE TABLE IF NOT EXISTS fact_usage_daily (
  day           DATE NOT NULL,
  event         VARCHAR NOT NULL,         -- names from the event catalogue
  prop_key      VARCHAR NOT NULL,         -- '' when the count is for the event as a whole
  prop_value    VARCHAR NOT NULL,
  count         BIGINT NOT NULL
);

-- ---------------------------------------------------------------- questions

-- Quantity: how many observations, series and sources we hold, per build.
CREATE OR REPLACE VIEW v_data_volume AS
SELECT b.build_id, b.finished_at,
       count(DISTINCT o.series_id)  AS series,
       count(DISTINCT o.source_id)  AS sources,
       count(*)                     AS observations
FROM etl_run b
JOIN fact_observation o ON o.first_seen_build <= b.build_id
GROUP BY ALL
ORDER BY b.build_id;

-- Quality: share of each year's Statement (by value) that is sourced, estimated or a balancing figure.
CREATE OR REPLACE VIEW v_statement_quality AS
SELECT build_id, period, kind,
       sum(bn)                                                        AS total_bn,
       sum(bn) FILTER (WHERE quality = 'sourced' AND NOT plug) / sum(bn) AS share_sourced,
       sum(bn) FILTER (WHERE quality = 'approx'  AND NOT plug) / sum(bn) AS share_estimate,
       sum(bn) FILTER (WHERE quality = 'training')                / sum(bn) AS share_placeholder,
       sum(bn) FILTER (WHERE plug)                                / sum(bn) AS share_plug
FROM fact_statement_line
WHERE side IN ('receipt', 'financing')
GROUP BY ALL
ORDER BY build_id, period;

-- Quality: how fresh each source is against its publishing cadence.
CREATE OR REPLACE VIEW v_source_freshness AS
WITH latest AS (
  SELECT source_id, max(fetched_at) AS last_fetched, arg_max(vintage, fetched_at) AS vintage
  FROM etl_artifact GROUP BY source_id
)
SELECT s.source_id, s.publisher, l.vintage, l.last_fetched, s.cadence_days, s.grace_days
FROM dim_source s LEFT JOIN latest l USING (source_id)
ORDER BY s.source_id;

-- Quality: how much a number moved between vintages (our forecasts and the publishers' revisions).
CREATE OR REPLACE VIEW v_revisions AS
SELECT series_id, period, source_id, vintage, value,
       value - lag(value) OVER w                                AS change,
       (value - lag(value) OVER w) / nullif(abs(lag(value) OVER w), 0) AS change_pct
FROM fact_observation
WINDOW w AS (PARTITION BY series_id, period, source_id ORDER BY first_seen_build, vintage)
ORDER BY series_id, period, vintage;

-- Quality: failed checks per build, for a run chart of pipeline health.
CREATE OR REPLACE VIEW v_check_trend AS
SELECT r.build_id, r.finished_at, c.check_id, c.level, count(c.check_id) AS n
FROM etl_run r LEFT JOIN etl_check c USING (build_id)
GROUP BY ALL
ORDER BY r.build_id;

-- Quantity and quality of the ledger (populated from M3).
CREATE OR REPLACE VIEW v_ledger_health AS
SELECT snapshot_date,
       count(*)                                             AS cards,
       count(*) FILTER (WHERE costed)                       AS costed,
       count(*) FILTER (WHERE NOT funding_named)            AS funding_not_named,
       count(*) FILTER (WHERE sources = 0)                  AS without_sources,
       count(*) FILTER (WHERE overdue)                      AS overdue,
       count(*) FILTER (WHERE has_reply)                    AS with_reply,
       count(*) FILTER (WHERE origin = 'reader_submission') AS from_readers,
       median(published_on - made_on)                       AS median_days_to_card
FROM fact_card_snapshot
GROUP BY snapshot_date
ORDER BY snapshot_date;

-- Usage funnels as ratios of daily totals (populated when a sink exists).
CREATE OR REPLACE VIEW v_usage_events AS
SELECT day, event, sum(count) AS n
FROM fact_usage_daily
WHERE prop_key = ''
GROUP BY ALL
ORDER BY day, event;
