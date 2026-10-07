import type { CardView, Status } from "@ledger/schema";
import { STATUS_LABEL } from "@/lib/copy";
import { longDate, monthYear } from "@/lib/format";
import { costText, isOverdue, whoLine } from "@/lib/promises";

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

/** Cards as a list of links to their own pages. Server-safe. */
export function PromiseList({ cards, today, empty }: { cards: CardView[]; today: string | null; empty?: string }) {
  if (!cards.length) {
    return <p className="m-0 border-y border-line py-6 text-muted">{empty ?? "No promises match."}</p>;
  }
  return (
    <ul className="m-0 grid list-none border-t border-line p-0">
      {cards.map((c) => (
        <li key={c.id} className="border-b border-line">
          <a href={`/promise/${c.id}`} className="grid gap-2 px-3 py-4 text-ink no-underline transition-colors hover:bg-sunk">
            <span className="flex flex-wrap justify-between gap-x-3 text-label text-muted">
              <span>{whoLine(c)}</span>
              <span>{longDate(c.file.made_on)}</span>
            </span>
            <span className="text-[16px] font-[550] leading-snug tracking-[-0.01em]">“{c.current.text}”</span>
            <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[12.5px] text-muted">
              <StatusPill status={c.file.status} />
              {c.outcomeBy && <span className="font-medium text-ink">by {c.outcomeBy.name}</span>}
              <span>{costText(c)}</span>
              {c.file.deadline && <span>Due {monthYear(c.file.deadline)}</span>}
              {isOverdue(c, today) && <span className="font-medium text-debt-ink">Deadline passed</span>}
              {c.current.parameters?.funded_by === null && <span>Funding not stated</span>}
              {c.file.reviews.length > 0 && (
                <span>
                  <span aria-hidden className="text-good">✓ </span>Reviewed by {c.file.reviews.at(-1)!.by}
                </span>
              )}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
