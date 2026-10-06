// Lookups by token hash for delete-my-email and the manage page.
export default /* sql */ `
CREATE INDEX IF NOT EXISTS submission_delete_token ON submission (delete_token_hash) WHERE delete_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS subscription_manage_token ON subscription (manage_token_hash);
`;
