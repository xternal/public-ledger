import type { CardView, Status } from "@ledger/schema";
import { AREA_LABEL, costCell, isOverdue, whoShort } from "@/lib/promises";
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

function PromiseRow({ c, today }: { c: CardView; today: string | null }) {
  const cost = costCell(c);
  const review = latestReview(c.file);
  const overdue = isOverdue(c, today);
  const fundingUnstated = c.current.parameters?.funded_by === null;
  return (
    <a
      href={`/promise/${c.id}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2.5 px-3 py-4 text-ink no-underline transition-colors hover:bg-sunk md:grid-cols-[minmax(0,1fr)_10rem_11rem]"
    >
      <span className="col-span-2 grid min-w-0 gap-1.5 md:col-span-1">
        <span className="line-clamp-3 text-[16px] font-[550] leading-snug tracking-[-0.01em]">“{c.current.text}”</span>
        <span className="text-label text-muted">
          {whoShort(c)} · {longDate(c.file.made_on)} · {AREA_LABEL[c.file.policy_area]}
        </span>
      </span>

      <span className="grid content-start justify-items-start gap-1">
        <span className="flex items-center gap-1.5">
          <StatusPill status={c.file.status} />
          {review && (
            <span className="text-caption text-good" title={`Reviewed by ${reviewerLabel(review)}`}>
              <span aria-hidden>✓</span>
              <span className="sr-only">Reviewed by {reviewerLabel(review)}</span>
            </span>
          )}
        </span>
        {c.outcomeBy && <span className="text-caption font-medium text-ink">by {c.outcomeBy.name}</span>}
        {overdue ? (
          <span className="text-caption font-medium text-debt-ink">Deadline passed, {monthYear(c.file.deadline!)}</span>
        ) : (
          c.file.deadline && <span className="text-caption text-muted">Due {monthYear(c.file.deadline)}</span>
        )}
      </span>

      <span className="grid content-start justify-items-end gap-0.5 text-right">
        {cost.amount ? (
          <>
            <span className="whitespace-nowrap text-[15px] font-semibold tabular-nums tracking-[-0.01em]">{cost.amount}</span>
            <span className="text-caption text-muted">{cost.label}</span>
          </>
        ) : (
          <span className="text-label text-muted">{cost.label}</span>
        )}
        {fundingUnstated && <span className="text-caption text-muted">Funding not stated</span>}
      </span>
    </a>
  );
}
