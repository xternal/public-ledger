import { alertWindows, ukDay } from "@ledger/schema";
import type { Config } from "../config";
import { decrypt } from "../crypto";
import type { Db } from "../db";
import type { Mailer } from "../mail";
import type { TelegramSender } from "../telegram-api";
import { countUsage } from "../usage";
import { manageToken } from "../follow";
import type { ChangeEvent } from "./diff";
import { errorText } from "./log";
import { alertEmail, digestEmail, manageLinks, submitterEmail, telegramText, type ManageLinks, type MessageEvent } from "./messages";

/**
 * Fan-out (PRD F7): store each change once, find the confirmed subscriptions
 * that follow it (the promise, its actor, the actor's party, its policy area,
 * a deadline window it falls in, or everything), and send one message per
 * subscription per run. Weekly subscribers get the change queued for their
 * digest instead. Changes that belong to no promise (a new edition of the
 * headline figures) reach only people who follow everything.
 *
 * Idempotent: the delivery table's primary key (change, subscription) is
 * claimed before sending, so a re-run never sends twice; a failed send is
 * marked `failed` and retried by the next run that sees the same change.
 */

export interface AlertContext {
  db: Db;
  config: Config;
  mailer: Mailer;
  telegram: TelegramSender;
  /** The party an actor belongs to (a party is its own party). */
  partyOf: (actorId: string) => string | null;
  now?: Date;
}

export interface FanOutReport {
  changes: number;
  newChanges: number;
  emails: number;
  telegrams: number;
  queued: number;
  failed: number;
  submitterUpdates: number;
}

export function inList(values: unknown[], offset = 0): string {
  return values.map((_, i) => `$${i + offset + 1}`).join(", ");
}

