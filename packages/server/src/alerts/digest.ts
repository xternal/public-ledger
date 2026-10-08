import type { Db } from "../db";
import { pruneSpamState } from "../spam";
import { prunePendingAdditions, pruneUnconfirmed } from "../follow";
import { countSent, deliver, inList, type AlertContext } from "./fanout";
import { errorText } from "./log";
import type { MessageEvent } from "./messages";

/**
 * Weekly digest: one message per subscription listing the changes queued for
 * it since the last digest. Rows are claimed (queued → sent) before sending;
 * if the send fails they go back to the queue for next week.
 */

/** Same order as change detection: what happened to the card first, then its timeline. */
const TYPE_ORDER = `CASE change_type WHEN 'new_card' THEN 0 WHEN 'status' THEN 1 WHEN 'version' THEN 2 WHEN 'cost' THEN 3
  WHEN 'event' THEN 4 WHEN 'deadline_missed' THEN 4 WHEN 'contract' THEN 4 WHEN 'reply' THEN 5 WHEN 'edition' THEN 6 ELSE 7 END`;

export interface DigestReport {
  subscriptions: number;
  emails: number;
  telegrams: number;
  changes: number;
  failed: number;
}

export async function runDigest(
  ctx: Pick<AlertContext, "db" | "config" | "mailer" | "telegram" | "now">,
  opts: { titles?: Map<string, string> } = {},
): Promise<DigestReport> {
  const { db } = ctx;
  const now = ctx.now ?? new Date();
  const report: DigestReport = { subscriptions: 0, emails: 0, telegrams: 0, changes: 0, failed: 0 };
  const subs = await db.query<{ id: string; channel: "email" | "telegram" }>(
    `SELECT DISTINCT s.id, s.channel FROM subscription s JOIN delivery d ON d.subscription_id = s.id
      WHERE d.status = 'queued_digest' AND s.confirmed_at IS NOT NULL ORDER BY s.id`,
  );
  for (const sub of subs) {
    const claimed = await db.query<{ change_id: string }>(
      "UPDATE delivery SET status = 'sent', at = $2 WHERE subscription_id = $1 AND status = 'queued_digest' RETURNING change_id",
      [sub.id, now.toISOString()],
    );
    if (!claimed.length) continue;
    const ids = claimed.map((r) => r.change_id);
    const events = await db.query<MessageEvent & { change_type: string }>(
      `SELECT promise_id, change_type, summary, url FROM change_event WHERE id IN (${inList(ids)})
        ORDER BY detected_at, ${TYPE_ORDER}, id`,
      ids,
    );
    for (const e of events) e.title = e.promise_id ? opts.titles?.get(e.promise_id) : undefined;
    report.subscriptions++;
    try {
      await deliver(ctx, sub, events, "digest", now);
      if (sub.channel === "email") report.emails++;
      else report.telegrams++;
      report.changes += events.length;
      await countSent(db, sub.channel, events, now);
    } catch (err) {
      report.failed++;
      console.error(`digest delivery failed (${sub.channel}):`, errorText(err));
      await db.query(`UPDATE delivery SET status = 'queued_digest' WHERE subscription_id = $1 AND change_id IN (${inList(ids, 1)})`, [sub.id, ...ids]);
    }
  }
  return report;
}

/** Delivery records are kept only until the weekly digest window has passed. */
export const DELIVERY_RETENTION_DAYS = 35;

export interface MaintenanceReport {
  deliveries: number;
  unconfirmed: number;
  /** Targets someone asked to add to a confirmed subscription, never confirmed by its owner. */
  pendingAdditions: number;
  outbox: number;
}

/**
 * Daily: delete delivery records older than 35 days, sign-ups and additions
 * never confirmed within 7 days (Follow service), yesterday's rate-limit salts
 * and buckets and expired spam challenges, and old development outbox mail.
 */
export async function runMaintenance(db: Db, now = new Date()): Promise<MaintenanceReport> {
  const cutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const deliveries = (await db.query("DELETE FROM delivery WHERE at < $1 RETURNING change_id", [cutoff])).length;
  const outbox = (await db.query("DELETE FROM mail_outbox WHERE created_at < $1 RETURNING id", [cutoff])).length;
  const unconfirmed = await pruneUnconfirmed(db, now);
  const pendingAdditions = await prunePendingAdditions(db, now);
  await pruneSpamState(db, now);
  return { deliveries, unconfirmed: Number(unconfirmed) || 0, pendingAdditions, outbox };
}
