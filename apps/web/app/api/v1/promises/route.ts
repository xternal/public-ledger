import { api } from "@/lib/api";

export const dynamic = "force-static";

/** Every promise card, as JSON: /api/v1/promises */
export function GET() {
  return api.promises("json");
}
