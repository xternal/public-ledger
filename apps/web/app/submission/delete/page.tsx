import type { Metadata } from "next";
import { lookupDeleteToken, type DeleteTokenInfo } from "@ledger/server/intake";
import { getServer } from "@/lib/server";
import { SiteHeader } from "@/components/SiteHeader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Delete your email | Public Ledger",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const h1 = "m-0 text-[clamp(26px,3.6vw,34px)] font-semibold leading-[1.15] tracking-[-0.025em]";
const REF = /^S-\d{4}-\d{2}-\d{4}$/;

/**
 * The link in a submission receipt lands here. Opening the page (GET) only
 * reads; the button POSTs to /api/submissions/delete, because mail scanners
 * open links and must never delete anything on someone's behalf.
 */
export default async function DeleteEmailPage({ searchParams }: Props) {
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const t = one("t");
  const done = one("done");
  const ref = REF.test(one("ref")) ? one("ref") : "";
  const error = one("e");

  const { config, db } = await getServer();
  const info: DeleteTokenInfo | null = t ? await lookupDeleteToken(db, t) : null;
  const editors = config.mail.replyTo ? `write to ${config.mail.replyTo}` : "reply to your receipt email";

  return (
    <>
      <SiteHeader current="/#contribute" />
      <main className="mx-auto grid max-w-[640px] gap-5 px-4 pb-20 pt-12 sm:px-6">
        {done ? (
          <>
            <h1 className={h1}>Your email is deleted</h1>
            <p className="m-0 text-lead text-muted">
              We no longer hold your email{ref ? ` for submission ${ref}` : ""}, so we cannot send you updates about it. The submission itself stays with the editors.
            </p>
            {done === "removed" && <p className="m-0 text-sm">We also removed the name you asked to be credited as.</p>}
            {done === "kept" && (
              <p className="m-0 text-sm">
                Your submission is already on a published card, and the name you chose is shown there. To have it taken off, {editors} and quote
                your reference.
              </p>
            )}
            <a href="/promises" className="justify-self-start text-label font-medium">
              All promises
            </a>
          </>
        ) : info ? (
          <>
            <h1 className={h1}>Delete your email</h1>
            <p className="m-0 text-lead text-muted">
              This deletes the email you gave with submission {info.reference}. We will not be able to tell you what happens to it. Editors still review the
              submission.
            </p>
            {info.hasCredit &&
              (info.creditPublished ? (
                <p className="m-0 text-sm">
                  The card is already published with the name you chose, so that name stays on the card. To have it taken off, {editors} and quote your
                  reference.
                </p>
              ) : (
                <p className="m-0 text-sm">We will also remove the name you asked to be credited as.</p>
              ))}
            <form method="post" action="/api/submissions/delete" className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="t" value={t} />
              <button type="submit" className="cursor-pointer rounded-control bg-ink px-4 py-2 text-sm font-semibold text-bg hover:opacity-90">
                Delete my email
              </button>
            </form>
            <p className="m-0 text-[12.5px] text-muted">Opening this page changes nothing. Only the button deletes.</p>
          </>
        ) : (
          <>
            <h1 className={h1}>{error === "limit" ? "Too many tries" : error === "error" ? "Something went wrong" : "This link does not work"}</h1>
            <p className="m-0 text-lead text-muted">
              {error === "limit"
                ? "There have been too many delete requests from this connection today. Try again tomorrow."
                : error === "error"
                  ? "We could not delete your email just now. Open the link in your receipt again and press the button."
                  : "Your email may already be deleted: by this link, or by us once the editors decided or 90 days passed. Either way, there is nothing more to do."}
            </p>
            <a href="/promises" className="justify-self-start text-label font-medium">
              All promises
            </a>
          </>
        )}
      </main>
    </>
  );
}
