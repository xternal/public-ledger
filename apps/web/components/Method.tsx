"use client";

import { ENGINE_VERSION } from "@ledger/engine";
import { QUALITY_HELP } from "@/lib/copy";
import { fixed } from "@/lib/format";
import { useScenario } from "@/lib/scenario";
import { QualityBadge, SectionHeading } from "./ui";

export function Method() {
  const { seed } = useScenario();
  const { spending_multiplier: ms, tax_multiplier: mt } = seed.levers.macro_rules;
  const range = (r: readonly number[]) => `${fixed(r[0]!, 1)}–${fixed(r[2]!, 1)}`;

  return (
    <section id="method" aria-labelledby="method-h" className="scroll-mt-16 pt-20">
      <SectionHeading id="method-h" title="How the numbers work" />
      <div className="grid gap-10 text-sm text-muted md:grid-cols-3">
        <div>
          <h3 className="mb-2 text-body font-semibold text-ink">Ranges, not points</h3>
          <ul className="m-0 grid gap-1.5 pl-4">
            <li>Every result shows low, central and high.</li>
            <li>Tax levers use HMRC&apos;s costings, which include how taxpayers respond but not knock-on effects on the wider economy.</li>
            <li>
              GDP effects use spending multipliers of {range(ms)} and tax multipliers of {range(mt)}.
            </li>
            <li>Bank Rate is set by the Bank of England. The sandbox lets you move it, labelled as such.</li>
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-body font-semibold text-ink">Every number has a label</h3>
          <ul className="m-0 grid list-none gap-2.5 p-0">
            {(["sourced", "approx", "training", "plug"] as const).map((q) => (
              <li key={q} className="grid gap-0.5">
                <QualityBadge quality={q} />
                <span>{QUALITY_HELP[q]}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-body font-semibold text-ink">Sources</h3>
          <ul className="m-0 grid gap-1.5 pl-4">
            {seed.sources.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
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
