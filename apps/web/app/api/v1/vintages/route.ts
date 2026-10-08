import { api } from "@/lib/api";

export const dynamic = "force-static";

/** Every data edition, newest first, as JSON: /api/v1/vintages */
export function GET() {
  return api.vintages("json");
}
