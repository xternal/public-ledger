"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CardView, PolicyArea, Range, Status } from "@ledger/schema";
import { STATUS_LABEL } from "@/lib/copy";
import { gbpBn, rangeText, signedBn } from "@/lib/format";
import { AREA_LABEL, STATUS_ORDER, TERMINAL, costSense, isOverdue, shortName, todayIso } from "@/lib/promises";
import { NO_FILTERS, OwnerChips, SORT_LABEL, ownerOptions, passes, sortCards, type Filters, type Sort } from "./PromiseFilters";
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
 * /promises: every card. A search box, a row of party chips and three
 * selects narrow the list; each option shows how many cards it would leave.
 * A line of counts sums up what is shown. Filters live in the URL, so a view
 * can be shared.
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
  const forPeople = without("actor");
  const people = uniqActors(cards.filter((c) => c.actor.kind === "person" || c.actor.id === f.actor)).map((a) => ({
    value: a.id,
    label: a.name,
    count: forPeople.filter((c) => c.actor.id === a.id).length,
  }));
  const forStatus = without("status");
  const statuses = STATUS_ORDER.filter((s) => cards.some((c) => c.file.status === s)).map((s) => ({
    value: s,
    label: STATUS_LABEL[s],
    count: forStatus.filter((c) => c.file.status === s).length,
  }));
  const forArea = without("area");
  const areas = ([...new Set(cards.map((c) => c.file.policy_area))] as PolicyArea[])
    .sort((a, b) => AREA_LABEL[a].localeCompare(AREA_LABEL[b]))
    .map((a) => ({ value: a, label: AREA_LABEL[a], count: forArea.filter((c) => c.file.policy_area === a).length }));
  const overdueCount = without("overdue").filter((c) => isOverdue(c, today)).length;

  const active = activeFilters(f, cards);
  const narrowedToOne = !!(f.party || f.actor);

  return (
    <div className="grid gap-5">
      <form className="grid gap-4" onSubmit={(e) => e.preventDefault()} role="search" aria-label="Filter promises">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
          <label className="col-span-2 grid gap-1 text-caption text-muted md:col-span-1">
            Search
            <span className="relative">
              <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint">
                <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                className="field-input pl-8"
                placeholder="Words from the promise, a name, a topic"
                value={f.q}
                onChange={(e) => set("q", e.target.value)}
              />
            </span>
          </label>
          <Field label="Status">
            <Select value={f.status} onChange={(v) => set("status", v)} options={statuses} />
          </Field>
          <Field label="Area">
            <Select value={f.area} onChange={(v) => set("area", v)} options={areas} />
          </Field>
          <Field label="Person" className="col-span-2 md:col-span-1">
            <Select value={f.actor} onChange={(v) => set("actor", v)} options={people} allLabel="Anyone" />
          </Field>
        </div>
        <OwnerChips options={owners} total={forOwners.length} value={f.party} onChange={(id) => set("party", id)} />
      </form>

      <div className="grid gap-3 border-y border-line py-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <Summary cards={shown} today={today} total={cards.length} withCost={narrowedToOne} />
          <label className="flex items-center gap-2 text-label text-muted">
            Sort
            <span className="w-52">
              <Select value={f.sort} onChange={(v) => set("sort", v as Sort)} options={Object.entries(SORT_LABEL).map(([value, label]) => ({ value, label }))} allLabel={null} />
            </span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-label">
          <label className={`flex items-center gap-2 ${overdueCount || f.overdue ? "cursor-pointer text-ink" : "text-faint"}`}>
            <input
              type="checkbox"
              className="switch"
              checked={f.overdue}
              disabled={!overdueCount && !f.overdue}
              onChange={(e) => set("overdue", e.target.checked)}
            />
            Only promises past their deadline <span className="tabular-nums text-muted">{overdueCount}</span>
          </label>
          {active.length > 0 && (
            <span className="flex flex-wrap items-center gap-2 md:ml-auto">
              <span className="text-muted">Showing:</span>
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
              <button type="button" onClick={() => setF((x) => ({ ...NO_FILTERS, sort: x.sort }))} className="cursor-pointer font-medium text-ink underline underline-offset-2">
                Clear all
              </button>
            </span>
          )}
        </div>
      </div>

      <PromiseList cards={shown} today={today} empty="No promises match these filters. Remove one above, or clear them all." />
    </div>
  );
}

/** The counts for what is shown: a line of numbers first, words second. */
function Summary({ cards, today, total, withCost }: { cards: CardView[]; today: string | null; total: number; withCost: boolean }) {
  const live = cards.filter((c) => !TERMINAL.includes(c.file.status)).length;
  const delivered = cards.filter((c) => c.file.status === "delivered").length;
  const broken = cards.filter((c) => c.file.status === "failed" || c.file.status === "quietly_dropped").length;
  const overdue = cards.filter((c) => isOverdue(c, today)).length;
  const costed = cards.filter((c) => c.current.parameters?.how_much_bn_per_year);
  const items: { n: ReactNode; label: string; tone?: string }[] = [
    { n: cards.length, label: cards.length === total ? (cards.length === 1 ? "promise" : "promises") : `of ${total} promises` },
    { n: live, label: "in progress" },
    { n: delivered, label: "delivered" },
    { n: broken, label: "not met or undone" },
    { n: overdue, label: "past deadline", tone: overdue ? "text-debt-ink" : undefined },
    { n: costed.length, label: "with a cost" },
  ];
  // A net cost only means something for one party or person: adding up rival parties' promises would not.
  if (withCost && costed.length) {
    const sum = costed.reduce<Range>(
      (acc, c) => {
        const r = c.current.parameters!.how_much_bn_per_year!;
        return [acc[0] + r[0], acc[1] + r[1], acc[2] + r[2]];
      },
      [0, 0, 0],
    );
    if (sum[0] < 0 && sum[2] > 0) {
      // The range runs from raising money to costing it: keep the signs.
      items.push({ n: rangeText(sum, signedBn), label: "net a year (+ costs, − raises)" });
    } else {
      const { raises, abs } = costSense(sum);
      items.push({ n: rangeText(abs, gbpBn), label: raises ? "net raised a year" : "net cost a year" });
    }
  }
  return (
    <dl className="m-0 flex flex-wrap gap-x-6 gap-y-3" aria-live="polite">
      {items.map((it) => (
        <div key={it.label} className="grid gap-0.5">
          <dt className="order-2 text-caption text-muted">{it.label}</dt>
          <dd className={`order-1 m-0 text-[22px] font-semibold leading-none tracking-[var(--tracking-figure)] tabular-nums ${it.tone ?? ""}`}>{it.n}</dd>
        </div>
      ))}
    </dl>
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

function uniqActors(cards: CardView[]) {
  return [...new Map(cards.map((c) => [c.actor.id, c.actor])).values()].sort((a, b) => a.name.localeCompare(b.name));
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`grid gap-1 text-caption text-muted ${className}`}>
      {label}
      {children}
    </label>
  );
}

interface Option {
  value: string;
  label: string;
  count?: number;
}

/** A native select; options that would leave no cards are disabled, unless chosen. */
function Select({ value, onChange, options, allLabel = "All" }: { value: string; onChange: (v: string) => void; options: Option[]; allLabel?: string | null }) {
  return (
    <span className="relative">
      <select className="select pr-8 text-ink" value={value} onChange={(e) => onChange(e.target.value)}>
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
