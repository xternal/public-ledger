import type { Metadata } from "next";
import { manageView } from "@ledger/server/follow";
import { getServer } from "@/lib/server";
import { SiteHeader } from "@/components/SiteHeader";
import { describeTarget, targetHref } from "../targets";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your alerts | Public Ledger",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const DONE: Record<string, string> = {
  confirmed: "Thanks, you are following.",
  weekly: "Done. You will get a weekly digest on Mondays, only when something changed.",
  instant: "Done. You will get an email each time something you follow changes.",
  removed: "Done. You no longer follow that.",
  error: "Something went wrong. Please try again.",
};

const h1 = "m-0 text-[clamp(26px,3.6vw,34px)] font-semibold leading-[1.15] tracking-[-0.025em]";
const secondary =
  "cursor-pointer rounded-control bg-bg px-3.5 py-1.5 text-label font-semibold text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--ink)]";

/**
 * Manage alerts from the link in an email (no account): see what you follow,
 * switch to the weekly digest, remove one thing, or delete everything. Forms
 * post to /api/follow/manage and come back here.
 */
export default async function ManagePage({ searchParams }: Props) {
  const q = await searchParams;
  const t = typeof q.t === "string" ? q.t : "";
  const m = typeof q.m === "string" ? q.m : "";
  const { db, config } = await getServer();
  const view = t ? await manageView({ db, config }, t) : null;

  if (!view) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto grid max-w-[640px] gap-5 px-4 pb-20 pt-12 sm:px-6">
          {m === "deleted" ? (
            <>
              <h1 className={h1}>Your data is deleted</h1>
              <p role="status" className="m-0 text-lead text-muted">
                We deleted your address and everything you followed. You will get no more alerts from us.
              </p>
            </>
          ) : (
            <>
              <h1 className={h1}>This link does not work any more</h1>
              <p className="m-0 text-lead text-muted">
                Each email we send has a fresh link, and links in older emails stop working. Use the link in your latest email from us.
              </p>
              <p className="m-0 text-sm text-muted">If you have unsubscribed or deleted your data, there is nothing left to manage.</p>
            </>
          )}
          <a href="/promises" className="justify-self-start text-label font-medium">
            All promises
          </a>
        </main>
      </>
    );
  }

  const weekly = view.cadence === "weekly";
  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid max-w-[720px] gap-8 px-4 pb-20 pt-12 sm:px-6">
        <div className="grid gap-2">
          <h1 className={h1}>Your alerts</h1>
          <p className="m-0 text-sm text-muted">Alerts go to {view.addressHint}.</p>
        </div>

        {DONE[m] && (
          <p role="status" className={`m-0 rounded-control px-3.5 py-2.5 text-sm ${m === "error" ? "bg-sunk text-bad" : "bg-sunk"}`}>
            {DONE[m]}
          </p>
        )}

        <section aria-labelledby="follows-h" className="grid gap-3">
          <h2 id="follows-h" className="m-0 text-title font-semibold">
            What you follow
          </h2>
          <ul className="m-0 grid list-none gap-0 p-0">
            {view.targets.map((target) => (
              <li key={`${target.kind}:${target.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line py-3 text-sm">
                <a href={targetHref(target)} className="min-w-0 flex-1 basis-[260px]">
                  {describeTarget(target)}
                </a>
                <form method="post" action="/api/follow/manage">
                  <input type="hidden" name="t" value={t} />
                  <input type="hidden" name="action" value="remove" />
                  <input type="hidden" name="kind" value={target.kind} />
                  <input type="hidden" name="id" value={target.id} />
                  <button type="submit" className={secondary} aria-label={`Stop following ${describeTarget(target)}`}>
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
          {view.targets.length === 1 && <p className="m-0 text-[12.5px] text-muted">Removing the last one also deletes your address.</p>}
        </section>

        {view.channel === "email" && (
          <section aria-labelledby="often-h" className="grid gap-3">
            <h2 id="often-h" className="m-0 text-title font-semibold">
              How often
            </h2>
            <p className="m-0 text-sm">
              {weekly ? "You get a weekly digest on Mondays, only when something changed." : "You get an email each time something you follow changes."}
            </p>
            <form method="post" action="/api/follow/manage">
              <input type="hidden" name="t" value={t} />
              <input type="hidden" name="action" value="cadence" />
              <input type="hidden" name="cadence" value={weekly ? "instant" : "weekly"} />
              <button type="submit" className={secondary}>
                {weekly ? "Switch to an email for each change" : "Switch to a weekly digest"}
              </button>
            </form>
          </section>
        )}

        <section aria-labelledby="stop-h" className="grid gap-3 border-t border-line pt-6">
          <h2 id="stop-h" className="m-0 text-title font-semibold">
            Stop all alerts
          </h2>
          <p className="m-0 max-w-[60ch] text-sm text-muted">
            This deletes your address, your consent record and everything you follow, at once. Nothing is kept. To follow again later, you sign up again.
          </p>
          <form method="post" action="/api/follow/manage">
            <input type="hidden" name="t" value={t} />
            <input type="hidden" name="action" value="delete" />
            <button type="submit" className="cursor-pointer rounded-control bg-bg px-4 py-2 text-sm font-semibold text-bad shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--bad)]">
              Stop all alerts and delete my data
            </button>
          </form>
        </section>

        <p className="m-0 border-t border-line pt-5 text-[12.5px] text-muted">
          Use the link in your latest email: each email has a fresh one, and links in older emails stop working. We never show who follows what, and never share or sell our lists.
        </p>
      </main>
    </>
  );
}
