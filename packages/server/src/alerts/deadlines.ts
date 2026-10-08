import {
  WINDOW_LABEL,
  dueInWindow,
  isDeadlineWindow,
  monthKey,
  ukDay,
  widestWindow,
  windowPhrase,
  type DeadlineWindow,
} from "@ledger/schema";
import { changeId, type ChangeEvent } from "./diff";
import { countSent, deliverText, storeEvents, type AlertContext } from "./fanout";
import { statusLabel, truncate, ukDate } from "./labels";
import { errorText } from "./log";
import { footer, type ManageLinks } from "./messages";

/**
 * "Tell me what's due" (PRE_SHIP_REVIEW F9): once a month, people who follow a
 * deadline window get the open promises due in it, nearest first. Outcomes in
 * between (delivered, deadline passed) reach them through the normal fan-out.
 *
 * The weekly digest run (Mondays) calls this; it sends in the first week of a
 * UK month only, once per subscription per month: the month's list is stored
 * as a change event and claimed per subscription like any other delivery, so
 * a re-run sends nothing twice and retries what failed. Someone who follows
 * two windows gets one list, for the wider one. A window with nothing due
 * sends nothing.
 */

/** A card as the monthly list needs it. */
export interface DueCard {
  id: string;
  deadline?: string;
  status: string;
  /** "Andy Burnham: “…”" */
  title: string;
}

/** The monthly list goes out on the first run in days 1 to 7 of a UK month (the first Monday's digest run). */
export const isFirstWeek = (today: string) => Number(today.slice(8, 10)) <= 7;

function dueLine(c: DueCard, today: string): string {
  const passed = c.deadline! < today ? ", deadline passed" : "";
  return `${ukDate(c.deadline!)}: ${truncate(c.title, 140)} (${statusLabel(c.status)}${passed})`;
}

const plural = (n: number) => `${n} ${n === 1 ? "promise" : "promises"}`;

/** The stored change for one window's list in one month. One row per window and month, shared by every follower of it. */
export function comingDueEvent(w: DeadlineWindow, items: DueCard[], today: string, opts: { siteUrl: string; commit: string }): ChangeEvent {
  const site = opts.siteUrl.replace(/\/$/, "");
  return {
    id: changeId(null, `deadline_window:${w}`, "coming_due", monthKey(today)),
    promise_id: null,
    actor_id: null,
    policy_area: null,
    change_type: "coming_due",
    summary: `${plural(items.length)} due ${windowPhrase(w, today)}: ${items.map((c) => c.id).join(", ")}`,
    url: `${site}/promises#coming-up`,
    commit_sha: opts.commit,
    title: "Coming due",
  };
}

export function comingDueEmail(
  w: DeadlineWindow,
  items: DueCard[],
  today: string,
  siteUrl: string,
  links: ManageLinks,
): { subject: string; text: string } {
  const site = siteUrl.replace(/\/$/, "");
  const when = windowPhrase(w, today);
  return {
    subject: `Coming due: ${plural(items.length)} ${when}`,
    text: [
      `${plural(items.length)} on Public Ledger ${items.length === 1 ? "is" : "are"} due ${when}, nearest deadline first.`,
      "",
      items.map((c) => [dueLine(c, today), `  ${site}/promise/${c.id}`].join("\n")).join("\n\n"),
      "",
      `You get this list once a month because you follow “${WINDOW_LABEL[w]}”. You also hear when one of these is delivered or its deadline passes.`,
      `All of them: ${site}/promises#coming-up`,
      "",
      footer(links),
    ].join("\n"),
  };
}

