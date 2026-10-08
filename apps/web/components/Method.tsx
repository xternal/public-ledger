"use client";

import { ENGINE_VERSION } from "@ledger/engine";
import { QUALITY_HELP } from "@/lib/copy";
import { T1_METHOD } from "@/lib/t1-copy";
import { useScenario } from "@/lib/scenario";
import { QualityBadge, SectionHeading } from "./ui";

/** The home page's short method note; the full method, the backtest and the API live under /method. */
export function Method() {
  const { seed } = useScenario();
  return (
    <section id="method" aria-labelledby="method-h" className="pt-20">
      <SectionHeading
        id="method-h"
        title="How the numbers work"
        intro={`Every number comes from one of ${seed.sources.length} official sources, or is worked out from them, and says which.`}
      />
      <div className="grid gap-10 text-sm text-muted md:grid-cols-3">
        <div>
          <h3 className="mb-2 text-body font-semibold text-ink">Ranges, not points</h3>
          <p className="m-0">
            Every result shows low, central and high. Tax levers use HMRC&apos;s costings, which include how taxpayers respond but not knock-on effects on
            the wider economy.
          </p>
        </div>
        <div>
          <h3 className="mb-2 text-body font-semibold text-ink">Every number has a label</h3>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0">
            {(["sourced", "approx", "modelled", "training"] as const).map((q) => (
              <li key={q} title={q === "modelled" ? T1_METHOD.modelledHelp : QUALITY_HELP[q]}>
                <QualityBadge quality={q} />
              </li>
            ))}
          </ul>
          <p className="m-0 mt-2">Hover over or focus a number to see how it was made and where it comes from.</p>
        </div>
        <div>
          <h3 className="mb-2 text-body font-semibold text-ink">Checked against what happened</h3>
          <p className="m-0">Every forecast shown here is recorded, and scored when the official outturn arrives, misses included.</p>
        </div>
      </div>
      <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
        <a href="/method">How the numbers are made</a>
        <a href="/method/backtest">Forecasts against outturn</a>
        <a href="/method/api">Open data API</a>
      </p>
    </section>
  );
}

export function Footer() {
  const { seed } = useScenario();
  return (
    <footer className="mt-20 grid gap-1 border-t border-line pt-5 text-[12.5px] text-muted">
      <p className="m-0">
        Early version. Figures come from the official sources above; promise cards have not yet had their editor and legal review, so check a
        card&apos;s sources before quoting it.
      </p>
      <p className="m-0">
        Data vintage {seed.statement.meta.vintage}. Engine {ENGINE_VERSION}.
      </p>
    </footer>
  );
}
