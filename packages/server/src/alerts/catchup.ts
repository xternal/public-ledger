import type { Db } from "../db";
import { partyOf } from "./content";
import { diffData } from "./data";
import type { ChangeEvent } from "./diff";
import { fanOut, type AlertContext, type FanOutReport } from "./fanout";
import { dataSnapshotsFor, isAncestor, resolveCommit, type GitRunner } from "./git";

/**
 * Data alerts read main from where they last stopped (PRE_SHIP_REVIEW F8).
 *
 * The nightly data refresh merges data/build changes that may touch nothing in
 * content/, so they do not trigger the push-to-main alerts run. Instead the
 * alerts job remembers the last commit whose data changes it announced (the
 * `alert_cursor` table) and diffs from there to the commit it runs on, every
 * time it runs: after each content push and in the daily maintenance run. So
 * a data change is announced within a day at most, without a separate
 * workflow trigger. The cursor moves only when every message went out; a
 * failed send is retried by the next run (deliveries already made are never
 * repeated, as in any fan-out).
 *
 * The first run on a database announces nothing and starts the cursor at the
 * current commit, so switching data alerts on never floods anyone with history.
 */

export const DATA_CURSOR = "data";

export async function readCursor(db: Db, stream: string): Promise<string | null> {
  const [row] = await db.query<{ commit_sha: string }>("SELECT commit_sha FROM alert_cursor WHERE stream = $1", [stream]);
  return row?.commit_sha ?? null;
}

export async function writeCursor(db: Db, stream: string, sha: string, now = new Date()): Promise<void> {
  await db.query(
    `INSERT INTO alert_cursor (stream, commit_sha, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (stream) DO UPDATE SET commit_sha = EXCLUDED.commit_sha, updated_at = EXCLUDED.updated_at`,
    [stream, sha, now.toISOString()],
  );
}

export interface DataRunReport {
  /** started: no cursor yet, now set; behind: the cursor is already at or past this commit; diffed: changes were looked for. */
  outcome: "started" | "behind" | "diffed" | "reset";
  range: { before: string | null; after: string };
  events: ChangeEvent[];
  fanOut: FanOutReport | null;
}

/** Announce data changes from the cursor to `target` (default HEAD). */
export async function runDataAlerts(ctx: Omit<AlertContext, "partyOf">, git: GitRunner, opts: { target?: string } = {}): Promise<DataRunReport> {
  const { db } = ctx;
  const now = ctx.now ?? new Date();
  const after = resolveCommit(git, opts.target ?? "HEAD");
  if (!after) throw new Error(`Unknown commit: ${opts.target ?? "HEAD"}`);
  const stored = await readCursor(db, DATA_CURSOR);
  const before = resolveCommit(git, stored);
  const none = (outcome: DataRunReport["outcome"]): DataRunReport => ({ outcome, range: { before, after }, events: [], fanOut: null });

  if (!before) {
    await writeCursor(db, DATA_CURSOR, after, now);
    return none("started");
  }
  if (before === after || isAncestor(git, after, before)) return none("behind");
  if (!isAncestor(git, before, after)) {
    // History was rewritten under the cursor: start again from here rather than diff unrelated commits.
    await writeCursor(db, DATA_CURSOR, after, now);
    return none("reset");
  }

  const snap = dataSnapshotsFor(git, before, after);
  const events = diffData(snap.before, snap.after, { commit: after, siteUrl: ctx.config.siteUrl, actors: snap.actors });
  const report = events.length ? await fanOut(events, { ...ctx, partyOf: (id) => partyOf(snap.actors, id) }) : null;
  if (!report?.failed) await writeCursor(db, DATA_CURSOR, after, now);
  return { outcome: "diffed", range: { before, after }, events, fanOut: report };
}
