"use client";

import { useState } from "react";
import { QUALITY_LABEL } from "@/lib/copy";
import { deltaInUnit, inUnit, millions, type Unit, type UnitContext } from "@/lib/format";
import { LABEL_DELTA_MIN_BN } from "@/lib/chart-config";
import { track } from "@/lib/analytics";
import { useScenario } from "@/lib/scenario";
import { BORROWING_ID, FlowList, LineInspector, Sankey, useFlowLines, type FlowLine } from "./Sankey";
import { SandboxDock } from "./SandboxDock";
import { ResultPanel } from "./ResultPanel";
import { QualityBadge, SectionHeading, Segmented, TextButton, WithProvenance, qualityKey } from "./ui";

const UNITS: { value: Unit; label: string }[] = [
  { value: "bn", label: "£ billion" },
  { value: "hh", label: "Per household" },
  { value: "p", label: "Pence per £1" },
];

export function StatementSection() {
  const { seed, unit, setUnit } = useScenario();
  const [active, setActive] = useState<string | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const { macro, receipts, spending, borrowing_provenance } = seed.statement;
  const plugs = [...receipts, ...spending].filter((l) => l.plug).map((l) => `“${l.label}”`);
  const totalsSource = seed.sources.find((s) => s.id === borrowing_provenance.source_id);

  return (
    <section id="statement" aria-labelledby="statement-h" className="scroll-mt-16 pt-16">
      <SectionHeading
        id="statement-h"
        title="The statement"
        intro="Income on the left, spending on the right. The hatched band is borrowing. Move any lever and the flows redraw."
      />
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Segmented label="Units" options={UNITS} value={unit} onChange={setUnit} />
            <div className="flex flex-wrap gap-4 text-label text-muted">
              <span className="inline-flex items-center gap-1.5">
                <i className="size-2 rounded-full bg-rec" aria-hidden />
                Income
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="hatch size-2.5 rounded-[2px]" aria-hidden />
                Borrowing and debt interest
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="size-2 rounded-full bg-spend" aria-hidden />
                Spending
              </span>
            </div>
          </div>
          {unit === "hh" && (
            <p className="mb-2 flex flex-wrap items-center gap-2 text-caption text-muted">
              Divided by {millions(macro.households_m)} households.
              <WithProvenance p={macro.provenance.households_m!}>
                <QualityBadge quality={macro.provenance.households_m!.quality} />
              </WithProvenance>
            </p>
          )}

          <div className="hidden overflow-x-auto min-[720px]:block">
            <Sankey active={active} onActive={setActive} />
          </div>
          <div className="min-[720px]:hidden">
            <FlowList />
          </div>
          <div className="mt-3 hidden min-[720px]:block">
            <LineInspector active={active} />
          </div>

          <div className="mt-4 grid justify-items-start gap-2 text-label leading-snug text-muted">
            <span className="inline-flex flex-wrap items-baseline gap-x-2">
              <QualityBadge quality="sourced" />
              Totals, borrowing and debt interest{totalsSource ? `: ${totalsSource.title}.` : "."}
            </span>
            <span className="inline-flex flex-wrap items-baseline gap-x-2">
              <QualityBadge quality="approx" />
              Splits by tax and by function are scaled estimates.
            </span>
            {plugs.length > 0 && (
              <span className="inline-flex flex-wrap items-baseline gap-x-2">
                <QualityBadge quality="plug" />
                {plugs.join(", ")} balance the statement until the data pipeline breaks them down.
              </span>
            )}
            <TextButton
              aria-expanded={tableOpen}
              aria-controls="statement-table"
              onClick={() => {
                if (!tableOpen) track("chart_table_opened", { chart_id: "statement" });
                setTableOpen(!tableOpen);
              }}
            >
              {tableOpen ? "Hide table" : "Show as table"}
            </TextButton>
          </div>
          {tableOpen && <StatementTable />}
        </div>
        <SandboxDock />
      </div>
      <ResultPanel />
    </section>
  );
}

function StatementTable() {
  const { seed, unit } = useScenario();
  const { income, spending, total } = useFlowLines();
  const ctx: UnitContext = { households_m: seed.statement.macro.households_m, total_bn: total };
  const row = (f: FlowLine) => {
    const delta = f.v - f.base;
    const source = f.line?.source_id ? seed.sources.find((s) => s.id === f.line!.source_id) : undefined;
    return (
      <tr key={f.id} className="border-b border-line">
        <td className="py-2.5 pr-4 text-muted">{f.id === BORROWING_ID ? "Borrowing" : f.side === "income" ? "Income" : "Spending"}</td>
        <td className="py-2.5 pr-4">{f.label}</td>
        <td className="py-2.5 pr-4 text-right">{inUnit(f.v, unit, ctx)}</td>
        <td className="py-2.5 pr-4 text-right">{Math.abs(delta) > LABEL_DELTA_MIN_BN ? deltaInUnit(delta, unit, ctx) : ""}</td>
        <td className="py-2.5 pr-4">{f.line ? QUALITY_LABEL[qualityKey(f.line)] : "Derived"}</td>
        <td className="py-2.5 text-muted">{source?.publisher ?? ""}</td>
      </tr>
    );
  };
  return (
    <div id="statement-table" className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse whitespace-nowrap text-sm">
        <caption className="sr-only">Statement lines, values and changes under the current scenario</caption>
        <thead>
          <tr className="border-b border-line text-left text-[12.5px] text-muted">
            <th className="py-2 pr-4 font-medium">Side</th>
            <th className="py-2 pr-4 font-medium">Line</th>
            <th className="py-2 pr-4 text-right font-medium">Value</th>
            <th className="py-2 pr-4 text-right font-medium">Change</th>
            <th className="py-2 pr-4 font-medium">Quality</th>
            <th className="py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {income.map(row)}
          {spending.map(row)}
        </tbody>
      </table>
    </div>
  );
}
