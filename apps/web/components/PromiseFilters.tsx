"use client";

import { useEffect, useRef } from "react";
import type { ActorFile, CardView } from "@ledger/schema";
import { keepInView } from "@/lib/keepInView";
import { isOverdue, matchesQuery, ownerOf, shortName } from "@/lib/promises";

/** Filters shared by /promises and the home page. They live in the URL on /promises, so a view can be shared. */
export type Sort = "newest" | "oldest" | "cost" | "deadline";
export const SORT_LABEL: Record<Sort, string> = { newest: "Newest first", oldest: "Oldest first", cost: "Largest cost first", deadline: "Nearest deadline first" };

export interface Filters {
  q: string;
  party: string;
  actor: string;
  status: string;
  area: string;
  overdue: boolean;
  sort: Sort;
}
export const NO_FILTERS: Filters = { q: "", party: "", actor: "", status: "", area: "", overdue: false, sort: "newest" };

/** Whether a card passes the filters; `ignore` leaves one out, to count what each of its options would give. */
export function passes(c: CardView, f: Filters, today: string | null, ignore?: keyof Filters): boolean {
  return (
    (ignore === "q" || matchesQuery(c, f.q)) &&
    (ignore === "party" || !f.party || ownerOf(c).id === f.party) &&
    (ignore === "actor" || !f.actor || c.actor.id === f.actor) &&
    (ignore === "status" || !f.status || c.file.status === f.status) &&
    (ignore === "area" || !f.area || c.file.policy_area === f.area) &&
    (ignore === "overdue" || !f.overdue || isOverdue(c, today))
  );
}

export function sortCards(cards: CardView[], sort: Sort): CardView[] {
  const cost = (c: CardView) => c.current.parameters?.how_much_bn_per_year?.[1] ?? -Infinity;
  const deadline = (c: CardView) => c.file.deadline ?? "9999";
  return [...cards].sort((a, b) =>
    sort === "oldest"
      ? a.file.made_on.localeCompare(b.file.made_on)
      : sort === "cost"
        ? cost(b) - cost(a) || b.file.made_on.localeCompare(a.file.made_on)
        : sort === "deadline"
          ? deadline(a).localeCompare(deadline(b))
          : b.file.made_on.localeCompare(a.file.made_on),
  );
}

export interface ChipOption {
  id: string;
  label: string;
  count: number;
}

/**
 * Parties, and bodies with no party such as HM Government, most cards first.
 * The order comes from all cards, so chips stay put while counts change.
 */
export function ownerOptions(all: CardView[], counted: CardView[]): ChipOption[] {
  const owners = new Map<string, { a: ActorFile; n: number }>();
  for (const c of all) {
    const o = ownerOf(c);
    const e = owners.get(o.id) ?? { a: o, n: 0 };
    e.n++;
    owners.set(o.id, e);
  }
  return [...owners.values()]
    .sort((x, y) => y.n - x.n || x.a.name.localeCompare(y.a.name))
    .map(({ a }) => ({ id: a.id, label: shortName(a), count: counted.filter((c) => ownerOf(c).id === a.id).length }));
}

/**
 * One row of toggle chips, "All 32", "Labour 21" and so on, so a reader sees
 * at a glance who made how many promises. On phones the row scrolls sideways
 * and keeps the chosen chip in view.
 */
export function OwnerChips({ options, total, value, onChange }: { options: ChipOption[]; total: number; value: string; onChange: (id: string) => void }) {
  return <ChipRow label="Party or government" allLabel="All" options={options} total={total} value={value} onChange={onChange} />;
}

/** A labelled row of toggle chips with counts ("Any 34", "In plan 6"); on phones it scrolls sideways and keeps the chosen chip in view. */
export function ChipRow({
  label,
  allLabel,
  options,
  total,
  value,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: ChipOption[];
  total: number;
  value: string;
  onChange: (id: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = row.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row.current && on) keepInView(row.current, on);
  }, [value]);

  const chip = (id: string, label: string, count: number) => {
    const on = value === id;
    return (
      <button
        key={id || "all"}
        type="button"
        aria-pressed={on}
        disabled={!on && count === 0}
        onClick={() => onChange(id)}
        className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-default disabled:opacity-40 ${
          on ? "bg-ink text-bg" : "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] hover:bg-sunk"
        }`}
      >
        {label}
        <span className={`tabular-nums ${on ? "opacity-75" : "text-muted"}`}>{count}</span>
      </button>
    );
  };

  return (
    <div ref={row} role="group" aria-label={label} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
      {chip("", allLabel, total)}
      {options.map((o) => chip(o.id, o.label, o.count))}
    </div>
  );
}
