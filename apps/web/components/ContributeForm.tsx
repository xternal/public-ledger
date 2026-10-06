"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CardView } from "@ledger/schema";
import { EVIDENCE_OPTIONS } from "@/lib/copy";
import { SpamCheck } from "./SpamCheck";

export type SubmissionKind = "new" | "evidence";

/** Field names as the API takes them (POST /api/submissions). */
type Field =
  | "promise_id"
  | "evidence_type"
  | "url"
  | "claimed_actor"
  | "claimed_date"
  | "video_time"
  | "claimed_quote"
  | "contact_email"
  | "credit_handle";
type Values = Record<Field, string>;
type Errors = Partial<Record<Field, string>>;

const EMPTY: Omit<Values, "promise_id" | "evidence_type"> = {
  url: "",
  claimed_actor: "",
  claimed_date: "",
  video_time: "",
  claimed_quote: "",
  contact_email: "",
  credit_handle: "",
};

const ORDER: Field[] = ["promise_id", "evidence_type", "url", "claimed_actor", "claimed_date", "video_time", "claimed_quote", "contact_email", "credit_handle"];
const URL_PATTERN = /^https?:\/\/[^\s/]+\.[^\s]+$/i;
const TIME_PATTERN = /^(?:\d{1,3}:[0-5]\d|\d{1,2}:[0-5]\d:[0-5]\d)$/;
const HANDLE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._'’-]*$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HANDLE_MAX = 40;
/** If the background check has not finished by then, offer to run it again. */
const CHECK_SLOW_MS = 20_000;

/** The same rules the server applies, so most mistakes show before sending. */
function check(v: Values, kind: SubmissionKind): Errors {
  const e: Errors = {};
  if (!URL_PATTERN.test(v.url.trim())) e.url = "Add a link that starts with https://";
  if (v.video_time.trim() && !TIME_PATTERN.test(v.video_time.trim())) e.video_time = "Write the time as mm:ss or h:mm:ss, for example 12:34.";
  if (v.contact_email.trim() && !EMAIL_PATTERN.test(v.contact_email.trim())) e.contact_email = "Check the email address, or leave it blank.";
  const handle = v.credit_handle.trim();
  if (handle && (handle.length > HANDLE_MAX || !HANDLE_PATTERN.test(handle)))
    e.credit_handle = `Use up to ${HANDLE_MAX} letters, numbers, spaces, dots, dashes or underscores, or leave it blank.`;
  if (kind === "evidence" && !v.promise_id) e.promise_id = "Choose the card this evidence is for.";
  return e;
}

type Outcome = { reference: string; receipt: boolean | null } | null;

/**
 * "Send us a promise" and "Add evidence" (PRD F8). No account. Posts to
 * /api/submissions, which puts it in the editors' queue, never on a card
 * (invariant 8). No client analytics on this form (rule 4): the server counts.
 */
