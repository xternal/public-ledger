// Deadline-window follows and data alerts (PRE_SHIP_REVIEW F8, F9). Kept as a TypeScript module so the web app bundles it.
export default /* sql */ `
-- Follow a deadline window: target_id is a window id such as next-3-months.
ALTER TABLE subscription_target DROP CONSTRAINT IF EXISTS subscription_target_kind_check;
ALTER TABLE subscription_target ADD CONSTRAINT subscription_target_kind_check
  CHECK (kind IN ('promise', 'actor', 'area', 'deadline_window', 'all'));

-- Data changes from data/build: a linked contract's new snapshot or first appearance
-- (contract), a new edition of the Statement's headline figures (edition), and the
-- monthly list of promises coming due in a window (coming_due). Editions and the
-- monthly list belong to no promise, so promise_id, actor_id and policy_area stay NULL.
ALTER TABLE change_event DROP CONSTRAINT IF EXISTS change_event_change_type_check;
ALTER TABLE change_event ADD CONSTRAINT change_event_change_type_check
  CHECK (change_type IN ('status', 'event', 'version', 'cost', 'reply', 'new_card', 'deadline_missed', 'contract', 'edition', 'coming_due'));

-- How far the data alerts have read main: the last commit whose data/build changes
-- were announced. Public commit ids only; nothing about readers.
CREATE TABLE IF NOT EXISTS alert_cursor (
  stream      TEXT PRIMARY KEY,                -- what the cursor tracks: "data"
  commit_sha  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
