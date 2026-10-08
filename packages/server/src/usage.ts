import type { Db } from "./db";

/**
 * Aggregate usage counts, server-side (analytics privacy rules 3 and 4): one
 * row per day per event per property value, no identifiers. Property values
 * must be ids or fixed enums, never free text, emails or IPs. Follow and
 * submission events must not carry promise or actor ids (rule 6).
 */
export type UsageEvent =
  | { event: "follow_started"; props: { channel: "email" | "telegram"; target_kind: string } }
  | { event: "follow_confirmed"; props: { channel: "email" | "telegram" } }
  | { event: "unsubscribe_completed"; props: { channel: "email" | "telegram" } }
  | { event: "data_deleted"; props: { kind: "subscriber" | "submitter" } }
  | { event: "digest_chosen"; props: { channel: "email" } }
  | { event: "submit_form_opened"; props: { kind: "new" | "evidence" } }
  | { event: "submission_sent"; props: { kind: "new_promise" | "evidence" } }
  | { event: "submission_blocked"; props: { reason: "invalid_url" | "rate_limited" | "spam_check" } }
  | { event: "submission_auto_checked"; props: { archived: "yes" | "no"; quote_matched: "yes" | "no" | "na"; duplicate: "yes" | "no" } }
  | { event: "submission_triaged"; props: { outcome: "accepted" | "rejected" | "duplicate"; reason_code: string } }
  | { event: "alert_sent"; props: { channel: "email" | "telegram"; change_type: string } }
  | { event: "t1_requested"; props: { outcome: T1Outcome } }
  /** /mp: how a search went. Never the postcode, name or constituency searched for. */
  | { event: "mp_lookup"; props: { by: "postcode" | "name"; outcome: "found" | "choices" | "not_found" | "unavailable" } };

/** What a request for "who gains and loses" came to: for cache-hit and failure rates. */
export type T1Outcome = "cached" | "started" | "pending" | "ready" | "not_applicable" | "error" | "rate_limited";

export async function countUsage(db: Db, e: UsageEvent, n = 1, day = new Date()): Promise<void> {
  const d = day.toISOString().slice(0, 10);
  const rows: [string, string][] = [["", ""], ...Object.entries(e.props).map(([k, v]) => [k, String(v)] as [string, string])];
  for (const [k, v] of rows) {
    await db.query(
      `INSERT INTO usage_daily (day, event, prop_key, prop_value, count) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (day, event, prop_key, prop_value) DO UPDATE SET count = usage_daily.count + EXCLUDED.count`,
      [d, e.event, k, v, n],
    );
  }
}
