"use client";

import { useMemo, useState } from "react";
import { scaleLinear, scalePoint } from "d3-scale";
import { area, line } from "d3-shape";
import type { DebtPoint } from "@ledger/engine";
import { FAN } from "@/lib/chart-config";
import { fixed, shortYear } from "@/lib/format";
import { useScenario } from "@/lib/scenario";
import { TextButton } from "./ui";

/** Debt as % of GDP: OBR baseline dashed, scenario solid with its low–high band. */
export function FanChart() {
  const { fan } = useScenario();
  const [tableOpen, setTableOpen] = useState(false);
  const { width: W, height: H, margin: m } = FAN;

  const geo = useMemo(() => {
    const all = [...fan.baseline, ...fan.low, ...fan.high].map((d) => d.pct_gdp);
    const y = scaleLinear()
      .domain([Math.floor(Math.min(...all)) - FAN.yPadding, Math.ceil(Math.max(...all)) + FAN.yPadding])
      .range([H - m.bottom, m.top])
      .nice(FAN.yTicks);
    const x = scalePoint<string>()
      .domain(fan.baseline.map((d) => d.period))
      .range([m.left, W - m.right]);
    const px = (d: DebtPoint) => x(d.period) ?? 0;
    const band = area<number>()
      .x((i) => px(fan.low[i]!))
      .y0((i) => y(fan.low[i]!.pct_gdp))
      .y1((i) => y(fan.high[i]!.pct_gdp));
    const path = line<DebtPoint>()
      .x(px)
      .y((d) => y(d.pct_gdp));
    return {
      y,
      x,
      band: band(fan.low.map((_, i) => i)) ?? "",
      baseline: path(fan.baseline) ?? "",
      central: path(fan.central) ?? "",
    };
  }, [fan, H, W, m]);

  const lastC = fan.central[fan.central.length - 1]!;
  const lastB = fan.baseline[fan.baseline.length - 1]!;
  const same = Math.abs(lastC.pct_gdp - lastB.pct_gdp) < 0.05;
  const above = lastC.pct_gdp > lastB.pct_gdp;
  const endX = geo.x(lastC.period) ?? 0;

  return (
    <div>
      <p className="mb-2 text-label text-muted">Public debt, % of GDP. Dashed: the OBR forecast. Solid: your scenario, with its low–high band.</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="fan block h-auto w-full" role="img" aria-label={`Debt reaches ${fixed(lastC.pct_gdp, 1)}% of GDP in ${lastC.period} under the scenario, against ${fixed(lastB.pct_gdp, 1)}% in the OBR forecast.`}>
        {geo.y.ticks(FAN.yTicks).map((t) => (
          <g key={t}>
            <line x1={m.left} x2={W - m.right} y1={geo.y(t)} y2={geo.y(t)} style={{ stroke: "var(--line)" }} />
            <text x={m.left - 8} y={geo.y(t) + 4} textAnchor="end">
              {t}%
            </text>
          </g>
        ))}
        {fan.baseline.map((d) => (
          <text key={d.period} x={geo.x(d.period)} y={H - 8} textAnchor="middle">
            {shortYear(d.period)}
          </text>
        ))}
        <path d={geo.band} style={{ fill: "var(--debt-soft)" }} />
        <path d={geo.baseline} style={{ fill: "none", stroke: "var(--muted)", strokeWidth: 1.5, strokeDasharray: "4 3" }} />
        <path d={geo.central} style={{ fill: "none", stroke: "var(--debt)", strokeWidth: 2.2, strokeLinejoin: "round" }} />
        <circle cx={endX} cy={geo.y(lastC.pct_gdp)} r={FAN.dotRadius} style={{ fill: "var(--debt)" }} />
        <text x={endX + 8} y={geo.y(lastC.pct_gdp) + (same ? 4 : above ? -2 : 10)} style={{ fill: "var(--debt)", fontWeight: 600, fontSize: 12 }}>
          {fixed(lastC.pct_gdp, 1)}%
        </text>
        {!same && (
          <text x={endX + 8} y={geo.y(lastB.pct_gdp) + (above ? 12 : -2)}>
            OBR {fixed(lastB.pct_gdp, 1)}%
          </text>
        )}
      </svg>
      <TextButton className="mt-2" aria-expanded={tableOpen} aria-controls="fan-table" onClick={() => setTableOpen(!tableOpen)}>
        {tableOpen ? "Hide table" : "Show as table"}
      </TextButton>
      {tableOpen && (
        <div id="fan-table" className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse whitespace-nowrap text-sm">
            <caption className="sr-only">Public debt as a percentage of GDP by year</caption>
            <thead>
              <tr className="border-b border-line text-left text-[12.5px] text-muted">
                <th className="py-2 pr-4 font-medium">Year</th>
                <th className="py-2 pr-4 text-right font-medium">OBR forecast</th>
                <th className="py-2 pr-4 text-right font-medium">Scenario</th>
                <th className="py-2 text-right font-medium">Range</th>
              </tr>
            </thead>
            <tbody>
              {fan.central.map((d, i) => (
                <tr key={d.period} className="border-b border-line">
                  <td className="py-2 pr-4">{d.period}</td>
                  <td className="py-2 pr-4 text-right">{fixed(fan.baseline[i]!.pct_gdp, 1)}%</td>
                  <td className="py-2 pr-4 text-right">{fixed(d.pct_gdp, 1)}%</td>
                  <td className="py-2 text-right text-muted">
                    {fixed(fan.low[i]!.pct_gdp, 1)}% to {fixed(fan.high[i]!.pct_gdp, 1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
