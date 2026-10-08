import { api } from "@/lib/api";

export const dynamic = "force-static";

/** Every year's totals with provenance, as CSV: /api/v1/statement.csv */
export function GET() {
  return api.statement("csv");
}
