import { api } from "@/lib/api";

export const dynamic = "force-static";

/** Recorded forecasts and their scores, as CSV: /api/v1/forecasts.csv */
export function GET() {
  return api.forecasts("csv");
}
