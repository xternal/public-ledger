import { api } from "@/lib/api";

export const dynamic = "force-static";

/** People, parties and the government, as JSON: /api/v1/actors */
export function GET() {
  return api.actors("json");
}
