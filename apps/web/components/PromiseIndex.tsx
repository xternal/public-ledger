"use client";

import { useEffect, useMemo, useState } from "react";
import type { CardView, PolicyArea, Status } from "@ledger/schema";
import { STATUS_LABEL } from "@/lib/copy";
import { AREA_LABEL, STATUS_ORDER, isOverdue, todayIso } from "@/lib/promises";
import { PromiseList } from "./PromiseList";

type Sort = "newest" | "oldest" | "cost" | "deadline";
const SORT_LABEL: Record<Sort, string> = { newest: "Newest first", oldest: "Oldest first", cost: "Largest cost first", deadline: "Nearest deadline first" };

interface Filters {
  party: string;
  actor: string;
  status: string;
  area: string;
  overdue: boolean;
  sort: Sort;
}
const EMPTY: Filters = { party: "", actor: "", status: "", area: "", overdue: false, sort: "newest" };

function readFilters(): Filters {
  const q = new URLSearchParams(window.location.search);
  const sort = q.get("sort") as Sort | null;
  return {
    party: q.get("party") ?? "",
    actor: q.get("actor") ?? "",
    status: q.get("status") ?? "",
    area: q.get("area") ?? "",
    overdue: q.get("overdue") === "1",
    sort: sort && sort in SORT_LABEL ? sort : "newest",
  };
}

/** /promises: every card, filterable by party, actor, status, area and overdue; filters live in the URL so views can be shared. */
export function PromiseIndex({ cards }: { cards: CardView[] }) {
  const [f, setF] = useState<Filters>(EMPTY);
  const [today, setToday] = useState<string | null>(null);
  // Filters come from the URL once; only after that does the URL follow the filters.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setToday(todayIso());
    setF(readFilters());
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(f)) {
      if (v === EMPTY[k as keyof Filters] || v === false || v === "") url.searchParams.delete(k);
      else url.searchParams.set(k, v === true ? "1" : String(v));
    }
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, [f, ready]);

  const parties = useMemo(() => uniq(cards.map((c) => c.party ?? c.actor)), [cards]);
  const actors = useMemo(() => uniq(cards.map((c) => c.actor)), [cards]);
  const areas = useMemo(() => [...new Set(cards.map((c) => c.file.policy_area))].sort() as PolicyArea[], [cards]);
  const statuses = useMemo(() => STATUS_ORDER.filter((s) => cards.some((c) => c.file.status === s)), [cards]);

  const shown = useMemo(() => {
    const list = cards.filter(
      (c) =>
        (!f.party || (c.party ?? c.actor).id === f.party) &&
        (!f.actor || c.actor.id === f.actor) &&
        (!f.status || c.file.status === f.status) &&
        (!f.area || c.file.policy_area === f.area) &&
        (!f.overdue || isOverdue(c, today)),
    );
    const cost = (c: CardView) => c.current.parameters?.how_much_bn_per_year?.[1] ?? -1;
    const byDeadline = (c: CardView) => c.file.deadline ?? "9999";
    return [...list].sort((a, b) =>
      f.sort === "oldest"
        ? a.file.made_on.localeCompare(b.file.made_on)
        : f.sort === "cost"
          ? cost(b) - cost(a)
          : f.sort === "deadline"
            ? byDeadline(a).localeCompare(byDeadline(b))
            : b.file.made_on.localeCompare(a.file.made_on),
    );
  }, [cards, f, today]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const field = "grid gap-1 text-label text-muted";
  const any = JSON.stringify(f) !== JSON.stringify(EMPTY);

  return (
    <div className="grid gap-6">
      <form className="grid grid-cols-2 gap-3 rounded-panel bg-sunk p-4 md:grid-cols-6" onSubmit={(e) => e.preventDefault()} aria-label="Filter promises">
        <label className={field}>
          Party
          <Select value={f.party} onChange={(v) => set("party", v)} options={parties.map((p) => [p.id, p.name])} />
        </label>
        <label className={field}>
          Person or body
          <Select value={f.actor} onChange={(v) => set("actor", v)} options={actors.map((a) => [a.id, a.name])} />
        </label>
        <label className={field}>
          Status
          <Select value={f.status} onChange={(v) => set("status", v)} options={statuses.map((s) => [s, STATUS_LABEL[s as Status]])} />
        </label>
        <label className={field}>
          Area
          <Select value={f.area} onChange={(v) => set("area", v)} options={areas.map((a) => [a, AREA_LABEL[a]])} />
        </label>
        <label className={field}>
          Sort
          <Select value={f.sort} onChange={(v) => set("sort", v as Sort)} options={Object.entries(SORT_LABEL)} all={false} />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm text-ink">
          <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={f.overdue} onChange={(e) => set("overdue", e.target.checked)} />
          Deadline passed
        </label>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3 text-label text-muted" aria-live="polite">
        <span>
          {shown.length} of {cards.length} promises
        </span>
        {any && (
          <button type="button" onClick={() => setF(EMPTY)} className="cursor-pointer font-medium text-ink underline underline-offset-2">
            Clear filters
          </button>
        )}
      </div>
      <PromiseList cards={shown} today={today} empty="No promises match these filters." />
    </div>
  );
}

function uniq<T extends { id: string; name: string }>(xs: T[]): T[] {
  return [...new Map(xs.map((x) => [x.id, x])).values()].sort((a, b) => a.name.localeCompare(b.name));
}

function Select({ value, onChange, options, all = true }: { value: string; onChange: (v: string) => void; options: [string, string][]; all?: boolean }) {
  return (
    <span className="relative">
      <select className="select pr-8 text-ink" value={value} onChange={(e) => onChange(e.target.value)}>
        {all && <option value="">All</option>}
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <svg aria-hidden viewBox="0 0 12 12" className="pointer-events-none absolute right-3 top-1/2 size-3 -translate-y-1/2 text-muted">
        <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
