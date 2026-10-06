import { z } from "./zod";
import { normaliseUrl, parseVideoTime } from "./normalise";

/**
 * What a reader may send (PRD F8). Every field except the link is optional.
 * Messages are written for the reader and shown next to the field.
 */

export const LIMITS = { url: 2000, actor: 200, quote: 2000, email: 254, handle: 40, videoTime: 12 } as const;

export const FIELD_MESSAGES = {
  kind: "Choose what you are sending.",
  promise_id: "Choose the card this evidence is for.",
  evidence_type: "Choose what changed.",
  url: "Add a link that starts with https://",
  url_long: `Links can be up to ${LIMITS.url} characters.`,
  url_credentials: "Send the link without a user name or password in it.",
  video_time: "Write the time as mm:ss or h:mm:ss, for example 12:34.",
  claimed_date: "Use a real date that is not in the future.",
  claimed_actor: `Keep this under ${LIMITS.actor} characters.`,
  claimed_quote: `Keep the words under ${LIMITS.quote.toLocaleString("en-GB")} characters.`,
  contact_email: "Check the email address, or leave it blank.",
  credit_handle: `Use up to ${LIMITS.handle} letters, numbers, spaces, dots, dashes or underscores, or leave it blank.`,
} as const;

/** A public handle: no email addresses, links or markup. */
const HANDLE = /^[\p{L}\p{N}][\p{L}\p{N} ._'’-]*$/u;

const text = (max: number, message: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() || undefined : v === null ? undefined : v),
    z.string(message).max(max, message).optional(),
  );

export interface IntakeRules {
  /** Ids of published cards (evidence must point at one). */
  promiseIds: ReadonlySet<string>;
  /** Allowed "what changed" ids (EVIDENCE_OPTIONS in the web app). */
  evidenceTypes: readonly string[];
  now?: Date;
}

export interface ValidSubmission {
  kind: "new_promise" | "evidence";
  promise_id: string | null;
  evidence_type: string | null;
  url: string;
  url_normalised: string;
  /** Seconds; from the form, else from the link's t=/start=. */
  video_time: number | null;
  claimed_actor: string | null;
  claimed_quote: string | null;
  claimed_date: string | null;
  contact_email: string | null;
  credit_handle: string | null;
  altcha: string;
}

export type FieldErrors = Partial<Record<keyof typeof FIELD_MESSAGES | "altcha", string>>;

function schema(rules: IntakeRules) {
  const today = (rules.now ?? new Date()).toISOString().slice(0, 10);
  return z
    .object({
      kind: z.enum(["new_promise", "evidence"], FIELD_MESSAGES.kind),
      promise_id: text(100, FIELD_MESSAGES.promise_id),
      evidence_type: text(40, FIELD_MESSAGES.evidence_type),
      url: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string(FIELD_MESSAGES.url).min(1, FIELD_MESSAGES.url)),
      video_time: text(LIMITS.videoTime, FIELD_MESSAGES.video_time),
      claimed_actor: text(LIMITS.actor, FIELD_MESSAGES.claimed_actor),
      claimed_quote: text(LIMITS.quote, FIELD_MESSAGES.claimed_quote),
      claimed_date: text(10, FIELD_MESSAGES.claimed_date),
      contact_email: text(LIMITS.email, FIELD_MESSAGES.contact_email),
      credit_handle: text(LIMITS.handle, FIELD_MESSAGES.credit_handle),
      altcha: z.string().max(10_000).optional(),
    })
    .superRefine((v, ctx) => {
      const issue = (path: keyof FieldErrors, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
      if (v.url.length > LIMITS.url) issue("url", FIELD_MESSAGES.url_long);
      else {
        try {
          const u = new URL(v.url);
          if (u.protocol !== "http:" && u.protocol !== "https:") issue("url", FIELD_MESSAGES.url);
          else if (u.username || u.password) issue("url", FIELD_MESSAGES.url_credentials);
          else if (!u.hostname.includes(".") && !u.hostname.startsWith("[")) issue("url", FIELD_MESSAGES.url);
        } catch {
          issue("url", FIELD_MESSAGES.url);
        }
      }
      if (v.kind === "evidence") {
        if (!v.promise_id || !rules.promiseIds.has(v.promise_id)) issue("promise_id", FIELD_MESSAGES.promise_id);
        if (!v.evidence_type || !rules.evidenceTypes.includes(v.evidence_type)) issue("evidence_type", FIELD_MESSAGES.evidence_type);
      }
      if (v.video_time !== undefined) {
        const t = parseVideoTime(v.video_time);
        if (t === null || t > 24 * 3600) issue("video_time", FIELD_MESSAGES.video_time);
      }
      if (v.claimed_date !== undefined) {
        const ok = /^\d{4}-\d{2}-\d{2}$/.test(v.claimed_date) && !Number.isNaN(Date.parse(`${v.claimed_date}T00:00:00Z`));
        if (!ok || v.claimed_date < "1900-01-01" || v.claimed_date > today) issue("claimed_date", FIELD_MESSAGES.claimed_date);
      }
      if (v.contact_email !== undefined && !z.email().safeParse(v.contact_email).success) issue("contact_email", FIELD_MESSAGES.contact_email);
      if (v.credit_handle !== undefined && (!HANDLE.test(v.credit_handle) || /https?:|www\./i.test(v.credit_handle)))
        issue("credit_handle", FIELD_MESSAGES.credit_handle);
    });
}

export function validateSubmission(body: unknown, rules: IntakeRules): { ok: true; data: ValidSubmission } | { ok: false; fields: FieldErrors } {
  const parsed = schema(rules).safeParse(body ?? {});
  if (!parsed.success) {
    const fields: FieldErrors = {};
    for (const i of parsed.error.issues) {
      const key = String(i.path[0] ?? "url") as keyof FieldErrors;
      fields[key] ??= key === "altcha" ? "The spam check did not finish. Try again." : i.message;
    }
    return { ok: false, fields };
  }
  const v = parsed.data;
  const norm = normaliseUrl(v.url);
  const evidence = v.kind === "evidence";
  return {
    ok: true,
    data: {
      kind: v.kind,
      promise_id: evidence ? v.promise_id! : null,
      evidence_type: evidence ? v.evidence_type! : null,
      url: v.url,
      url_normalised: norm.url,
      video_time: v.video_time !== undefined ? parseVideoTime(v.video_time) : norm.linkTime,
      claimed_actor: v.claimed_actor ?? null,
      claimed_quote: v.claimed_quote ?? null,
      claimed_date: v.claimed_date ?? null,
      contact_email: v.contact_email ?? null,
      credit_handle: v.credit_handle ?? null,
      altcha: v.altcha ?? "",
    },
  };
}
