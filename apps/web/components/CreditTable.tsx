import type { CardView, Status } from "@ledger/schema";
import { signedBn } from "@/lib/format";

/**
 * Track record computed only from cards (review B4). No composite score in
 * v0 (README §4.6): the distribution is shown and readers judge. The same
 * columns and rules for every actor (invariant 6).
 */
export const CREDIT_COLUMNS: { label: string; statuses: Status[]; color: string }[] = [
  { label: "Delivered", statuses: ["delivered"], color: "var(--good)" },
  { label: "In progress", statuses: ["promised", "in_plan", "legislated", "funded", "delivering"], color: "var(--warn)" },
  { label: "Failed", statuses: ["failed"], color: "var(--bad)" },
  { label: "Quietly dropped", statuses: ["quietly_dropped"], color: "var(--debt)" },
  { label: "Unscoreable", statuses: ["unscoreable"], color: "var(--idle)" },
];

export interface CreditRow {
  id: string;
  name: string;
  href: string;
  cards: CardView[];
  counts: number[];
  /** Per column, how many of those outcomes someone else brought about (outcome_by). */
  byOthers: number[];
  costed: number;
  pledgedBn: number;
  fundingNamed: number;
}

export function creditRows(cards: CardView[], by: "party" | "actor"): CreditRow[] {
  const groups = new Map<string, { name: string; cards: CardView[] }>();
  for (const c of cards) {
    const owner = by === "party" ? (c.party ?? c.actor) : c.actor;
    const g = groups.get(owner.id) ?? { name: owner.name, cards: [] };
    g.cards.push(c);
    groups.set(owner.id, g);
  }
  return [...groups.entries()]
    .map(([id, g]) => ({
      id,
      name: g.name,
      href: `/actor/${id}`,
      cards: g.cards,
      counts: CREDIT_COLUMNS.map((col) => g.cards.filter((c) => col.statuses.includes(c.file.status)).length),
      byOthers: CREDIT_COLUMNS.map((col) => g.cards.filter((c) => col.statuses.includes(c.file.status) && c.outcomeBy).length),
      costed: g.cards.filter((c) => c.current.parameters?.how_much_bn_per_year).length,
      pledgedBn: g.cards.reduce((a, c) => a + (c.current.parameters?.how_much_bn_per_year?.[1] ?? 0), 0),
      fundingNamed: g.cards.filter((c) => c.current.parameters?.funded_by).length,
    }))
    .sort((a, b) => b.cards.length - a.cards.length || a.name.localeCompare(b.name));
}

export function MixBar({ counts, total }: { counts: number[]; total: number }) {
  return (
    <div className="flex h-2 min-w-[140px] gap-0.5 overflow-hidden rounded-full bg-sunk" aria-hidden>
      {counts.map((n, i) => (n ? <i key={i} className="block h-full" style={{ width: `${(n / total) * 100}%`, background: CREDIT_COLUMNS[i]!.color }} /> : null))}
    </div>
  );
}

export function CreditTable({ cards, by, caption }: { cards: CardView[]; by: "party" | "actor"; caption: string }) {
  const rows = creditRows(cards, by);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse whitespace-nowrap text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-[12.5px] text-muted">
            <th className="py-2.5 pr-4 text-left font-medium">{by === "party" ? "Party" : "Actor"}</th>
            <th className="py-2.5 pr-4 text-right font-medium">Cards</th>
            {CREDIT_COLUMNS.map((c) => (
              <th key={c.label} className="py-2.5 pr-4 text-right font-medium">
                {c.label}
              </th>
            ))}
            <th className="py-2.5 pr-4 text-right font-medium">Net cost of costed cards, a year</th>
            <th className="py-2.5 pr-4 text-right font-medium">Funding named</th>
            <th className="py-2.5 text-left font-medium">Mix</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line">
              <td className="py-2.5 pr-4">
                <a href={r.href}>{r.name}</a>
              </td>
              <td className="py-2.5 pr-4 text-right">{r.cards.length}</td>
              {r.counts.map((n, i) => (
                <td key={i} className={`py-2.5 pr-4 text-right ${n ? "" : "text-muted"}`}>
                  {n}
                  {r.byOthers[i] ? <span className="block text-caption text-muted">{r.byOthers[i]} by others</span> : null}
                </td>
              ))}
              <td className="py-2.5 pr-4 text-right">{r.costed ? signedBn(r.pledgedBn) : <span className="text-muted">not costed</span>}</td>
              <td className="py-2.5 pr-4 text-right">
                {r.fundingNamed} of {r.cards.length}
              </td>
              <td className="py-2.5">
                <MixBar counts={r.counts} total={r.cards.length} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
