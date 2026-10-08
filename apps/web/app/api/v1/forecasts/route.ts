import { api } from "@/lib/api";

export const dynamic = "force-static";

/** Recorded forecasts and their scores, as JSON: /api/v1/forecasts */
export function GET() {
  return api.forecasts("json");
}
