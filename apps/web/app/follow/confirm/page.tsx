import type { Metadata } from "next";
import { CONFIRM_TTL_DAYS, CONSENT_POINTS, confirmView, type ConfirmView } from "@ledger/server/follow";
import { getServer } from "@/lib/server";
import { SiteHeader } from "@/components/SiteHeader";
import { describeTarget } from "../targets";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Confirm your alerts | Public Ledger",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const h1 = "m-0 text-[clamp(26px,3.6vw,34px)] font-semibold leading-[1.15] tracking-[-0.025em]";

/**
 * The link in a confirmation email lands here: for a new sign-up, or for
 * additions to alerts the address already gets. Opening the page (GET) only
 * reads; the button POSTs to /api/follow/confirm, because mail scanners open
 * links and must never confirm on someone's behalf.
 */
export default async function ConfirmPage({ searchParams }: Props) {
  const q = await searchParams;
  const t = typeof q.t === "string" ? q.t : "";
  const e = typeof q.e === "string" ? q.e : "";
  let view: ConfirmView = { state: e === "expired" ? "expired" : "invalid", kind: "signup", targets: [] };
  if (t) {
    const { db } = await getServer();
    view = await confirmView(db, t);
  }
  const names = view.targets.map(describeTarget);
  const adding = view.kind === "addition";

  return (
    <>
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[640px] gap-5 px-4 pb-20 pt-12 sm:px-6">
        {view.state === "valid" ? (
          <>
            <h1 className={h1}>{adding ? "Add to your alerts" : "Confirm your alerts"}</h1>
            <p className="m-0 text-lead text-muted">
              {adding ? "Press the button to add these to the alerts you already get:" : "Press the button to start getting alerts about:"}
            </p>
            <ul className="m-0 grid list-disc gap-1.5 pl-5 text-sm">
              {names.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <form method="post" action="/api/follow/confirm" className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="t" value={t} />
              <button type="submit" className="cursor-pointer rounded-control bg-ink px-4 py-2 text-sm font-semibold text-bg hover:opacity-90">
                Confirm
              </button>
            </form>
            <p className="m-0 text-[12.5px] text-muted">
              {adding
                ? `Did not ask for this? Close this page. Nothing is added, and we delete the request after ${CONFIRM_TTL_DAYS} days.`
                : `Did not ask for this? Close this page. Nothing is followed, and we delete the address after ${CONFIRM_TTL_DAYS} days.`}
            </p>
            <details className="text-[12.5px] text-muted">
              <summary className="cursor-pointer font-medium text-ink">What you agree to</summary>
              <ul className="mb-0 mt-2 grid list-disc gap-1 pl-4">
                {CONSENT_POINTS.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <p className="mb-0 mt-2">
                Full details are in the <a href="/privacy">privacy notice</a>.
              </p>
            </details>
          </>
        ) : view.state === "expired" ? (
          <>
            <h1 className={h1}>This link has expired</h1>
            <p className="m-0 text-lead text-muted">
              Confirmation links work for {CONFIRM_TTL_DAYS} days. Open the promise again and press Follow, and we will send a new one.
            </p>
            <a href="/promises" className="justify-self-start text-label font-medium">
              All promises
            </a>
          </>
        ) : (
          <>
            <h1 className={h1}>This link does not work</h1>
            <p className="m-0 text-lead text-muted">
              It may have been used already or replaced by a newer email. If you have already confirmed, use the manage link in any email from us.
            </p>
            <a href="/follow" className="justify-self-start text-label font-medium">
              About alerts
            </a>
          </>
        )}
      </main>
    </>
  );
}
