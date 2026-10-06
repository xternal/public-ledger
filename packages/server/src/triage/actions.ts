import type { Config } from "../config";
import { decrypt } from "../crypto";
import type { Db } from "../db";
import type { Mailer } from "../mail";
import { countUsage } from "../usage";
import { errorText } from "../alerts/log";
import { draftEvidence, draftNewPromise, localCardReader, type DraftFile } from "./draft";
import { openDraftPr, readRepoFile, type GitHubOptions } from "./github";
import { getSubmission, OPEN_STATUSES, REJECT_REASONS, type RejectReason, type SubmissionView } from "./submissions";

/**
 * Editors' triage actions (PROMISE_STANDARD §8): accept into a draft pull
 * request, reject with a reason code, or mark as a duplicate. Each counts
 * `submission_triaged` (no ids) and, if the submitter left an address, sends
 * them a short status update. Rejection and duplicate are final, so the
 * address is deleted after that last update.
 */

export interface TriageContext {
  db: Db;
  config: Config;
  mailer: Mailer;
  fetch?: typeof fetch;
  now?: Date;
  /** Card ids already on the site, so a suggested id never collides. */
  existingIds?: Set<string>;
  /** Reads content/promises/<id>.yaml when there is no GitHub token. */
  readCard?: (promiseId: string) => string | null;
}

/** Error codes, so pages can show a fixed message (never text from a query string). */
export const TRIAGE_ERRORS = {
  not_found: "No submission with that reference.",
  already_triaged: "This submission was already triaged.",
  card_missing: "The card this evidence is for was not found on main.",
  github_failed: "Could not open the draft pull request. Nothing was changed; try again.",
  race: "Another editor triaged this submission first.",
  no_reason: "Choose a reason.",
  bad_duplicate: "Give a submission reference (S-…) or a card id.",
  self_duplicate: "A submission cannot duplicate itself.",
  not_open: "No open submission with that reference.",
} as const;
export type TriageError = keyof typeof TRIAGE_ERRORS;

export type TriageResult<T = object> = ({ ok: true } & T) | { ok: false; error: TriageError };

const ukToday = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const ukDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

function github(ctx: TriageContext): GitHubOptions | null {
  return ctx.config.github.token ? { token: ctx.config.github.token, repo: ctx.config.github.repo, fetch: ctx.fetch } : null;
}

/** The draft for a submission, as of the day it was (or is being) accepted. Deterministic, so triage can show it again later. */
export function draftFor(ctx: Pick<TriageContext, "existingIds" | "readCard" | "now">, s: SubmissionView, cardYaml?: string | null): DraftFile | null {
  const today = ukToday(s.triaged_at ? new Date(s.triaged_at) : (ctx.now ?? new Date()));
  if (s.kind === "new_promise") return draftNewPromise(s, { today, existingIds: ctx.existingIds });
  const yaml = cardYaml ?? (s.promise_id ? (ctx.readCard ?? localCardReader())(s.promise_id) : null);
  return yaml ? draftEvidence(s, yaml, { today }) : null;
}

export function prTitle(s: SubmissionView, draft: DraftFile): string {
  return s.kind === "new_promise" ? `Reader submission ${s.id}: new promise (draft)` : `Reader evidence ${s.id} for ${draft.promiseId} (draft)`;
}

