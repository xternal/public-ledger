// T1 cache version. Kept as a TypeScript module so the web app bundles it.
export default /* sql */ `
-- The version of our own T1 inputs a row was computed with (T1_CACHE_VERSION in
-- packages/server/src/model/service.ts). A row of another version is computed again
-- on the next request instead of being served for the rest of its 30 days.
-- Rows written before this column existed are version 1.
ALTER TABLE t1_result ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
`;
