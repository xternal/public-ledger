import type { Db } from "../db";

/**
 * Submissions as editors see them in triage. The contact address is never
 * selected: editors see only whether there is one.
 */

export const SUBMISSION_STATUSES = ["received", "auto_checked", "in_review", "accepted", "merged_into", "rejected", "duplicate"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
/** Waiting for an editor. */
export const OPEN_STATUSES: SubmissionStatus[] = ["received", "auto_checked", "in_review"];

export const REJECT_REASONS = ["no_primary_source", "not_a_promise", "duplicate", "out_of_scope"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const REJECT_REASON_LABEL: Record<RejectReason, string> = {
  no_primary_source: "No primary source",
  not_a_promise: "Not a promise",
  duplicate: "Duplicate",
  out_of_scope: "Out of scope",
};

export const STATUS_FILTERS = ["open", "all", ...SUBMISSION_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export interface SubmissionView {
  id: string;
  kind: "new_promise" | "evidence";
  status: SubmissionStatus;
  received_at: string;
  triaged_at: string | null;
  promise_id: string | null;
  evidence_type: string | null;
  url: string;
  archived_url: string | null;
  video_time: string | null;
  claimed_actor: string | null;
  claimed_quote: string | null;
  matched_quote: { text: string; source_span?: [number, number] } | null;
  /** Automatic duplicate hint from intake (another reference or a card id). */
  duplicate_of: string | null;
  checks: Record<string, unknown>;
  /** Unverified suggestions from the language model. */
  llm_prefill: Record<string, unknown> | null;
  has_email: boolean;
  credit_handle: string | null;
  reason_code: string | null;
  resulting_pr_url: string | null;
  resulting_promise_id: string | null;
}

// contact_email_enc and delete_token_hash are deliberately absent.
const COLUMNS = `id, kind, status, received_at, triaged_at, promise_id, evidence_type, url, archived_url, video_time,
  claimed_actor, claimed_quote, matched_quote, checks, llm_prefill, credit_handle, reason_code, resulting_pr_url,
  resulting_promise_id, (contact_email_enc IS NOT NULL) AS has_email`;

type Row = Omit<SubmissionView, "received_at" | "triaged_at" | "duplicate_of" | "checks" | "matched_quote" | "llm_prefill"> & {
  received_at: Date | string;
  triaged_at: Date | string | null;
  checks: unknown;
  matched_quote: unknown;
  llm_prefill: unknown;
};

const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());
const json = (x: unknown): unknown => (typeof x === "string" ? safeParse(x) : x);
function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

function view(r: Row): SubmissionView {
  const checks = obj(json(r.checks)) ?? {};
  const mq = obj(json(r.matched_quote));
  const dup = checks.duplicate_of;
  return {
    ...r,
    received_at: iso(r.received_at)!,
    triaged_at: iso(r.triaged_at),
    checks,
    matched_quote: mq && typeof mq.text === "string" ? (mq as SubmissionView["matched_quote"]) : null,
    duplicate_of: typeof dup === "string" && dup ? dup : null,
    llm_prefill: obj(json(r.llm_prefill)),
    has_email: Boolean(r.has_email),
  };
}

export function isStatusFilter(x: unknown): x is StatusFilter {
  return typeof x === "string" && (STATUS_FILTERS as readonly string[]).includes(x);
}

/** Newest first. `open` (the default) is everything waiting for an editor. */
export async function listSubmissions(db: Db, filter: StatusFilter = "open", limit = 200): Promise<SubmissionView[]> {
  const order = `ORDER BY received_at DESC, id DESC LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}`;
  let rows: Row[];
  if (filter === "all") rows = await db.query<Row>(`SELECT ${COLUMNS} FROM submission ${order}`);
  else if (filter === "open") rows = await db.query<Row>(`SELECT ${COLUMNS} FROM submission WHERE status IN ('received', 'auto_checked', 'in_review') ${order}`);
  else rows = await db.query<Row>(`SELECT ${COLUMNS} FROM submission WHERE status = $1 ${order}`, [filter]);
  return rows.map(view);
}

export async function getSubmission(db: Db, id: string): Promise<SubmissionView | null> {
  if (!/^S-\d{4}-\d{2}-\d{4}$/.test(id)) return null;
  const [row] = await db.query<Row>(`SELECT ${COLUMNS} FROM submission WHERE id = $1`, [id]);
  return row ? view(row) : null;
}

export async function countByStatus(db: Db): Promise<Record<string, number>> {
  const rows = await db.query<{ status: string; n: number | string }>("SELECT status, count(*) AS n FROM submission GROUP BY status");
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
