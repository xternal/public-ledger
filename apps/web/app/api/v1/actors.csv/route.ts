import { api } from "@/lib/api";

export const dynamic = "force-static";

/** People, parties and the government, as CSV: /api/v1/actors.csv */
export function GET() {
  return api.actors("csv");
}
