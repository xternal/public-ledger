"use client";

import { useEffect, useMemo, useState } from "react";
import type { CardView, PolicyArea, Status } from "@ledger/schema";
import { STATUS_LABEL } from "@/lib/copy";
import { AREA_LABEL, STATUS_ORDER, shortName, todayIso } from "@/lib/promises";
import { ChipRow, NO_FILTERS, OwnerChips, SORT_LABEL, ownerOptions, passes, sortCards, type Filters, type Sort } from "./PromiseFilters";
import { PromiseList } from "./PromiseList";

function readFilters(): Filters {
  const q = new URLSearchParams(window.location.search);
  const sort = q.get("sort") as Sort | null;
  return {
    q: q.get("q") ?? "",
    party: q.get("party") ?? "",
    actor: q.get("actor") ?? "",
    status: q.get("status") ?? "",
    area: q.get("area") ?? "",
    overdue: q.get("overdue") === "1",
    sort: sort && sort in SORT_LABEL ? sort : "newest",
  };
}

/**
 * /promises: every card. Labelled rows of chips (party, status, each with its
 * count), a topic menu and a search box narrow the list; one line says what
 * is shown. Filters live in the URL, so a view can be shared.
 */
export function PromiseIndex({ cards }: { cards: CardView[] }) {
  const [f, setF] = useState<Filters>(NO_FILTERS);
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
      if (v === NO_FILTERS[k as keyof Filters] || v === false || v === "") url.searchParams.delete(k);
      else url.searchParams.set(k, v === true ? "1" : String(v));
    }
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, [f, ready]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  /** Cards that pass every filter but `k`: what each option of `k` is counted against. */
  const without = (k: keyof Filters) => cards.filter((c) => passes(c, f, today, k));

  const shown = useMemo(() => sortCards(cards.filter((c) => passes(c, f, today)), f.sort), [cards, f, today]);

  const forOwners = without("party");
  const owners = ownerOptions(cards, forOwners);
  const forStatus = without("status");
  const statuses = STATUS_ORDER.filter((s) => cards.some((c) => c.file.status === s)).map((s) => ({
    id: s,
    label: STATUS_LABEL[s],
    count: forStatus.filter((c) => c.file.status === s).length,
  }));
  const forArea = without("area");
  const areas = ([...new Set(cards.map((c) => c.file.policy_area))] as PolicyArea[])
    .sort((a, b) => AREA_LABEL[a].localeCompare(AREA_LABEL[b]))
    .map((a) => ({ value: a, label: AREA_LABEL[a], count: forArea.filter((c) => c.file.policy_area === a).length }));

  const active = activeFilters(f, cards);
  const order = f.sort === "newest" ? "newest first" : SORT_LABEL[f.sort].toLowerCase();
  const resultLine = shown.length === cards.length ? `All ${cards.length} promises, ${order}.` : `${shown.length} of ${cards.length} promises, ${order}.`;
  const row = "grid items-center gap-x-6 gap-y-2 md:grid-cols-[5.5rem_minmax(0,1fr)]";
  const rowLabel = "text-label text-muted";

  return (
    <div className="grid gap-5">
      <form className="grid gap-4 border-t border-line pt-6" onSubmit={(e) => e.preventDefault()} role="search" aria-label="Filter promises">
        <div className={row}>
          <span className={rowLabel}>Party</span>
          <OwnerChips options={owners} total={forOwners.length} value={f.party} onChange={(id) => set("party", id)} />
        </div>
        <div className={row}>
          <span className={rowLabel}>Status</span>
          <ChipRow label="Status" allLabel="Any" options={statuses} total={forStatus.length} value={f.status} onChange={(id) => set("status", id)} />
        </div>
        <div className={row}>
          <span className={rowLabel}>Topic</span>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
            <Select value={f.area} onChange={(v) => set("area", v)} options={areas} allLabel="All topics" label="Topic" />
            <label className="relative">
              <span className="sr-only">Search the promises</span>
              <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint">
                <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input type="search" className="field-input pl-8" placeholder="Search words, names, places" value={f.q} onChange={(e) => set("q", e.target.value)} />
            </label>
          </div>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line pt-4 text-label">
        <span className="text-muted" aria-live="polite">
          {resultLine}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {active.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => set(a.key, NO_FILTERS[a.key])}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-sunk px-2.5 py-1 text-caption font-medium text-ink hover:shadow-[inset_0_0_0_1px_var(--line-strong)]"
              aria-label={`Remove filter: ${a.label}`}
            >
              {a.label} <span aria-hidden>×</span>
            </button>
          ))}
          {active.length > 1 && (
            <button type="button" onClick={() => setF((x) => ({ ...NO_FILTERS, sort: x.sort }))} className="cursor-pointer font-medium text-ink underline underline-offset-2">
              Clear all
            </button>
          )}
          <label className="flex items-center gap-2 text-muted">
            Sort
            <span className="w-48">
              <Select value={f.sort} onChange={(v) => set("sort", v as Sort)} options={Object.entries(SORT_LABEL).map(([value, label]) => ({ value, label }))} allLabel={null} label="Sort" />
            </span>
          </label>
        </span>
      </div>

      <PromiseList cards={shown} today={today} empty="No promises match these filters. Remove one above, or clear them all." />
    </div>
  );
}

function activeFilters(f: Filters, cards: CardView[]): { key: keyof Filters; label: string }[] {
  const out: { key: keyof Filters; label: string }[] = [];
  const actor = (id: string) => cards.find((c) => c.actor.id === id)?.actor ?? cards.find((c) => c.party?.id === id)?.party;
  if (f.q.trim()) out.push({ key: "q", label: `“${f.q.trim()}”` });
  if (f.party) out.push({ key: "party", label: actor(f.party) ? shortName(actor(f.party)!) : f.party });
  if (f.actor) out.push({ key: "actor", label: actor(f.actor)?.name ?? f.actor });
  if (f.status) out.push({ key: "status", label: STATUS_LABEL[f.status as Status] ?? f.status });
  if (f.area) out.push({ key: "area", label: AREA_LABEL[f.area as PolicyArea] ?? f.area });
  if (f.overdue) out.push({ key: "overdue", label: "Past deadline" });
  return out;
}



interface Option {
  value: string;
  label: string;
  count?: number;
}

/** A native select; options that would leave no cards are disabled, unless chosen. */
function Select({ value, onChange, options, allLabel = "All", label }: { value: string; onChange: (v: string) => void; options: Option[]; allLabel?: string | null; label?: string }) {
  return (
    <span className="relative">
      <select className="select pr-8 text-ink" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {allLabel !== null && <option value="">{allLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.count === 0 && o.value !== value}>
            {o.count === undefined ? o.label : `${o.label} (${o.count})`}
          </option>
        ))}
      </select>
      <svg aria-hidden viewBox="0 0 12 12" className="pointer-events-none absolute right-3 top-1/2 size-3 -translate-y-1/2 text-muted">
        <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
