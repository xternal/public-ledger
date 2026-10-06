import { OPEN_STATUSES, prefillSuggestion, REJECT_REASON_LABEL, REJECT_REASONS, type SubmissionView } from "@ledger/server/triage";

/** One submission as editors see it. Server component; forms post to /api/admin/triage and work without JavaScript. */

export const STATUS_WORDS: Record<string, string> = {
  received: "Received",
  auto_checked: "Checked automatically",
  in_review: "In review",
  accepted: "Accepted",
  merged_into: "Became a card",
  rejected: "Rejected",
  duplicate: "Duplicate",
};

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London", timeZoneName: "short" });

const yesNo = (x: unknown) => (x === true ? "yes" : x === false ? "no" : "not checked");

const button = "cursor-pointer rounded-control px-3 py-1.5 text-label font-semibold";
const label = "text-caption font-medium text-muted";

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-3">
      <dt className={label}>{term}</dt>
      <dd className="m-0 min-w-0 break-words text-label">{children}</dd>
    </div>
  );
}

function ExternalLink({ href }: { href: string }) {
  // noreferrer: the source site never learns the triage URL.
  return (
    <a href={href} rel="noreferrer noopener" target="_blank" className="break-all">
      {href}
    </a>
  );
}

function ref(x: string) {
  return /^S-\d{4}-\d{2}-\d{4}$/.test(x) ? <a href={`/admin/${x}`}>{x}</a> : <a href={`/promise/${x}`}>{x}</a>;
}

export function SubmissionCard({ s, detail = false }: { s: SubmissionView; detail?: boolean }) {
  const open = OPEN_STATUSES.includes(s.status);
  const suggestion = prefillSuggestion(s.llm_prefill);
  const c = s.checks;
  return (
    <article className="grid gap-4 rounded-panel border border-line p-5" aria-labelledby={`h-${s.id}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`h-${s.id}`} className="m-0 text-lead font-semibold">
          {detail ? s.id : <a href={`/admin/${s.id}`}>{s.id}</a>}{" "}
          <span className="font-normal text-muted">{s.kind === "new_promise" ? "New promise" : <>Evidence for {s.promise_id ? ref(s.promise_id) : "an unknown card"}</>}</span>
        </h2>
        <span className="rounded-control bg-sunk px-2 py-0.5 text-caption font-semibold">{STATUS_WORDS[s.status] ?? s.status}</span>
      </header>

      <dl className="m-0 grid gap-2.5">
        <Row term="Received">{when(s.received_at)}</Row>
        <Row term="Link">
          <ExternalLink href={s.url} />
          {s.video_time ? <span className="text-muted"> at {s.video_time} seconds</span> : null}
        </Row>
        <Row term="Archived copy">{s.archived_url ? <ExternalLink href={s.archived_url} /> : <span className="text-muted">Not archived</span>}</Row>
        <Row term="Automatic checks">
          Reachable: {yesNo(c.reachable)}. Text: {typeof c.text === "string" ? c.text : "not read"}.
        </Row>
        <Row term="Matched quote">
          {s.matched_quote ? <q>{s.matched_quote.text}</q> : <span className="text-muted">Not matched{typeof c.quote_check === "string" ? ` (${c.quote_check.replace(/_/g, " ")})` : ""}</span>}
        </Row>
        <Row term="Possible duplicate">{s.duplicate_of ? ref(s.duplicate_of) : <span className="text-muted">None found</span>}</Row>
        {s.kind === "evidence" ? <Row term="What changed (reader)">{s.evidence_type ?? "Not given"}</Row> : null}
        <Row term="Who (reader)">{s.claimed_actor ?? <span className="text-muted">Not given</span>}</Row>
        <Row term="Words (reader)">{s.claimed_quote ? <q>{s.claimed_quote}</q> : <span className="text-muted">Not given</span>}</Row>
        <Row term="Date (reader)">{typeof c.claimed_date === "string" ? c.claimed_date : <span className="text-muted">Not given</span>}</Row>
        <Row term="Has email">{s.has_email ? "yes" : "no"}</Row>
        <Row term="Credit">{s.credit_handle ? `yes, as “${s.credit_handle}”` : "no"}</Row>
        {s.reason_code ? <Row term="Reason">{REJECT_REASON_LABEL[s.reason_code as keyof typeof REJECT_REASON_LABEL] ?? s.reason_code}</Row> : null}
        {s.resulting_pr_url ? (
          <Row term="Draft pull request">
            <a href={s.resulting_pr_url}>{s.resulting_pr_url}</a>
          </Row>
        ) : null}
        {s.resulting_promise_id ? <Row term="Card">{ref(s.resulting_promise_id)}</Row> : null}
        {s.triaged_at ? <Row term="Triaged">{when(s.triaged_at)}</Row> : null}
      </dl>

      <section aria-label="Unverified suggestions" className="grid gap-2 rounded-control border border-dashed border-line-strong p-3">
        <h3 className="m-0 text-label font-semibold">Unverified suggestions from the language model</h3>
        <p className="m-0 text-caption text-muted">A draft for editors, never evidence. Check every field against the source.</p>
        {suggestion ? (
          <dl className="m-0 grid gap-1.5">
            {Object.entries(suggestion)
              .filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length))
              .map(([k, v]) => (
                <Row key={k} term={k.replace(/_/g, " ")}>
                  {typeof v === "string" ? v : JSON.stringify(v)}
                </Row>
              ))}
          </dl>
        ) : (
          <p className="m-0 text-label text-muted">None{typeof c.prefill === "string" ? ` (${c.prefill.replace(/_/g, " ")})` : ""}.</p>
        )}
      </section>

      {open ? (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-line pt-4">
          <form method="post" action="/api/admin/triage">
            <input type="hidden" name="id" value={s.id} />
            <button type="submit" name="action" value="accept" className={`${button} bg-ink text-bg hover:opacity-90`}>
              Accept: open a draft PR
            </button>
          </form>
          <form method="post" action="/api/admin/triage" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={s.id} />
            <label className="grid gap-1">
              <span className={label}>Reason</span>
              <select name="reason" className="select" defaultValue="" required>
                <option value="" disabled>
                  Choose…
                </option>
                {REJECT_REASONS.filter((r) => r !== "duplicate").map((r) => (
                  <option key={r} value={r}>
                    {REJECT_REASON_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" name="action" value="reject" className={`${button} border border-line-strong bg-bg text-ink hover:bg-sunk`}>
              Reject
            </button>
          </form>
          <form method="post" action="/api/admin/triage" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={s.id} />
            <label className="grid gap-1">
              <span className={label}>Duplicate of (S-… or card id)</span>
              <input name="of" className="field-input w-[220px]" defaultValue={s.duplicate_of ?? ""} required pattern="S-\d{4}-\d{2}-\d{4}|[a-z0-9-]+" />
            </label>
            <button type="submit" name="action" value="duplicate" className={`${button} border border-line-strong bg-bg text-ink hover:bg-sunk`}>
              Mark duplicate
            </button>
          </form>
        </div>
      ) : null}
    </article>
  );
}
