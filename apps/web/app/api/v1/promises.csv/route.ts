import { api } from "@/lib/api";

export const dynamic = "force-static";

/** Every promise card, as CSV: /api/v1/promises.csv */
export function GET() {
  return api.promises("csv");
}