export function comingDueTelegram(w: DeadlineWindow, items: DueCard[], today: string, siteUrl: string): string {
  const site = siteUrl.replace(/\/$/, "");
  const head = `Coming due ${windowPhrase(w, today)}: ${plural(items.length)}, nearest first.`;
  const body = items.map((c) => `• ${dueLine(c, today)}\n${site}/promise/${c.id}`).join("\n\n");
  const text = [head, body, "Send /stop to stop these alerts."].join("\n\n");
  return text.length <= 3800 ? text : `${text.slice(0, 3700)}…\n\nAll of them: ${site}/promises#coming-up\n\nSend /stop to stop these alerts.`;
}

export interface ComingDueReport {
  subscriptions: number;
  emails: number;
  telegrams: number;
  failed: number;
  /** Why nothing was sent, when nothing could be. */
  skipped?: "not_first_week";
}

/**
 * Send this month's list to every confirmed deadline-window follower who has
 * not had it yet. `force` sends outside the first week (a manual run).
 */
export async function runComingDue(
  ctx: Pick<AlertContext, "db" | "config" | "mailer" | "telegram" | "now">,
  opts: { cards: DueCard[]; commit: string; force?: boolean },
): Promise<ComingDueReport> {
  const { db, config } = ctx;
  const now = ctx.now ?? new Date();
  const today = ukDay(now);
  const report: ComingDueReport = { subscriptions: 0, emails: 0, telegrams: 0, failed: 0 };
  if (!opts.force && !isFirstWeek(today)) return { ...report, skipped: "not_first_week" };

  const rows = await db.query<{ id: string; channel: "email" | "telegram"; target_id: string }>(
    `SELECT s.id, s.channel, t.target_id FROM subscription s JOIN subscription_target t ON t.subscription_id = s.id
      WHERE s.confirmed_at IS NOT NULL AND t.kind = 'deadline_window' ORDER BY s.id, t.target_id`,
  );
  const subs = new Map<string, { id: string; channel: "email" | "telegram"; windows: DeadlineWindow[] }>();
  for (const r of rows) {
    if (!isDeadlineWindow(r.target_id)) continue;
    const s = subs.get(r.id) ?? { id: r.id, channel: r.channel, windows: [] };
    s.windows.push(r.target_id);
    subs.set(r.id, s);
  }

  const lists = new Map<DeadlineWindow, { items: DueCard[]; event: ChangeEvent } | null>();
  const listFor = async (w: DeadlineWindow) => {
    if (!lists.has(w)) {
      const items = dueInWindow(opts.cards, w, today);
      const event = items.length ? comingDueEvent(w, items, today, { siteUrl: config.siteUrl, commit: opts.commit }) : null;
      if (event) await storeEvents(db, [event], now);
      lists.set(w, event ? { items, event } : null);
    }
    return lists.get(w)!;
  };

  for (const sub of subs.values()) {
    const w = widestWindow(sub.windows)!;
    const list = await listFor(w);
    if (!list) continue; // nothing due: nothing to say
    // Claim: a new row, or one a previous run marked failed.
    const claimed = await db.query(
      `INSERT INTO delivery (change_id, subscription_id, status, at) VALUES ($1, $2, 'sent', $3)
       ON CONFLICT (change_id, subscription_id) DO UPDATE SET status = 'sent', at = EXCLUDED.at WHERE delivery.status = 'failed'
       RETURNING change_id`,
      [list.event.id, sub.id, now.toISOString()],
    );
    if (!claimed.length) continue;
    report.subscriptions++;
    try {
      await deliverText(ctx, sub, {
        email: (links) => comingDueEmail(w, list.items, today, config.siteUrl, links),
        telegram: () => comingDueTelegram(w, list.items, today, config.siteUrl),
      });
      if (sub.channel === "email") report.emails++;
      else report.telegrams++;
      await countSent(db, sub.channel, [list.event], now);
    } catch (err) {
      report.failed++;
      console.error(`coming-due delivery failed (${sub.channel}):`, errorText(err));
      await db.query("UPDATE delivery SET status = 'failed' WHERE change_id = $1 AND subscription_id = $2", [list.event.id, sub.id]);
    }
  }
  return report;
}