export function prBody(s: SubmissionView, draft: DraftFile): string {
  const c = s.checks;
  const yesNo = (x: unknown) => (x === true ? "yes" : x === false ? "no" : "not checked");
  return [
    `Reader ${s.kind === "new_promise" ? "submission" : "evidence"} **${s.id}**, received ${ukDay(s.received_at)}. File: \`${draft.path}\`.`,
    "",
    "### Automatic checks",
    `- Link reachable: ${yesNo(c.reachable)}`,
    `- Archived copy: ${s.archived_url ?? "none"}`,
    `- Quote matched in a transcript: ${s.matched_quote ? "yes" : "not matched"}`,
    `- Possible duplicate of: ${s.duplicate_of ?? "none found"}`,
    `- Language-model suggestions: ${s.llm_prefill ? "in YAML comments, unverified" : "none"}`,
    "",
    "### Editors",
    ...(s.kind === "new_promise"
      ? [
          "- [ ] The words are verbatim at the source; `quote_checked_on` is set",
          "- [ ] `actor_id`, `made_on`, `policy_area` (and `venue`) are filled in; the id matches the file name",
          "- [ ] Parameters (who, how much as a low–high range, when, funded by) are exactly as stated, or left out",
          "- [ ] Status and events follow docs/PROMISE_STANDARD.md",
        ]
      : ["- [ ] The evidence supports the event; its date and text are filled in", "- [ ] Status changes, if any, follow docs/PROMISE_STANDARD.md", "- [ ] History is only appended to, never edited"]),
    "- [ ] Every TODO is gone and `pnpm validate` passes",
    "",
    "Two editors must approve before merge (invariant 8).",
  ].join("\n");
}

async function sendUpdate(ctx: TriageContext, encryptedAddress: string | null, message: { subject: string; text: string }): Promise<boolean> {
  if (!encryptedAddress) return false;
  try {
    await ctx.mailer.send({ to: decrypt(ctx.config.encryptionKey, encryptedAddress), ...message });
    return true;
  } catch (err) {
    console.error("submitter update failed:", errorText(err));
    return false;
  }
}

const SIGN_OFF = ["", "Public Ledger editors"];
const LAST_EMAIL = "This is the last email about this submission. We delete your email address from it once this is sent.";

/** Accept: open a draft PR (or, without a GitHub token, leave the YAML for an editor to copy), then mark it accepted. */
export async function acceptSubmission(
  ctx: TriageContext,
  id: string,
): Promise<TriageResult<{ prUrl: string | null; draft: DraftFile | null; already: boolean; emailed: boolean }>> {
  const s = await getSubmission(ctx.db, id);
  if (!s) return { ok: false, error: "not_found" };
  if (s.status === "accepted" || s.status === "merged_into") return { ok: true, prUrl: s.resulting_pr_url, draft: draftFor(ctx, s), already: true, emailed: false };
  if (!OPEN_STATUSES.includes(s.status)) return { ok: false, error: "already_triaged" };
  const now = ctx.now ?? new Date();
  const today = ukToday(now);
  const gh = github(ctx);

  let draft: DraftFile | null;
  let prUrl: string | null = null;
  try {
    if (s.kind === "evidence" && gh) {
      const card = s.promise_id ? await readRepoFile(gh, `content/promises/${s.promise_id}.yaml`, gh.base ?? "main") : null;
      if (!card) return { ok: false, error: "card_missing" };
      draft = draftEvidence(s, card.text, { today });
    } else {
      draft = draftFor({ ...ctx, now }, { ...s, triaged_at: null });
    }
    if (!draft) return { ok: false, error: "card_missing" };
    if (gh) {
      const d = draft;
      const pr = await openDraftPr(gh, {
        branch: `submission/${s.id}`,
        path: d.path,
        content: (current) => (d.mode === "new" ? d.yaml : current === null ? null : draftEvidence(s, current, { today }).yaml),
        message: d.mode === "new" ? `Draft card from reader submission ${s.id}` : `Reader evidence ${s.id} for ${d.promiseId}`,
        title: prTitle(s, d),
        body: prBody(s, d),
      });
      prUrl = pr.url;
    }
  } catch (err) {
    console.error("accept failed:", errorText(err));
    return { ok: false, error: "github_failed" };
  }

  const [row] = await ctx.db.query<{ contact_email_enc: string | null }>(
    `UPDATE submission SET status = 'accepted', resulting_pr_url = $2, triaged_at = $3
      WHERE id = $1 AND status IN ('received', 'auto_checked', 'in_review') RETURNING contact_email_enc`,
    [s.id, prUrl, now.toISOString()],
  );
  if (!row) return { ok: false, error: "race" };
  await countUsage(ctx.db, { event: "submission_triaged", props: { outcome: "accepted", reason_code: "none" } }, 1, now);
  const emailed = await sendUpdate(ctx, row.contact_email_enc, {
    subject: `Your submission ${s.id} was accepted`,
    text: [
      `An editor accepted your submission ${s.id} and started a draft for the ledger.`,
      "",
      "Two editors check every change against the original source before it is published, so it can still change or be turned down.",
      "We will email you once more when it is on the site.",
      ...SIGN_OFF,
    ].join("\n"),
  });
  return { ok: true, prUrl, draft, already: false, emailed };
}

