import { notFound } from "next/navigation";
import { draftFor, getSubmission, OPEN_STATUSES, TRIAGE_ERRORS, type TriageError } from "@ledger/server/triage";
import { getSeed } from "@/lib/data";
import { getServer } from "@/lib/server";
import { requireAdmin } from "../guard";
import { SubmissionCard } from "../SubmissionCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string; emailed?: string }> };

const DONE: Record<string, string> = {
  accept: "Accepted.",
  reject: "Rejected. Any contact address is now deleted.",
  duplicate: "Marked as a duplicate. Any contact address is now deleted.",
};

export default async function SubmissionPage({ params, searchParams }: Props) {
  await requireAdmin();
  const { id } = await params;
  const { done, error, emailed } = await searchParams;
  const { db, config } = await getServer();
  const s = await getSubmission(db, id);
  if (!s) notFound();
  const existingIds = new Set(getSeed().cards.map((c) => c.id));
  const draft = s.status === "merged_into" ? null : draftFor({ existingIds }, s);
  const accepted = s.status === "accepted";
  const errorText = error && Object.hasOwn(TRIAGE_ERRORS, error) ? TRIAGE_ERRORS[error as TriageError] : null;
  return (
    <main className="mx-auto grid max-w-[1000px] gap-6 px-4 pb-20 pt-6 sm:px-6">
      <a href="/admin" className="justify-self-start text-label font-medium">
        All submissions
      </a>
      {done && DONE[done] ? (
        <p role="status" className="m-0 rounded-control bg-good/8 px-3 py-2.5 text-label font-medium text-good">
          {DONE[done]}
          {emailed === "1" ? " The submitter was emailed a short update." : ""}
          {done === "accept" && s.resulting_pr_url ? (
            <>
              {" "}
              Draft pull request: <a href={s.resulting_pr_url}>{s.resulting_pr_url}</a>
            </>
          ) : null}
        </p>
      ) : null}
      {errorText ? (
        <p role="alert" className="m-0 rounded-control bg-bad/8 px-3 py-2.5 text-label font-medium text-bad">
          {errorText}
        </p>
      ) : null}

      <SubmissionCard s={s} detail />

      {draft && (OPEN_STATUSES.includes(s.status) || (accepted && !s.resulting_pr_url)) ? (
        <section aria-labelledby="draft-h" className="grid gap-3">
          <h2 id="draft-h" className="m-0 text-title font-semibold">
            {accepted ? "Copy this into a pull request" : "Draft an accept would create"}
          </h2>
          <p className="m-0 text-body text-muted">
            {accepted
              ? `There is no GitHub token on this server (GITHUB_TOKEN), so no pull request was opened. Create the branch submission/${s.id}, put this in ${draft.path}, and open a draft pull request. Two editors must approve before merge.`
              : config.github.token
                ? `Accepting opens a draft pull request in ${config.github.repo} on the branch submission/${s.id}.`
                : "There is no GitHub token on this server, so accepting will show this YAML to copy into a pull request."}
          </p>
          <p className="m-0 text-label">
            File: <code>{draft.path}</code>
            {draft.mode === "append" ? " (the existing card with one event appended)" : " (a new card; it fails validation until every TODO is filled in)"}
          </p>
          <pre className="m-0 max-h-[640px] overflow-auto rounded-panel border border-line bg-sunk p-4 text-[12.5px] leading-[1.5]">
            <code>{draft.yaml}</code>
          </pre>
        </section>
      ) : s.kind === "evidence" && !draft && OPEN_STATUSES.includes(s.status) ? (
        <p className="m-0 text-label text-muted">The card file is not available on this server, so there is no preview. Accepting with a GitHub token reads it from main.</p>
      ) : null}
    </main>
  );
}
