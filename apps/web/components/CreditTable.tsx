"use client";

import type { PromiseCard, Status } from "@ledger/schema";
import { gbpBn } from "@/lib/format";
import { QualityBadge, SectionHeading } from "./ui";

/**
 * Track record per actor, computed only from cards (review B4: no
 * illustrative rows). No composite score in v0 (README §4.6): the
 * distribution is shown and readers judge.
 */
const COLUMNS: { label: string; statuses: Status[]; color: string }[] = [
  { label: "Delivered", statuses: ["delivered"], color: "var(--good)" },
  { label: "In progress", statuses: ["promised", "in_plan", "legislated", "funded", "delivering"], color: "var(--warn)" },
  { label: "Failed", statuses: ["failed"], color: "var(--bad)" },
  { label: "Quietly dropped", statuses: ["quietly_dropped"], color: "var(--debt)" },
  { label: "Unscoreable", statuses: ["unscoreable"], color: "var(--idle)" },
];

export function CreditTable({ promises }: { promises: PromiseCard[] }) {
  const byActor = new Map<string, PromiseCard[]>();
  for (const p of promises) byActor.set(p.actor.name, [...(byActor.get(p.actor.name) ?? []), p]);
  const rows = [...byActor.entries()]
    .map(([name, cards]) => ({
      name,
      cards,
      counts: COLUMNS.map((c) => cards.filter((p) => c.statuses.includes(p.status)).length),
      pledged: cards.reduce((a, p) => a + (p.parameters?.how_much_bn_per_year?.[1] ?? 0), 0),
      costed: cards.filter((p) => p.parameters?.how_much_bn_per_year).length,
    }))
    .sort((a, b) => b.cards.length - a.cards.length || a.name.localeCompare(b.name));

  return (
    <div className="mt-16">
      <SectionHeading
        title="Track record"
        intro="How each actor's promises stand, counted from the cards above. No scores: the mix speaks for itself."
        aside={<QualityBadge quality="approx">Sample cards, editor check pending</QualityBadge>}
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse whitespace-nowrap text-sm">
          <caption className="sr-only">Promises by actor and status</caption>
          <thead>
            <tr className="border-b border-line text-[12.5px] text-muted">
              <th className="py-2.5 pr-4 text-left font-medium">Actor</th>
              <th className="py-2.5 pr-4 text-right font-medium">Cards</th>
              {COLUMNS.map((c) => (
                <th key={c.label} className="py-2.5 pr-4 text-right font-medium">
                  {c.label}
                </th>
              ))}
              <th className="py-2.5 pr-4 text-right font-medium">Costed, a year</th>
              <th className="py-2.5 text-left font-medium">Mix</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-line">
                <td className="py-2.5 pr-4">{r.name}</td>
                <td className="py-2.5 pr-4 text-right">{r.cards.length}</td>
                {r.counts.map((n, i) => (
                  <td key={i} className={`py-2.5 pr-4 text-right ${n ? "" : "text-faint"}`}>
                    {n}
                  </td>
                ))}
                <td className="py-2.5 pr-4 text-right">
                  {r.costed ? gbpBn(r.pledged) : <span className="text-faint">not costed</span>}
                </td>
                <td className="py-2.5">
                  <div className="flex h-2 min-w-[140px] gap-0.5 overflow-hidden rounded-full bg-sunk" aria-hidden>
                    {r.counts.map((n, i) =>
                      n ? <i key={i} className="block h-full" style={{ width: `${(n / r.cards.length) * 100}%`, background: COLUMNS[i]!.color }} /> : null,
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