const REASON_TEXT: Record<RejectReason, string> = {
  no_primary_source: "we could not find a primary source for it: an official document, or a recording or transcript of the person saying it",
  not_a_promise: "it is not a promise we can track: a specific commitment by a named politician, party or government",
  duplicate: "we already have it",
  out_of_scope: "it is outside what Public Ledger covers",
};

export function isRejectReason(x: unknown): x is RejectReason {
  return typeof x === "string" && (REJECT_REASONS as readonly string[]).includes(x);
}

export async function rejectSubmission(ctx: TriageContext, id: string, reason: RejectReason): Promise<TriageResult<{ emailed: boolean }>> {
  if (!isRejectReason(reason)) return { ok: false, error: "no_reason" };
  const now = ctx.now ?? new Date();
  const [row] = await ctx.db.query<{ contact_email_enc: string | null }>(
    `UPDATE submission SET status = 'rejected', reason_code = $2, triaged_at = $3
      WHERE id = $1 AND status IN ('received', 'auto_checked', 'in_review') RETURNING contact_email_enc`,
    [id, reason, now.toISOString()],
  );
  if (!row) return { ok: false, error: "not_open" };
  await countUsage(ctx.db, { event: "submission_triaged", props: { outcome: "rejected", reason_code: reason } }, 1, now);
  const emailed = await sendUpdate(ctx, row.contact_email_enc, {
    subject: `Your submission ${id}`,
    text: [`Thank you for sending ${id}. The editors did not add it, because ${REASON_TEXT[reason]}.`, "", LAST_EMAIL, ...SIGN_OFF].join("\n"),
  });
  await ctx.db.query("UPDATE submission SET contact_email_enc = NULL WHERE id = $1", [id]);
  return { ok: true, emailed };
}

const REF = /^S-\d{4}-\d{2}-\d{4}$/;
const CARD = /^[a-z0-9-]+$/;

/** Duplicate of another submission (S-…) or of a card already on the site (its id). */
export async function markDuplicate(ctx: TriageContext, id: string, of: string): Promise<TriageResult<{ emailed: boolean }>> {
  const target = of.trim();
  if (!REF.test(target) && !CARD.test(target)) return { ok: false, error: "bad_duplicate" };
  if (target === id) return { ok: false, error: "self_duplicate" };
  const isCard = !REF.test(target);
  const now = ctx.now ?? new Date();
  const [row] = await ctx.db.query<{ contact_email_enc: string | null }>(
    `UPDATE submission SET status = 'duplicate', reason_code = 'duplicate', triaged_at = $3,
            resulting_promise_id = $4, checks = checks || jsonb_build_object('duplicate_of_confirmed', $2::text)
      WHERE id = $1 AND status IN ('received', 'auto_checked', 'in_review') RETURNING contact_email_enc`,
    [id, target, now.toISOString(), isCard ? target : null],
  );
  if (!row) return { ok: false, error: "not_open" };
  await countUsage(ctx.db, { event: "submission_triaged", props: { outcome: "duplicate", reason_code: "duplicate" } }, 1, now);
  const where = isCard ? `It is already on the site: ${ctx.config.siteUrl}/promise/${target}` : "Another reader sent it first, and editors are already looking at it.";
  const emailed = await sendUpdate(ctx, row.contact_email_enc, {
    subject: `Your submission ${id}`,
    text: [`Thank you for sending ${id}. We already have it. ${where}`, "", LAST_EMAIL, ...SIGN_OFF].join("\n"),
  });
  await ctx.db.query("UPDATE submission SET contact_email_enc = NULL WHERE id = $1", [id]);
  return { ok: true, emailed };
}
