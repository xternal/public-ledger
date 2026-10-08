import type { Metadata } from "next";
import { CONSENT_POINTS } from "@ledger/server/follow";
import { SiteHeader } from "@/components/SiteHeader";
import { FollowButton } from "@/components/FollowPanel";
import { AREA_LABEL } from "@/lib/promises";
import { followOptions, followWindows } from "./targets";

export const metadata: Metadata = {
  title: "Alerts: follow a promise, a politician or a policy area | Public Ledger",
  description:
    "Get an email, a Telegram message or an RSS item when a tracked UK political promise changes status, misses a deadline, is reworded or re-costed, or comes due. No account needed.",
  alternates: { canonical: "/follow" },
};

/** About alerts, and where the "manage" link in emails explains itself. */
export default function FollowPage() {
  const areas = Object.entries(AREA_LABEL).map(([id, label]) => ({ id, label }));
  return (
    <>
      <SiteHeader current="/promises" />
      <main className="mx-auto grid max-w-[720px] gap-8 px-4 pb-20 pt-12 sm:px-6">
        <div className="grid gap-3">
          <h1 className="m-0 text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.06] tracking-[-0.035em]">Alerts</h1>
          <p className="m-0 text-lead text-muted">
            Follow a promise, a politician or party, a policy area, what is coming due, or everything. We tell you when a status changes, a deadline passes,
            the wording, the cost or a contract changes, or someone named on a card replies. No account needed.
          </p>
        </div>

        <section aria-labelledby="how-h" className="grid gap-3 text-sm">
          <h2 id="how-h" className="m-0 text-title font-semibold">
            How to follow
          </h2>
          <p className="m-0">
            Open a <a href="/promises">promise</a> or a politician&apos;s page and press Follow. Then pick email, Telegram or an RSS feed. Email asks you to
            confirm first, and again each time you add something, so nobody else can add to your alerts. You can also follow a whole policy area, or
            everything:
          </p>
          <FollowButton label="Follow a policy area or everything" trackKind="area" areas={areas} windows={followWindows()} options={followOptions()} />
          <p className="m-0">
            To hear what is due, follow a deadline window: this month, the next 3 months or the next 12. You get an alert when a promise due in it is delivered
            or its deadline passes, and once a month, in the first week, the list of open promises coming due. The list is also on the{" "}
            <a href="/promises#coming-up">promise ledger</a>.
          </p>
          <p className="m-0">
            Following everything also brings data changes: a contract behind a promise that moves, and each new OBR forecast or ONS release that changes the
            borrowing, income or spending in the Statement. They arrive within a day of the nightly data refresh.
          </p>
        </section>

        <section aria-labelledby="manage-h" className="grid gap-3 text-sm">
          <h2 id="manage-h" className="m-0 text-title font-semibold">
            Change or stop your alerts
          </h2>
          <p className="m-0">
            Every email has a link to change what you follow, switch to a weekly digest, or stop all alerts and delete your address. It is the same link in
            every email, so any of them works. Keep it to yourself: anyone who has it can change your alerts.
          </p>
          <p className="m-0">On Telegram, send /list, /unfollow or /stop to the bot. /stop deletes everything at once.</p>
        </section>

        <section aria-labelledby="store-h" className="grid gap-3 text-sm">
          <h2 id="store-h" className="m-0 text-title font-semibold">
            What we store
          </h2>
          <ul className="m-0 grid list-disc gap-1.5 pl-5">
            {CONSENT_POINTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="m-0 text-muted">
            RSS feeds store nothing at all. The <a href="/privacy">privacy notice</a> says who runs Public Ledger, how long we keep things and how to have
            them deleted.
          </p>
        </section>
      </main>
    </>
  );
}
