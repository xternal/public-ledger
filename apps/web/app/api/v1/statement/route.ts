import { api } from "@/lib/api";

export const dynamic = "force-static";

/** Every year's totals with provenance, as JSON: /api/v1/statement */
export function GET() {
  return api.statement("json");
}
