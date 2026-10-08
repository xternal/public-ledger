// Additions to a confirmed email subscription wait for the owner's confirmation (DPIA R11, measure M10).
// Kept as a TypeScript module so the web app bundles it.
export default /* sql */ `
-- What a follow request asked to add to an email subscription that is already
-- confirmed. Nothing here is followed: alerts, counts and the manage page read
-- subscription_target only. The address's owner adds them with the link emailed
-- to that address, whose page POSTs (as for double opt-in). Each request has its
-- own link, and asking again for the same thing moves it to the newest link.
-- Rows nobody confirms are deleted after 7 days by the daily job.
CREATE TABLE IF NOT EXISTS pending_target (
  subscription_id    UUID NOT NULL REFERENCES subscription(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('promise', 'actor', 'area', 'deadline_window', 'all')),
  target_id          TEXT NOT NULL,
  confirm_token_hash TEXT NOT NULL,              -- hash of the link's token; the token is only in the email
  requested_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (subscription_id, kind, target_id)
);
CREATE INDEX IF NOT EXISTS pending_target_token ON pending_target (confirm_token_hash);
`;