export function ContributeForm({
  promises,
  kind,
  cardId,
  onKind,
  onCard,
}: {
  promises: CardView[];
  kind: SubmissionKind;
  cardId: string;
  onKind: (k: SubmissionKind) => void;
  onCard: (id: string) => void;
}) {
  const [values, setValues] = useState(EMPTY);
  const [evidenceType, setEvidenceType] = useState<string>(EVIDENCE_OPTIONS[0].id);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  // The spam check starts when the reader first moves into the form, not on every page view.
  const [engaged, setEngaged] = useState(false);
  const [altcha, setAltcha] = useState<string | null>(null);
  const [checkRun, setCheckRun] = useState(0);
  const [checkSlow, setCheckSlow] = useState(false);
  const opened = useRef(false);
  // Today in UK time, set after mount so server and browser render the same markup.
  const [today, setToday] = useState<string | undefined>(undefined);
  useEffect(() => setToday(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" })), []);
  const formRef = useRef<HTMLFormElement>(null);

  const all: Values = { ...values, promise_id: cardId, evidence_type: evidenceType };

  useEffect(() => {
    if (!engaged || altcha) return;
    setCheckSlow(false);
    const id = setTimeout(() => setCheckSlow(true), CHECK_SLOW_MS);
    return () => clearTimeout(id);
  }, [engaged, altcha, checkRun]);

  const engage = () => {
    if (opened.current) return;
    opened.current = true;
    setEngaged(true);
    // One aggregate count on our own server: no ids, no card, nothing about the reader.
    fetch("/api/submissions/opened", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
      keepalive: true,
    }).catch(() => undefined);
  };

  const rerunCheck = () => {
    setAltcha(null);
    setCheckRun((n) => n + 1);
  };

  const set = (f: keyof typeof EMPTY) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [f]: e.target.value }));
    if (errors[f]) setErrors((x) => ({ ...x, [f]: undefined }));
  };

  const focusFirst = (errs: Errors) => {
    const first = ORDER.find((f) => errs[f]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending || !altcha) return;
    setFormError("");
    setOutcome(null);
    const local = check(all, kind);
    setErrors(local);
    if (Object.keys(local).length) return focusFirst(local);

    setSending(true);
    const body = {
      kind: kind === "new" ? "new_promise" : "evidence",
      ...(kind === "evidence" ? { promise_id: cardId, evidence_type: evidenceType } : {}),
      ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])),
      altcha,
    };
    try {
      const res = await fetch("/api/submissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { reference?: string; receipt_sent?: boolean | null; error?: string; fields?: Errors };
      if (res.status === 201 && data.reference) {
        setOutcome({ reference: data.reference, receipt: data.receipt_sent ?? null });
        setValues(EMPTY);
        setErrors({});
        rerunCheck(); // each check is good for one submission
        return;
      }
      if (data.error === "invalid" && data.fields && Object.keys(data.fields).length) {
        setErrors(data.fields);
        focusFirst(data.fields);
        return; // the check was not used up; the reader can fix and send again
      }
      setFormError(
        data.error === "rate_limited"
          ? "You have sent as many as we accept from one connection in a day. Please try again tomorrow."
          : data.error === "spam_check"
            ? "The check that you're not a bot did not go through. We're running it again; press Send once it has finished."
            : "Something went wrong and nothing was sent. Please try again in a minute.",
      );
      rerunCheck();
    } catch {
      setFormError("We could not reach the server, so nothing was sent. Check your connection and try again.");
      rerunCheck();
    } finally {
      setSending(false);
    }
  };

  const field = "grid gap-1.5";
  const label = "text-label font-medium text-muted";
  const hint = "m-0 text-caption text-muted";
  const input = "field-input aria-[invalid=true]:border-bad";
  const err = (f: Field) =>
    errors[f] ? (
      <span id={`sub-${f}-err`} className="text-label text-bad">
        {errors[f]}
      </span>
    ) : null;
  const a11y = (f: Field, hintId?: string) => ({
    name: f,
    "aria-invalid": errors[f] ? true : undefined,
    "aria-describedby": [errors[f] ? `sub-${f}-err` : "", hintId ?? ""].filter(Boolean).join(" ") || undefined,
  });

  return (
    <div id="contribute" className="mt-16 grid scroll-mt-16 items-start gap-10 border-t border-line pt-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div>
        <h2 className="text-title font-semibold">Seen a promise? Send it in.</h2>
        <p className="mt-2 max-w-[48ch] text-lead text-muted">No account needed. Editors check every submission against the original source before it becomes a card.</p>
        <ol className="mt-6 grid list-none gap-4 p-0 text-sm text-muted [counter-reset:step]">
          {[
            "You send a link and, for video, the moment it was said.",
            "We archive the source and match the exact words in the transcript.",
            "Two editors fill in who, how much, when and from where.",
            "The card goes live. You are credited if you ask to be.",
          ].map((s) => (
            <li key={s} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3 [counter-increment:step] before:grid before:size-6 before:place-items-center before:rounded-full before:bg-sunk before:text-caption before:font-semibold before:text-ink before:content-[counter(step)]">
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
      </div>

      <form ref={formRef} noValidate onSubmit={submit} onFocus={engage} className="grid gap-4 rounded-panel border border-line p-6">
        <div className={field}>
          <label htmlFor="sub-kind" className={label}>
            What are you sending?
          </label>
          <select id="sub-kind" name="kind" className="select" value={kind} onChange={(e) => onKind(e.target.value as SubmissionKind)}>
            <option value="new">A new promise</option>
            <option value="evidence">Evidence for an existing card</option>
          </select>
        </div>
        {kind === "evidence" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className={field}>
              <label htmlFor="sub-card" className={label}>
                Which card
              </label>
              <select id="sub-card" className="select aria-[invalid=true]:border-bad" value={cardId} onChange={(e) => onCard(e.target.value)} {...a11y("promise_id")}>
                {promises.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.actor.name}: {p.current.text}
                  </option>
                ))}
              </select>
              {err("promise_id")}
            </div>
            <div className={field}>
              <label htmlFor="sub-ev" className={label}>
                What changed
              </label>
              <select id="sub-ev" className="select aria-[invalid=true]:border-bad" value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)} {...a11y("evidence_type")}>
                {EVIDENCE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {err("evidence_type")}
            </div>
          </div>
        )}
        <div className={field}>
          <label htmlFor="sub-url" className={label}>
            Link to the source
          </label>
          <input
            id="sub-url"
            type="url"
            inputMode="url"
            className={input}
            placeholder="https://… video, transcript, article or Hansard"
            value={values.url}
            onChange={set("url")}
            maxLength={2000}
            required
            {...a11y("url")}
          />
          {err("url")}
        </div>
        <div className={field}>
          <label htmlFor="sub-who" className={label}>
            Who said it
          </label>
          <input id="sub-who" type="text" className={input} placeholder="Name and role" value={values.claimed_actor} onChange={set("claimed_actor")} maxLength={200} {...a11y("claimed_actor")} />
          {err("claimed_actor")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={field}>
            <label htmlFor="sub-date" className={label}>
              Date it was said
            </label>
            <input id="sub-date" type="date" className={input} max={today} value={values.claimed_date} onChange={set("claimed_date")} {...a11y("claimed_date")} />
            {err("claimed_date")}
          </div>
          <div className={field}>
            <label htmlFor="sub-time" className={label}>
              Time in the video
            </label>
            <input
              id="sub-time"
              type="text"
              inputMode="numeric"
              className={input}
              placeholder="mm:ss or h:mm:ss"
              value={values.video_time}
              onChange={set("video_time")}
              maxLength={12}
              {...a11y("video_time")}
            />
            {err("video_time")}
          </div>
        </div>
        <div className={field}>
          <label htmlFor="sub-quote" className={label}>
            Their words, as close as you can
          </label>
          <textarea
            id="sub-quote"
            className={`${input} min-h-[84px] resize-y`}
            placeholder="We will…"
            value={values.claimed_quote}
            onChange={set("claimed_quote")}
            maxLength={2000}
            {...a11y("claimed_quote")}
          />
          {err("claimed_quote")}
        </div>
        <div className={field}>
          <label htmlFor="sub-email" className={label}>
            Email, if you want a receipt and an update (optional)
          </label>
          <input
            id="sub-email"
            type="email"
            className={input}
            placeholder="you@example.com"
            autoComplete="email"
            value={values.contact_email}
            onChange={set("contact_email")}
            maxLength={254}
            {...a11y("contact_email", "sub-email-hint")}
          />
          <p id="sub-email-hint" className={hint}>
            Stored encrypted and never shown. The receipt has a link to delete it at any time.
          </p>
          {err("contact_email")}
        </div>
        <div className={field}>
          <label htmlFor="sub-handle" className={label}>
            Credit me on the card as… (optional)
          </label>
          <input
            id="sub-handle"
            type="text"
            className={input}
            placeholder="A name or handle"
            autoComplete="off"
            value={values.credit_handle}
            onChange={set("credit_handle")}
            maxLength={HANDLE_MAX}
            {...a11y("credit_handle", "sub-handle-hint")}
          />
          <p id="sub-handle-hint" className={hint}>
            Shown publicly on the card if editors accept it. Leave blank to stay anonymous.
          </p>
          {err("credit_handle")}
        </div>

        {engaged && <SpamCheck key={checkRun} onPayload={setAltcha} />}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!altcha || sending}
            className="cursor-pointer rounded-control bg-ink px-4 py-2 text-sm font-semibold text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send to editors"}
          </button>
          <span aria-live="polite" className="text-label text-muted">
            {engaged && !altcha && (checkSlow ? "The check is taking longer than usual." : "Checking you're not a bot…")}
          </span>
          {engaged && !altcha && checkSlow && (
            <button type="button" onClick={rerunCheck} className="cursor-pointer text-label font-medium text-ink underline underline-offset-2">
              Try again
            </button>
          )}
        </div>
        {formError && (
          <p role="alert" className="m-0 text-label text-bad">
            {formError}
          </p>
        )}
        {outcome && (
          <div role="status" className="grid gap-1 rounded-control bg-good/8 px-3 py-2.5 text-label text-good">
            <p className="m-0 font-medium">
              Sent. Your reference is {outcome.reference}. Keep it if you want to ask about it.
            </p>
            {outcome.receipt === true && <p className="m-0">We have emailed you a receipt, with a link to delete your email whenever you like.</p>}
            {outcome.receipt === false && <p className="m-0">We could not send the receipt email, so please note your reference now.</p>}
          </div>
        )}
      </form>
    </div>
  );
}
