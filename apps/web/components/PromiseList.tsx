"use client";

import type { PromiseCard, Status } from "@ledger/schema";
import { STATUS_LABEL } from "@/lib/copy";
import { gbpBn, longDate, monthYear, rangeText } from "@/lib/format";

const TERMINAL: Status[] = ["delivered", "failed", "quietly_dropped", "unscoreable"];

export const isOverdue = (p: PromiseCard, today: string | null) =>
  !!today && !!p.deadline && p.deadline < today && !TERMINAL.includes(p.status);

export function costText(p: PromiseCard): string {
  const c = p.parameters?.how_much_bn_per_year;
  if (c) return `${rangeText(c, gbpBn)} a year`;
  if (p.parameters?.note) return "Cost pending editor";
  return "Cost not stated";
}

const PILL: Record<Status, string> = {
  promised: "bg-sunk text-muted shadow-[inset_0_0_0_1px_var(--line)]",
  unscoreable: "bg-sunk text-muted shadow-[inset_0_0_0_1px_var(--line)]",
  in_plan: "bg-rec/12 text-rec",
  legislated: "bg-rec/12 text-rec",
  funded: "bg-warn/13 text-warn",
  delivering: "bg-warn/13 text-warn",
  delivered: "bg-good/13 text-good",
  failed: "bg-bad/12 text-bad",
  quietly_dropped: "bg-bad/12 text-bad",
};

export function StatusPill({ status }: { status: Status }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-semibold ${PILL[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function PromiseList({
  promises,
  selected,
  onSelect,
  today,
}: {
  promises: PromiseCard[];
  selected: string;
  onSelect: (id: string) => void;
  today: string | null;
}) {
  return (
    <div className="grid border-t border-line" role="group" aria-label="Promises">
      {promises.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={p.id === selected}
          onClick={() => onSelect(p.id)}
          className="grid w-full cursor-pointer gap-2 border-b border-line px-3 py-4 text-left transition-colors hover:bg-sunk aria-pressed:bg-sunk aria-pressed:shadow-[inset_2px_0_0_var(--ink)]"
        >
          <span className="flex flex-wrap justify-between gap-x-3 text-label text-muted">
            <span>
              {p.actor.name}, {p.actor.role}
            </span>
            <span>{longDate(p.made_on)}</span>
          </span>
          <span className="text-[16px] font-[550] leading-snug tracking-[-0.01em]">“{p.text}”</span>
          <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[12.5px] text-muted">
            <StatusPill status={p.status} />
            <span>{costText(p)}</span>
            {p.deadline && <span>Due {monthYear(p.deadline)}</span>}
            {isOverdue(p, today) && <span className="font-medium text-debt">Deadline passed</span>}
            {p.editor_check_required && <span>Needs editor check</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
