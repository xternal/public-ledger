import type { CardView, Status } from "@ledger/schema";
import { AREA_LABEL, STANDING_LABEL, costText, isOverdue, ownerOf, shortName, standingOf } from "@/lib/promises";
import { STATUS_LABEL } from "@/lib/copy";
import { longDate, monthYear } from "@/lib/format";
import { latestReview, reviewerLabel } from "@/lib/reviews";

const PILL: Record<Status, string> = {
  promised: "bg-sunk text-muted shadow-[inset_0_0_0_1px_var(--line)]",
  unscoreable: "bg-sunk text-muted shadow-[inset_0_0_0_1px_var(--line)]",
  in_plan: "bg-rec/8 text-rec",
  legislated: "bg-rec/8 text-rec",
  funded: "bg-warn/8 text-warn",
  delivering: "bg-warn/8 text-warn",
  delivered: "bg-good/8 text-good",
  failed: "bg-bad/8 text-bad",
  quietly_dropped: "bg-bad/8 text-bad",
};

export function StatusPill({ status }: { status: Status }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-semibold ${PILL[status]}`}>{STATUS_LABEL[status]}</span>;
}

/**
 * Cards as a list of links to their own pages, one row each: the promise and
 * who made it; where it stands; what it costs a year. On wide screens the
 * three line up in columns so a reader can scan down any one of them.
 * Server-safe.
 */
export function PromiseList({ cards, today, empty }: { cards: CardView[]; today: string | null; empty?: string }) {
  if (!cards.length) {
    return <p className="m-0 border-y border-line py-6 text-muted">{empty ?? "No promises match."}</p>;
  }
  return (
    <ul className="m-0 grid list-none border-t border-line p-0">
      {cards.map((c) => (
        <li key={c.id} className="border-b border-line">
          <PromiseRow c={c} today={today} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One row, read left to right: who made it and where they stand (in
 * government, in opposition), then the promise in their words with its
 * status, topic, cost a year and any deadline underneath.
 */
function PromiseRow({ c, today }: { c: CardView; today: string | null }) {
  const review = latestReview(c.file);
  const overdue = isOverdue(c, today);
  const owner = ownerOf(c);
  const standing = standingOf(c);
  const speaker = c.actor.kind === "person" ? c.actor.name : null;
  return (
    <a
      href={`/promise/${c.id}`}
      className="grid gap-x-8 gap-y-2 px-3 py-5 text-ink no-underline transition-colors hover:bg-sunk md:grid-cols-[11rem_minmax(0,1fr)]"
    >
      <span className="flex flex-wrap items-baseline gap-x-2 md:grid md:content-start md:gap-0.5">
        <span className="text-sm font-semibold">{shortName(owner)}</span>
        {standing && <span className="text-caption text-muted">{STANDING_LABEL[standing]}</span>}
      </span>

      <span className="grid min-w-0 gap-2">
        {c.file.headline && <span className="-mb-1 text-label font-medium text-muted">{c.file.headline}</span>}
        <span className="line-clamp-3 text-[16px] font-[550] leading-snug tracking-[-0.01em]">“{c.current.text}”</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-muted">
          <StatusPill status={c.file.status} />
          {review && (
            <span className="-ml-1.5 text-caption text-good" title={`Reviewed by ${reviewerLabel(review)}`}>
              <span aria-hidden>✓</span>
              <span className="sr-only">Reviewed by {reviewerLabel(review)}</span>
            </span>
          )}
          {c.outcomeBy && <span className="font-medium text-ink">by {c.outcomeBy.name}</span>}
          <span>{AREA_LABEL[c.file.policy_area]}</span>
          <span>{costText(c)}</span>
          {overdue ? (
            <span className="font-medium text-debt-ink">Deadline passed, {monthYear(c.file.deadline!)}</span>
          ) : (
            c.file.deadline && <span>Due {monthYear(c.file.deadline)}</span>
          )}
          <span>
            {speaker ? `${speaker}, ` : ""}
            {longDate(c.file.made_on)}
          </span>
        </span>
      </span>
    </a>
  );
}
