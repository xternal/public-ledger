// T1 microsimulation cache (M5). Kept as a TypeScript module so the web app bundles it.
export default /* sql */ `
-- PolicyEngine results per scenario code and fiscal year (docs/MODEL.md T1).
-- Public data only: a scenario code holds lever settings, nothing about a reader.
-- status: pending (the policy is registered and PolicyEngine is computing),
-- ok (result is a T1Result), error (error is a code such as http_502 or timeout).
-- While pending, result holds the example households already computed.
-- Quality over time: completed_at - requested_at is the time to a result,
-- polls counts the checks it took, result->provenance has the model and data versions.
CREATE TABLE IF NOT EXISTS t1_result (
  scenario     TEXT NOT NULL,
  year         TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'error')),
  policy_id    INT,
  result       JSONB,
  error        TEXT,
  polls        INT NOT NULL DEFAULT 0,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (scenario, year)
);
CREATE INDEX IF NOT EXISTS t1_result_status ON t1_result (status, updated_at);
`;
