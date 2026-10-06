import { feedResponse } from "../feed-response";

export const dynamic = "force-static";

/** Every change to every promise card, newest first (Atom). */
export function GET() {
  return feedResponse("all", "*");
}
