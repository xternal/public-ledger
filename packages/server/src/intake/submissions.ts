import type { Config } from "../config";
import type { Db } from "../db";
import type { Mailer } from "../mail";
import { encrypt, hashToken, newToken, normaliseEmail } from "../crypto";
import { rateLimit, verifySpamCheck } from "../spam";
import { countUsage } from "../usage";
import { formatVideoTime } from "./normalise";
import { normaliseForMatch } from "./text";
import { validateSubmission, type FieldErrors, type IntakeRules, type ValidSubmission } from "./validate";

/**
 * Receiving a reader submission (PRD F8, PROMISE_STANDARD §8). It becomes a
 * row in the editors' queue, never a card (invariant 8). No IP, name or user
 * agent is stored; an email, if given, is stored only encrypted and can be
 * deleted by the submitter with the link in their receipt. It is kept only
 * until the editors decide (triage deletes it after the last email), and 90
 * days at most (the daily job). A duplicate on arrival keeps none at all.
 */

/** Submissions per client per day (counted per HMAC of the IP with the day's salt). */
export const SUBMIT_DAILY_LIMIT = 10;
/** Same link (and, for video, the same moment ±30 s) within this many days is a duplicate. */
export const DUPLICATE_WINDOW_DAYS = 180;
export const DUPLICATE_TIME_SECONDS = 30;
/** A submitter's email is deleted after this many days, whatever happened to the submission. */
export const SUBMITTER_EMAIL_RETENTION_DAYS = 90;

export type ReceiveResult =
  | { ok: true; reference: string; status: "received" | "duplicate"; duplicateOf: string | null; receiptSent: boolean | null }
  | { ok: false; httpStatus: 400 | 429; error: "invalid" | "spam_check" | "rate_limited"; fields?: FieldErrors };

export interface ReceiveDeps {
  db: Db;
  config: Config;
  mail: Mailer;
  rules: IntakeRules;
  /** Per-client key for rate limiting (the request IP); never stored. */
  clientKey: string;
  now?: Date;
  /** Defaults to the ALTCHA check; tests may stand in for it. */
  verifySpam?: (payload: string) => Promise<boolean>;
  dailyLimit?: number;
}

// ---------------------------------------------------------------- references

const MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" });

/** "S-2026-10-" for a date, by the UK calendar month. */
export function referencePrefix(now: Date): string {
  const parts = Object.fromEntries(MONTH.formatToParts(now).map((p) => [p.type, p.value]));
  return `S-${parts.year}-${parts.month}-`;
}

/**
 * Next reference for the month, e.g. S-2026-10-0001. Call inside a transaction:
 * the advisory lock serialises allocation until the row is inserted and committed.
 */
export async function allocateReference(tx: Db, now: Date): Promise<string> {
  await tx.query("SELECT pg_advisory_xact_lock(4242001)");
  const prefix = referencePrefix(now);
  const [row] = await tx.query<{ n: number | null }>(
    "SELECT MAX(CAST(substring(id from 11) AS INTEGER)) AS n FROM submission WHERE id LIKE $1",
    [`${prefix}%`],
  );
  const next = Number(row?.n ?? 0) + 1;
  if (next > 9999) throw new Error("submission references for this month are exhausted");
  return `${prefix}${String(next).padStart(4, "0")}`;
}

// ---------------------------------------------------------------- duplicates

interface EarlierRow {
  id: string;
  kind: string;
  promise_id: string | null;
  evidence_type: string | null;
  video_time: string | null;
  claimed_quote: string | null;
  status: string;
  checks: { duplicate_of?: string } | null;
}

function quotesCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const x = normaliseForMatch(a).text;
  const y = normaliseForMatch(b).text;
  return x.includes(y) || y.includes(x);
}

/**
 * The earlier submission this one repeats, if any: same normalised link within
 * 180 days, same moment (±30 s) when a video time is given, and the same kind
 * and card. Different words from the same page (a manifesto) are not duplicates.
 */
