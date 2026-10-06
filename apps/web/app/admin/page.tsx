import { countByStatus, isStatusFilter, listSubmissions, STATUS_FILTERS, type StatusFilter } from "@ledger/server/triage";
import { getServer } from "@/lib/server";
import { requireAdmin } from "./guard";
import { STATUS_WORDS, SubmissionCard } from "./SubmissionCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ status?: string; error?: string }> };

const FILTER_WORDS: Record<StatusFilter, string> = { open: "Waiting for an editor", all: "All", ...(STATUS_WORDS as Record<Exclude<StatusFilter, "open" | "all">, string>) };

export default async function TriagePage({ searchParams }: Props) {
  await requireAdmin();
  const { status } = await searchParams;
  const filter: StatusFilter = isStatusFilter(status) ? status : "open";
  const { db } = await getServer();
  const [items, counts] = await Promise.all([listSubmissions(db, filter), countByStatus(db)]);
  const total = (f: StatusFilter) =>
    f === "all" ? Object.values(counts).reduce((a, b) => a + b, 0) : f === "open" ? (counts.received ?? 0) + (counts.auto_checked ?? 0) + (counts.in_review ?? 0) : (counts[f] ?? 0);
  return (
    <main className="mx-auto grid max-w-[1000px] gap-6 px-4 pb-20 pt-6 sm:px-6">
      <div className="grid gap-2">
        <h1 className="m-0 text-[clamp(26px,3.6vw,36px)] font-semibold leading-[1.1] tracking-[-0.03em]">Reader submissions</h1>
        <p className="m-0 text-body text-muted">
          Newest first. Accepting opens a draft pull request; two editors approve it before anything is published (invariant 8). Contact addresses are never
          shown here.
        </p>
      </div>

      <form method="get" action="/admin" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="text-caption font-medium text-muted">Show</span>
          <select name="status" defaultValue={filter} className="select min-w-[260px]">
            {STATUS_FILTERS.map((f) => (
              <option key={f} value={f}>
                {FILTER_WORDS[f]} ({total(f)})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="cursor-pointer rounded-control border border-line-strong bg-bg px-3 py-2 text-label font-semibold hover:bg-sunk">
          Show
        </button>
      </form>

      {items.length ? (
        items.map((s) => <SubmissionCard key={s.id} s={s} />)
      ) : (
        <p className="m-0 rounded-panel border border-line p-5 text-body text-muted">Nothing here.</p>
      )}
    </main>
  );
}
