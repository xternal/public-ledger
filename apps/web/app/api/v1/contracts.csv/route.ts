import { api } from "@/lib/api";

export const dynamic = "force-static";

/** Contracts linked to promise cards, as CSV: /api/v1/contracts.csv */
export function GET() {
  return api.contracts("csv");
}
