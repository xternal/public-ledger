import { api } from "@/lib/api";

export const dynamic = "force-static";

/** Contracts linked to promise cards, as JSON: /api/v1/contracts */
export function GET() {
  return api.contracts("json");
}
