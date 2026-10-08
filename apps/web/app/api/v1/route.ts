import { api } from "@/lib/api";

export const dynamic = "force-static";

/** The API's index: every endpoint with a working example, and the licence (docs: /method/api). */
export function GET() {
  return api.index();
}
