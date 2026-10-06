"use client";

import { useMemo, useState } from "react";
import { yourShare } from "@ledger/engine";
import { gbp, grouped, signed } from "@/lib/format";
import { useScenario } from "@/lib/scenario";
import { QualityBadge, SectionHeading, WithProvenance } from "./ui";

/**
 * Income tax and NI on a salary, split the way the state spends it (PRD F3).
 * The salary lives in this component's state only: it is never sent,
 * stored or tracked (invariant 7).
 */
export function YourShare() {
  const { seed, model, result, settings } = useScenario();
  const [salary, setSalary] = useState(seed.tax.your_share_defaults.salary_gbp);
  const share = useMemo(() => yourShare(model, seed.tax, result, settings, salary), [model, seed.tax, result, settings, salary]);
  const labelOf = (id: string) => seed.statement.spending.find((l) => l.id === id)?.label ?? id;
  const max = Math.max(...share.by_line.map((l) => l.gbp), share.borrowed_on_top_gbp, 1);
  const taxP = { quality: seed.tax.meta.quality, method_note: seed.tax.meta.method_note };

  return (
    <section id="you" aria-labelledby="you-h" className="scroll-mt-16 pt-20">
      <SectionHeading
        id="you-h"
        title="Your share of the bill"
        intro="Income tax and National Insurance on a salary, under today's rates or your scenario, split the way the state spends it."
      />
      <div className="grid items-start gap-10 md:grid-cols-[300px_minmax(0,1fr)]">
        <div className="grid gap-4 rounded-panel border border-line p-5">
          <div className="grid gap-1.5">
            <label htmlFor="salary" className="text-label font-medium text-muted">
              Annual salary
            </label>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[22px] font-semibold text-faint">
                £
              </span>
              <input
                id="salary"
                inputMode="numeric"
                autoComplete="off"
                value={salary ? grouped(salary) : ""}
                onChange={(e) => setSalary(Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0))}
                className="w-full rounded-control border border-line-strong bg-bg py-2 pl-8 pr-3 text-[22px] font-semibold tracking-[-0.02em] text-ink"
              />
            </div>
            <span className="text-caption text-muted">Stays on this device. We never see it.</span>
          </div>
          <dl className="m-0 grid gap-2 text-sm">
            <div className="flex justify-between">
              <dt>Income tax</dt>
              <dd className="m-0">{gbp(share.scenario.income_tax)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>National Insurance</dt>
              <dd className="m-0">{gbp(share.scenario.ni)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 font-semibold">
              <dt>You pay a year</dt>
              <dd className="m-0">{gbp(share.scenario.total)}</dd>
            </div>
            {Math.abs(share.diff) > 0.5 && (
              <div className="flex justify-between">
                <dt className="text-muted">Against today</dt>
                <dd className={`m-0 font-medium ${share.diff > 0 ? "text-bad" : "text-good"}`}>{signed(share.diff, gbp, 0.5)}</dd>
              </div>
            )}
          </dl>
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
            Excludes VAT, council tax and other taxes you also pay. Rates for {seed.tax.meta.geography}, {seed.tax.meta.tax_year}.
            <WithProvenance p={taxP}>
              <QualityBadge quality={taxP.quality} />
            </WithProvenance>
          </p>
        </div>

        <ul className="m-0 grid list-none gap-3 p-0" aria-label="Your tax split by what it pays for">
          {share.by_line.map((l) => (
            <li key={l.id} className="grid grid-cols-[112px_minmax(0,1fr)_64px] items-center gap-3 text-[13px] sm:grid-cols-[190px_minmax(0,1fr)_80px] sm:gap-4 sm:text-sm">
              <span className="leading-tight">{labelOf(l.id)}</span>
              <span className="h-2 overflow-hidden rounded-full bg-sunk">
                <i className="block h-full rounded-full bg-spend" style={{ width: `${(l.gbp / max) * 100}%` }} />
              </span>
              <span className="text-right font-medium">{gbp(l.gbp)}</span>
            </li>
          ))}
          <li className="mt-2 grid grid-cols-[112px_minmax(0,1fr)_64px] items-center gap-3 border-t border-line pt-4 text-[13px] sm:grid-cols-[190px_minmax(0,1fr)_80px] sm:gap-4 sm:text-sm">
            <span className="font-semibold">Plus borrowing on top</span>
            <span className="h-2 overflow-hidden rounded-full bg-sunk">
              <i className="hatch block h-full rounded-full" style={{ width: `${(share.borrowed_on_top_gbp / max) * 100}%` }} />
            </span>
            <span className="text-right font-semibold text-debt-ink">{gbp(share.borrowed_on_top_gbp)}</span>
          </li>
        </ul>
      </div>
    </section>
  );
}