export async function findDuplicate(db: Db, s: ValidSubmission, now: Date): Promise<string | null> {
  const since = new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = await db.query<EarlierRow>(
    `SELECT id, kind, promise_id, evidence_type, video_time, claimed_quote, status, checks
       FROM submission WHERE url_normalised = $1 AND received_at >= $2 ORDER BY received_at ASC, id ASC`,
    [s.url_normalised, since],
  );
  for (const r of rows) {
    if (r.kind !== s.kind) continue;
    if (s.kind === "evidence" && (r.promise_id !== s.promise_id || r.evidence_type !== s.evidence_type)) continue;
    const t = r.video_time === null ? null : Number(r.video_time);
    if ((t === null) !== (s.video_time === null)) continue;
    if (t !== null && Math.abs(t - s.video_time!) > DUPLICATE_TIME_SECONDS) continue;
    if (!quotesCompatible(r.claimed_quote, s.claimed_quote)) continue;
    return r.status === "duplicate" && r.checks?.duplicate_of ? r.checks.duplicate_of : r.id;
  }
  return null;
}

// ---------------------------------------------------------------- receiving

function receiptText(config: Config, reference: string, s: ValidSubmission, deleteToken: string): string {
  const lines = [
    "Thank you. Public Ledger has received your submission.",
    "",
    `Your reference: ${reference}`,
    `Link you sent: ${s.url}${s.video_time !== null ? ` (at ${formatVideoTime(s.video_time)})` : ""}`,
    "",
    "What happens next: we archive the source and check the words against it. An editor looks at it within three working days. Nothing is published unless two editors agree.",
    "",
    s.credit_handle
      ? `We keep your email only to tell you what happens to this submission. If it becomes a card, we credit you as "${s.credit_handle}".`
      : "We keep your email only to tell you what happens to this submission.",
    `We delete it once the editors decide, and after ${SUBMITTER_EMAIL_RETENTION_DAYS} days at the latest.`,
    "",
    "To delete your email from our records, open this link and press the button:",
    `${config.siteUrl}/submission/delete?t=${deleteToken}`,
    "",
    "Public Ledger",
  ];
  return lines.join("\n");
}

/** The receipt for a duplicate on arrival: the editors already have it, so the address is not kept. */
function duplicateReceiptText(reference: string, s: ValidSubmission): string {
  return [
    "Thank you. Public Ledger has received your submission.",
    "",
    `Your reference: ${reference}`,
    `Link you sent: ${s.url}${s.video_time !== null ? ` (at ${formatVideoTime(s.video_time)})` : ""}`,
    "",
    "Another reader sent this first, so the editors already have it.",
    "",
    "We have not kept your email address, so this is the only email about this submission.",
    "",
    "Public Ledger",
  ].join("\n");
}

