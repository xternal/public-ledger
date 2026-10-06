"use client";

import { useState, type FormEvent } from "react";
import type { PromiseCard } from "@ledger/schema";
import { EVIDENCE_OPTIONS } from "@/lib/copy";

export type SubmissionKind = "new" | "evidence";

const URL_PATTERN = /^https?:\/\/\S+\.\S+/;

/**
 * "Send us a promise" and "Add evidence" (PRD F8). No account. In M0
 * nothing leaves the browser; M3b posts to services/intake, which creates
 * a draft in the editors' queue, never a card (invariant 8).
 */
export function ContributeForm({
  promises,
  kind,
  cardId,
  onKind,
  onCard,
}: {
  promises: PromiseCard[];
  kind: SubmissionKind;
  cardId: string;
  onKind: (k: SubmissionKind) => void;
  onCard: (id: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!URL_PATTERN.test(url.trim())) {
      setError("Add a link that starts with https://");
      document.getElementById("sub-url")?.focus();
      return;
    }
    setError("");
    setSent(true);
  };

  const field = "grid gap-1.5";
  const label = "text-label font-medium text-muted";

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

      <form noValidate onSubmit={submit} className="grid gap-4 rounded-panel border border-line p-6">
        <div className={field}>
          <label htmlFor="sub-kind" className={label}>
            What are you sending?
          </label>
          <select id="sub-kind" className="select" value={kind} onChange={(e) => onKind(e.target.value as SubmissionKind)}>
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
              <select id="sub-card" className="select" value={cardId} onChange={(e) => onCard(e.target.value)}>
                {promises.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.actor.name}: {p.text}
                  </option>
                ))}
              </select>
            </div>
            <div className={field}>
              <label htmlFor="sub-ev" className={label}>
                What changed
              </label>
              <select id="sub-ev" className="select">
                {EVIDENCE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
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
            className="field-input"
            placeholder="https://… video, transcript, article or Hansard"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? "sub-err" : undefined}
            required
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={field}>
            <label htmlFor="sub-who" className={label}>
              Who said it
            </label>
            <input id="sub-who" type="text" className="field-input" placeholder="Name and role" />
          </div>
          <div className={field}>
            <label htmlFor="sub-when" className={label}>
              When
            </label>
            <input id="sub-when" type="text" className="field-input" placeholder="Date, and time in the video" />
          </div>
        </div>
        <div className={field}>
          <label htmlFor="sub-quote" className={label}>
            Their words, as close as you can
          </label>
          <textarea id="sub-quote" className="field-input min-h-[84px] resize-y" placeholder="We will…" />
        </div>
        <div className={field}>
          <label htmlFor="sub-email" className={label}>
            Email, if you want credit or an update (optional)
          </label>
          <input id="sub-email" type="email" className="field-input" placeholder="you@example.com" autoComplete="email" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--ink)]" /> Credit me by name on the card
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="cursor-pointer rounded-control bg-ink px-4 py-2 text-sm font-semibold text-bg hover:opacity-90">
            Send to editors
          </button>
          {error && (
            <span id="sub-err" role="alert" className="text-label text-bad">
              {error}
            </span>
          )}
        </div>
        {sent && (
          <p role="status" className="m-0 rounded-control bg-good/8 px-3 py-2.5 text-label font-medium text-good">
            Prototype: nothing was sent. In the product this goes to the editors' queue and you get a reference number.
          </p>
        )}
      </form>
    </div>
  );
}
