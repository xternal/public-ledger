import { api } from "@/lib/api";

export const dynamic = "force-static";

/** Every data edition, newest first, as CSV: /api/v1/vintages.csv */
export function GET() {
  return api.vintages("csv");
}
