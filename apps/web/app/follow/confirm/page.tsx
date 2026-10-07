import type { Metadata } from "next";
import { CONFIRM_TTL_DAYS, confirmTokenState, pendingTargets, type ConfirmTokenState } from "@ledger/server/follow";
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

/**
 * The link in the confirmation email lands here. Opening the page (GET) only
 * reads; the button POSTs to /api/follow/confirm, because mail scanners open
 * links and must never confirm on someone's behalf.
 */
export default async function ConfirmPage({ searchParams }: Props) {
  const q = await searchParams;
  const t = typeof q.t === "string" ? q.t : "";
  const e = typeof q.e === "string" ? q.e : "";
  let state: ConfirmTokenState = e === "expired" ? "expired" : "invalid";
  let names: string[] = [];
  if (t) {
    const { db } = await getServer();
    state = await confirmTokenState(db, t);
    if (state === "valid") names = (await pendingTargets(db, t)).map(describeTarget);
  }

  return (
    <>
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[640px] gap-5 px-4 pb-20 pt-12 sm:px-6">
        {state === "valid" ? (
          <>
            <h1 className="m-0 text-[clamp(26px,3.6vw,34px)] font-semibold leading-[1.15] tracking-[-0.025em]">Confirm your alerts</h1>
            <p className="m-0 text-lead text-muted">Press the button to start getting alerts about:</p>
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
              Did not ask for this? Close this page. Nothing is followed, and we delete the address after {CONFIRM_TTL_DAYS} days.
            </p>
          </>
        ) : state === "expired" ? (
          <>
            <h1 className="m-0 text-[clamp(26px,3.6vw,34px)] font-semibold leading-[1.15] tracking-[-0.025em]">This link has expired</h1>
            <p className="m-0 text-lead text-muted">
              Confirmation links work for {CONFIRM_TTL_DAYS} days. Open the promise again and press Follow, and we will send a new one.
            </p>
            <a href="/promises" className="justify-self-start text-label font-medium">
              All promises
            </a>
          </>
        ) : (
          <>
            <h1 className="m-0 text-[clamp(26px,3.6vw,34px)] font-semibold leading-[1.15] tracking-[-0.025em]">This link does not work</h1>
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