/** Store change events; returns how many were new. */
export async function storeEvents(db: Db, events: ChangeEvent[], now = new Date()): Promise<number> {
  let fresh = 0;
  for (const e of events) {
    const rows = await db.query(
      `INSERT INTO change_event (id, promise_id, actor_id, policy_area, change_type, summary, url, commit_sha, detected_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [e.id, e.promise_id, e.actor_id, e.policy_area, e.change_type, e.summary, e.url, e.commit_sha, now.toISOString()],
    );
    fresh += rows.length;
  }
  return fresh;
}

export interface MatchedSubscription {
  id: string;
  channel: "email" | "telegram";
  cadence: "instant" | "weekly";
}

/**
 * The deadline windows whose followers hear about this change: only outcomes
 * (delivered, deadline passed) of a promise whose deadline falls in the
 * window, or in the month before it, on the UK day of the run.
 */
export function windowsFor(e: Pick<ChangeEvent, "outcome" | "deadline">, now = new Date()): string[] {
  return e.outcome ? alertWindows(e.deadline, ukDay(now)) : [];
}

/** Confirmed subscriptions following this change through any of its targets. Unconfirmed sign-ups never match. */
export async function matchingSubscriptions(
  db: Db,
  e: Pick<ChangeEvent, "promise_id" | "actor_id" | "policy_area">,
  party: string | null,
  windows: string[] = [],
): Promise<MatchedSubscription[]> {
  const byWindow = windows.length ? `OR (t.kind = 'deadline_window' AND t.target_id IN (${inList(windows, 4)}))` : "";
  return db.query<MatchedSubscription>(
    `SELECT DISTINCT s.id, s.channel, s.cadence
       FROM subscription s JOIN subscription_target t ON t.subscription_id = s.id
      WHERE s.confirmed_at IS NOT NULL
        AND ((t.kind = 'promise' AND t.target_id = $1)
          OR (t.kind = 'actor' AND (t.target_id = $2 OR t.target_id = $3))
          OR (t.kind = 'area' AND t.target_id = $4)
          ${byWindow}
          OR t.kind = 'all')
      ORDER BY s.id`,
    [e.promise_id, e.actor_id, party, e.policy_area, ...windows],
  );
}

/** How to word one message on each channel. Email gets the subscription's own manage links. */
export interface Render {
  email: (links: ManageLinks) => { subject: string; text: string };
  telegram: () => string;
}

/** Send one message to one subscription. Email carries the subscription's manage and one-click unsubscribe links. */
export async function deliverText(ctx: Pick<AlertContext, "db" | "config" | "mailer" | "telegram">, sub: { id: string; channel: "email" | "telegram" }, render: Render): Promise<void> {
  const [row] = await ctx.db.query<{ address_enc: string }>("SELECT address_enc FROM subscription WHERE id = $1 AND confirmed_at IS NOT NULL", [sub.id]);
  if (!row) throw new Error("subscription no longer exists");
  const address = decrypt(ctx.config.encryptionKey, row.address_enc);
  if (sub.channel === "telegram") {
    await ctx.telegram.send(address, render.telegram());
    return;
  }
  const links = manageLinks(ctx.config.siteUrl, await manageToken(ctx.db, ctx.config, sub.id));
  const { subject, text } = render.email(links);
  await ctx.mailer.send({ to: address, subject, text, unsubscribeUrl: links.unsubscribeUrl });
}

/** Send changes to one subscription, as an instant alert or a digest. */
export async function deliver(
  ctx: Pick<AlertContext, "db" | "config" | "mailer" | "telegram">,
  sub: { id: string; channel: "email" | "telegram" },
  events: MessageEvent[],
  mode: "instant" | "digest",
  now = new Date(),
): Promise<void> {
  await deliverText(ctx, sub, {
    telegram: () => telegramText(events, { digest: mode === "digest", now }),
    email: (links) => (mode === "digest" ? digestEmail(events, links, now) : alertEmail(events, links)),
  });
}

export async function countSent(db: Db, channel: "email" | "telegram", events: { change_type: string }[], now = new Date()): Promise<void> {
  const byType = new Map<string, number>();
  for (const e of events) byType.set(e.change_type, (byType.get(e.change_type) ?? 0) + 1);
  for (const [change_type, n] of byType) await countUsage(db, { event: "alert_sent", props: { channel, change_type } }, n, now);
}

/** Store, match, send or queue. */
export async function fanOut(events: ChangeEvent[], ctx: AlertContext): Promise<FanOutReport> {
  const { db } = ctx;
  const now = ctx.now ?? new Date();
  const report: FanOutReport = { changes: events.length, newChanges: 0, emails: 0, telegrams: 0, queued: 0, failed: 0, submitterUpdates: 0 };
  report.newChanges = await storeEvents(db, events, now);

  const bySub = new Map<string, { sub: MatchedSubscription; events: ChangeEvent[] }>();
  for (const e of events) {
    const party = e.actor_id ? ctx.partyOf(e.actor_id) : null;
    for (const sub of await matchingSubscriptions(db, e, party, windowsFor(e, now))) {
      const entry = bySub.get(sub.id) ?? { sub, events: [] };
      entry.events.push(e);
      bySub.set(sub.id, entry);
    }
  }

  for (const { sub, events: mine } of bySub.values()) {
    if (sub.cadence === "weekly") {
      for (const e of mine) {
        const rows = await db.query(
          "INSERT INTO delivery (change_id, subscription_id, status, at) VALUES ($1, $2, 'queued_digest', $3) ON CONFLICT (change_id, subscription_id) DO NOTHING RETURNING change_id",
          [e.id, sub.id, now.toISOString()],
        );
        report.queued += rows.length;
      }
      continue;
    }
    // Claim: new rows, or rows a previous run marked failed. Rows already sent or queued are skipped.
    const claimed: ChangeEvent[] = [];
    for (const e of mine) {
      const rows = await db.query(
        `INSERT INTO delivery (change_id, subscription_id, status, at) VALUES ($1, $2, 'sent', $3)
         ON CONFLICT (change_id, subscription_id) DO UPDATE SET status = 'sent', at = EXCLUDED.at WHERE delivery.status = 'failed'
         RETURNING change_id`,
        [e.id, sub.id, now.toISOString()],
      );
      if (rows.length) claimed.push(e);
    }
    if (!claimed.length) continue;
    try {
      await deliver(ctx, sub, claimed, "instant", now);
      if (sub.channel === "email") report.emails++;
      else report.telegrams++;
      await countSent(db, sub.channel, claimed, now);
    } catch (err) {
      report.failed++;
      console.error(`alert delivery failed (${sub.channel}):`, errorText(err));
      await db.query(`UPDATE delivery SET status = 'failed' WHERE subscription_id = $1 AND change_id IN (${inList(claimed, 1)})`, [sub.id, ...claimed.map((e) => e.id)]);
    }
  }
  return report;
}

/**
 * PRD F8: tell a submitter when their submission became a card (or their
 * evidence reached one), mark the submission `merged_into`, and delete the
 * contact address: this was the last update it was kept for.
 */
export async function notifySubmitters(events: ChangeEvent[], ctx: Pick<AlertContext, "db" | "config" | "mailer">): Promise<number> {
  const { db, config } = ctx;
  let sent = 0;
  const candidates: { submissionId: string; promiseId: string; url: string; kind: "card" | "evidence" }[] = [];
  for (const e of events) {
    if (!e.promise_id) continue; // only card changes can carry a submission
    if (e.change_type === "new_card" && e.submission_ref) {
      candidates.push({ submissionId: e.submission_ref, promiseId: e.promise_id, url: e.url, kind: "card" });
    } else if ((e.change_type === "event" || e.change_type === "deadline_missed") && e.evidence_url) {
      const rows = await db.query<{ id: string }>(
        `SELECT id FROM submission WHERE kind = 'evidence' AND promise_id = $1 AND url = $2
            AND status NOT IN ('merged_into', 'rejected', 'duplicate') ORDER BY received_at`,
        [e.promise_id, e.evidence_url],
      );
      for (const r of rows) candidates.push({ submissionId: r.id, promiseId: e.promise_id, url: e.url, kind: "evidence" });
    }
  }
  for (const c of candidates) {
    const [row] = await db.query<{ id: string; contact_email_enc: string | null }>(
      "SELECT id, contact_email_enc FROM submission WHERE id = $1 AND status <> 'merged_into'",
      [c.submissionId],
    );
    if (!row) continue;
    if (row.contact_email_enc) {
      try {
        const { subject, text } = submitterEmail(row.id, c.url, c.kind);
        await ctx.mailer.send({ to: decrypt(config.encryptionKey, row.contact_email_enc), subject, text });
        sent++;
      } catch (err) {
        // Leave the submission as it was, so a re-run of this job tries again.
        console.error("submitter update failed:", errorText(err));
        continue;
      }
    }
    await db.query("UPDATE submission SET status = 'merged_into', resulting_promise_id = $2, contact_email_enc = NULL WHERE id = $1", [row.id, c.promiseId]);
  }
  return sent;
}

/** The whole instant path for one push: fan-out, then submitter updates. */
export async function processChanges(events: ChangeEvent[], ctx: AlertContext): Promise<FanOutReport> {
  const report = await fanOut(events, ctx);
  report.submitterUpdates = await notifySubmitters(events, ctx);
  return report;
}
