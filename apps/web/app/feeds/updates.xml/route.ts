import { feedResponse } from "../feed-response";

export const dynamic = "force-static";

/** Data changes only (Atom): promise costs, contracts behind promises and new editions of the headline figures. */
export function GET() {
  return feedResponse("updates", "*");
}