export async function receiveSubmission(body: unknown, deps: ReceiveDeps): Promise<ReceiveResult> {
  const { db, config, mail } = deps;
  const now = deps.now ?? new Date();

  // 1. Validate first, so a reader fixing a field keeps their solved spam check.
  const valid = validateSubmission(body, { ...deps.rules, now });
  if (!valid.ok) {
    if (valid.fields.url) await countUsage(db, { event: "submission_blocked", props: { reason: "invalid_url" } }, 1, now);
    return { ok: false, httpStatus: 400, error: "invalid", fields: valid.fields };
  }
  const s = valid.data;

  // 2. Spam check (each solved challenge is accepted once), then 3. the daily limit.
  const verify = deps.verifySpam ?? ((payload: string) => verifySpamCheck(db, config, payload));
  if (!(await verify(s.altcha))) {
    await countUsage(db, { event: "submission_blocked", props: { reason: "spam_check" } }, 1, now);
    return { ok: false, httpStatus: 400, error: "spam_check" };
  }
  if (!(await rateLimit(db, deps.clientKey, "submit", deps.dailyLimit ?? SUBMIT_DAILY_LIMIT, now))) {
    await countUsage(db, { event: "submission_blocked", props: { reason: "rate_limited" } }, 1, now);
    return { ok: false, httpStatus: 429, error: "rate_limited" };
  }

  // 4. Duplicates are still stored, marked, so editors see how often a source comes in. They are final
  // (editors never triage them), so the email and credit name are not stored: the receipt is the only email.
  const duplicateOf = await findDuplicate(db, s, now);
  const status = duplicateOf ? "duplicate" : "received";
  const keepContact = !duplicateOf;
  const checks: Record<string, unknown> = {};
  if (duplicateOf) checks.duplicate_of = duplicateOf;
  // TODO(schema): the reader's date has no column yet; kept here until migration 002 adds claimed_date.
  if (s.claimed_date) checks.claimed_date = s.claimed_date;

  const token = s.contact_email && keepContact ? newToken() : null;
  const reference = await db.transaction(async (tx) => {
    const id = await allocateReference(tx, now);
    await tx.query(
      `INSERT INTO submission (id, kind, promise_id, evidence_type, url, url_normalised, video_time, claimed_actor, claimed_quote,
                               checks, contact_email_enc, credit_handle, delete_token_hash, status, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id,
        s.kind,
        s.promise_id,
        s.evidence_type,
        s.url,
        s.url_normalised,
        s.video_time === null ? null : String(s.video_time),
        s.claimed_actor,
        s.claimed_quote,
        JSON.stringify(checks),
        s.contact_email && keepContact ? encrypt(config.encryptionKey, normaliseEmail(s.contact_email)) : null,
        keepContact ? s.credit_handle : null,
        token?.hash ?? null,
        status,
        now.toISOString(),
      ],
    );
    return id;
  });
  await countUsage(db, { event: "submission_sent", props: { kind: s.kind } }, 1, now);

  // 5. Receipt, only if they gave an email. Report honestly whether it went.
  let receiptSent: boolean | null = null;
  if (s.contact_email) {
    try {
      const text = token ? receiptText(config, reference, s, token.token) : duplicateReceiptText(reference, s);
      await mail.send({ to: s.contact_email, subject: `Your submission ${reference}`, text });
      receiptSent = true;
    } catch (e) {
      console.error("submission receipt not sent:", (e as Error).name); // never the message: provider errors can echo the address
      receiptSent = false;
    }
  }
  return { ok: true, reference, status, duplicateOf, receiptSent };
}

// ---------------------------------------------------------------- delete my email

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,100}$/;

export interface DeleteTokenInfo {
  reference: string;
  /** Credit stays on a published card: the submission was accepted or merged. */
  creditPublished: boolean;
  hasCredit: boolean;
}

/** What a delete link refers to, without changing anything (the page's GET). */
export async function lookupDeleteToken(db: Db, token: string | null | undefined): Promise<DeleteTokenInfo | null> {
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  const [row] = await db.query<{ id: string; status: string; credit_handle: string | null }>(
    "SELECT id, status, credit_handle FROM submission WHERE delete_token_hash = $1",
    [hashToken(token)],
  );
  if (!row) return null;
  return { reference: row.id, creditPublished: ["accepted", "merged_into"].includes(row.status), hasCredit: row.credit_handle !== null };
}

export interface DeleteResult {
  reference: string;
  /** removed: the handle is gone; kept: it is on a published card; none: there was none. */
  credit: "removed" | "kept" | "none";
}

/**
 * Delete the submitter's email (and their credit handle, unless the card is
 * already published with it). The link stops working afterwards.
 */
export async function deleteSubmitterEmail(db: Db, token: string | null | undefined, now = new Date()): Promise<DeleteResult | null> {
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  const hash = hashToken(token);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.query<{ id: string; status: string; credit_handle: string | null }>(
      "SELECT id, status, credit_handle FROM submission WHERE delete_token_hash = $1 FOR UPDATE",
      [hash],
    );
    if (!row) return null;
    const published = ["accepted", "merged_into"].includes(row.status);
    await tx.query(
      `UPDATE submission SET contact_email_enc = NULL, delete_token_hash = NULL,
              credit_handle = CASE WHEN $2 THEN credit_handle ELSE NULL END
        WHERE id = $1`,
      [row.id, published],
    );
    const credit: DeleteResult["credit"] = row.credit_handle === null ? "none" : published ? "kept" : "removed";
    return { reference: row.id, credit };
  });
  if (result) await countUsage(db, { event: "data_deleted", props: { kind: "submitter" } }, 1, now);
  return result;
}

/**
 * Delete submitters' emails older than 90 days, whatever the submission's
 * status: never triaged, accepted but never merged, or anything else. The
 * delete link goes too, since there is nothing left for it to delete. Run
 * daily (alerts maintenance job). Returns how many emails were deleted.
 */
export async function pruneSubmitterEmails(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SUBMITTER_EMAIL_RETENTION_DAYS * 86_400_000).toISOString();
  const rows = await db.query(
    `UPDATE submission SET contact_email_enc = NULL, delete_token_hash = NULL
      WHERE received_at < $1 AND (contact_email_enc IS NOT NULL OR delete_token_hash IS NOT NULL) RETURNING id`,
    [cutoff],
  );
  return rows.length;
}

/** Server-side count of the contribute form being opened (no ids, no client analytics). */
export async function countFormOpened(db: Db, kind: "new" | "evidence", now = new Date()): Promise<void> {
  await countUsage(db, { event: "submit_form_opened", props: { kind } }, 1, now);
}
