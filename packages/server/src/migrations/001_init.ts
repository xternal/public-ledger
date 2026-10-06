// Public Ledger operational database (M3b). Kept as a TypeScript module so the
// web app bundles it without reading files at runtime.
export default /* sql */ `
-- Public Ledger operational database (M3b): subscriptions, submissions, alerts,
-- and aggregate usage counts. Postgres (Neon, London region) in production;
-- PGlite in development and tests.
--
-- Privacy rules (CLAUDE.md invariant 7, docs/PRIVACY_AND_ACCOUNTS.md):
-- * addresses (email, Telegram chat id) are stored only encrypted, plus an HMAC
--   lookup hash; no names, no IPs, no tracking;
-- * follows are UK GDPR Art. 9 data: they are never exposed individually, and
--   counts are shown only at or above a threshold;
-- * deleting is real deletion (ON DELETE CASCADE), not a flag.

CREATE TABLE IF NOT EXISTS schema_migration (
  id          TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- follow

CREATE TABLE IF NOT EXISTS subscription (
  id                   UUID PRIMARY KEY,
  channel              TEXT NOT NULL CHECK (channel IN ('email', 'telegram')),
  address_enc          TEXT NOT NULL,             -- AES-256-GCM, base64 (iv|tag|ciphertext)
  address_hash         TEXT NOT NULL,             -- HMAC-SHA256(pepper, channel:normalised address)
  cadence              TEXT NOT NULL DEFAULT 'instant' CHECK (cadence IN ('instant', 'weekly')),
  consent_text_version TEXT NOT NULL,
  consent_at           TIMESTAMPTZ NOT NULL,
  confirm_token_hash   TEXT,                      -- double opt-in; cleared once confirmed
  confirmed_at         TIMESTAMPTZ,
  manage_token_hash    TEXT NOT NULL,             -- link in every email: manage, unsubscribe, delete
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, address_hash)
);

CREATE TABLE IF NOT EXISTS subscription_target (
  subscription_id UUID NOT NULL REFERENCES subscription(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('promise', 'actor', 'area', 'all')),
  target_id       TEXT NOT NULL,                  -- promise id, actor id, policy area, or '*'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subscription_id, kind, target_id)
);
CREATE INDEX IF NOT EXISTS subscription_target_lookup ON subscription_target (kind, target_id);

-- ---------------------------------------------------------------- alerts

-- One row per public change detected on main (content and data). Public data only.
CREATE TABLE IF NOT EXISTS change_event (
  id           TEXT PRIMARY KEY,                  -- stable hash of (commit range, promise, type, detail)
  promise_id   TEXT,
  actor_id     TEXT,
  policy_area  TEXT,
  change_type  TEXT NOT NULL CHECK (change_type IN ('status', 'event', 'version', 'cost', 'reply', 'new_card', 'deadline_missed')),
  summary      TEXT NOT NULL,
  url          TEXT NOT NULL,
  commit_sha   TEXT NOT NULL,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Delivery bookkeeping: which subscription has had which change, so retries never send twice.
-- Kept only until the weekly digest window passes (pruned after 35 days).
CREATE TABLE IF NOT EXISTS delivery (
  change_id       TEXT NOT NULL REFERENCES change_event(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES subscription(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('sent', 'queued_digest', 'failed')),
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (change_id, subscription_id)
);

-- Development mail sink: what would have been sent. Never used in production.
CREATE TABLE IF NOT EXISTS mail_outbox (
  id         BIGSERIAL PRIMARY KEY,
  to_enc     TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body_text  TEXT NOT NULL,
  headers    JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- contribute

CREATE TABLE IF NOT EXISTS submission (
  id                 TEXT PRIMARY KEY,            -- public reference, e.g. S-2026-10-0412
  kind               TEXT NOT NULL CHECK (kind IN ('new_promise', 'evidence')),
  promise_id         TEXT,
  evidence_type      TEXT,
  url                TEXT NOT NULL,
  url_normalised     TEXT NOT NULL,
  video_time         TEXT,
  claimed_actor      TEXT,
  claimed_quote      TEXT,
  matched_quote      JSONB,                       -- { text, source_span: [start, end] } or null
  archived_url       TEXT,
  checks             JSONB NOT NULL DEFAULT '{}', -- { reachable, archived, quote_matched, duplicate_of, ... }
  llm_prefill        JSONB,
  contact_email_enc  TEXT,                        -- optional, encrypted; deletable by the submitter
  credit_handle      TEXT,                        -- only if the submitter opted in
  delete_token_hash  TEXT,                        -- lets the submitter delete their email without an account
  status             TEXT NOT NULL DEFAULT 'received'
                     CHECK (status IN ('received', 'auto_checked', 'in_review', 'accepted', 'merged_into', 'rejected', 'duplicate')),
  reason_code        TEXT,                        -- for rejections: no_primary_source, not_a_promise, duplicate, out_of_scope
  resulting_pr_url   TEXT,
  resulting_promise_id TEXT,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  triaged_at         TIMESTAMPTZ
  -- No IP address, user agent or name is stored.
);
CREATE INDEX IF NOT EXISTS submission_status ON submission (status, received_at);
CREATE INDEX IF NOT EXISTS submission_url ON submission (url_normalised);

-- Rate limiting without storing IPs: a random salt per day (deleted after the day),
-- and counts per HMAC(salt, ip). Once the salt is gone the hashes cannot be reversed.
CREATE TABLE IF NOT EXISTS daily_salt (
  day  DATE PRIMARY KEY,
  salt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_bucket (
  day         DATE NOT NULL,
  bucket_hash TEXT NOT NULL,
  action      TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bucket_hash, action)
);

-- ALTCHA replay protection: a solved challenge is accepted once, until it expires.
CREATE TABLE IF NOT EXISTS altcha_used (
  signature  TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------- analytics (aggregate only)

-- Server-side counts for form pages, which run no client analytics (privacy rule 4).
-- Mirrors fact_usage_daily in the warehouse (etl/warehouse/schema.sql).
CREATE TABLE IF NOT EXISTS usage_daily (
  day        DATE NOT NULL,
  event      TEXT NOT NULL,
  prop_key   TEXT NOT NULL DEFAULT '',
  prop_value TEXT NOT NULL DEFAULT '',
  count      BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, prop_key, prop_value)
);
`;
