import "server-only";
import type { FollowContext } from "@ledger/server/follow";
import { getServer } from "@/lib/server";
import { describeTarget } from "./targets";

/** Database, config, mailer and content names for the follow service (route handlers and the follow pages). */
export async function followContext(): Promise<FollowContext> {
  const { config, db, mail } = await getServer();
  return { config, db, mail, describe: describeTarget };
}
