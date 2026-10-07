"use client";

import { useMemo } from "react";
import { scaleBand, scaleLinear } from "d3-scale";
import { t1Range, type T1Result } from "@ledger/schema";
import { fixed, MINUS } from "@/lib/format";
import { T1_COPY, gbpChange, pctChange } from "@/lib/t1-copy";
import { ChartTable } from "./ChartTable";

/** Layout constants (not data): viewBox and margins, as in FanChart. */
const DECILE = {
  width: 560,
  height: 250,
  margin: { left: 46, right: 6, top: 18, bottom: 30 },
  /** Room beyond the longest whisker for the value labels, as a share of the data span. */
  labelRoom: 0.16,
  yTicks: 4,
  barPadding: 0.3,
  capHalfWidth: 4,
  /** Space between a whisker's end and its value label. */
  labelGap: 4,
} as const;

type Deciles = T1Result["deciles"];

/** % change in household income by income decile: bars for PolicyEngine's estimate, whiskers for the ±10% range. */
export function DecileChart({ deciles }: { deciles: Deciles }) {
  const { width: W, height: H, margin: m } = DECILE;
  const rows = useMemo(() => deciles.map((d) => ({ ...d, range: t1Range(d.rel_change_pct) })), [deciles]);

  const geo = useMemo(() => {
    let lo = Math.min(0, ...rows.map((r) => r.range[0]));
    let hi = Math.max(0, ...rows.map((r) => r.range[2]));
    if (lo === 0 && hi === 0) {
      lo = -1;
      hi = 1;
    }
    const room = (hi - lo) * DECILE.labelRoom;
    if (lo < 0) lo -= room;
    if (hi > 0) hi += room;
    const y = scaleLinear().domain([lo, hi]).range([H - m.bottom, m.top]).nice(DECILE.yTicks);
    const x = scaleBand<number>()
      .domain(rows.map((r) => r.decile))
      .range([m.left, W - m.right])
      .padding(DECILE.barPadding);
    const ticks = y.ticks(DECILE.yTicks);
    const step = Math.abs((ticks[1] ?? 1) - (ticks[0] ?? 0));
    const dp = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    return { x, y, ticks, dp };
  }, [rows, H, W, m]);

  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const summary = `Change in household income by income decile, from ${pctChange(first.rel_change_pct)} in decile 1 (lowest incomes) to ${pctChange(last.rel_change_pct)} in decile 10 (highest).`;
  const tick = (t: number) => `${t < 0 ? MINUS : ""}${fixed(Math.abs(t), geo.dp)}%`;
  const y0 = geo.y(0);
  const bw = geo.x.bandwidth();

  return (
    <div className="min-w-0">
      <p className="mb-1 text-label font-medium text-ink">{T1_COPY.decilesTitle}</p>
      <p className="mb-2 text-caption text-muted">{T1_COPY.decilesNote}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="fan block h-auto w-full" role="img" aria-label={summary}>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={W - m.right} y1={geo.y(t)} y2={geo.y(t)} style={{ stroke: t === 0 ? "var(--faint)" : "var(--line)" }} />
            <text x={m.left - 8} y={geo.y(t) + 4} textAnchor="end">
              {tick(t)}
            </text>
          </g>
        ))}
        {rows.map((r) => {
          const x = geo.x(r.decile) ?? 0;
          const cx = x + bw / 2;
          const yc = geo.y(r.rel_change_pct);
          const loss = r.rel_change_pct < 0;
          const yLo = geo.y(r.range[0]);
          const yHi = geo.y(r.range[2]);
          const c = DECILE.capHalfWidth;
          return (
            <g key={r.decile}>
              <rect
                x={x}
                width={bw}
                y={Math.min(y0, yc)}
                height={Math.max(Math.abs(yc - y0), 0.5)}
                rx={2}
                style={{ fill: loss ? "var(--debt)" : "var(--good)" }}
              />
              <g style={{ stroke: "var(--ink)", strokeOpacity: 0.55, strokeWidth: 1.25 }}>
                <line x1={cx} x2={cx} y1={yLo} y2={yHi} />
                <line x1={cx - c} x2={cx + c} y1={yLo} y2={yLo} />
                <line x1={cx - c} x2={cx + c} y1={yHi} y2={yHi} />
              </g>
              {/* Phones draw chart text larger (.fan text); the % sign is dropped there so neighbouring labels do not touch. */}
              <text
                x={cx}
                y={loss ? yLo + DECILE.labelGap : yHi - DECILE.labelGap}
                dominantBaseline={loss ? "hanging" : "auto"}
                textAnchor="middle"
                style={{ fill: "var(--ink)", fontWeight: 500 }}
              >
                <tspan className="max-sm:hidden">{pctChange(r.rel_change_pct)}</tspan>
                <tspan className="sm:hidden">{pctChange(r.rel_change_pct).replace("%", "")}</tspan>
              </text>
              <text x={cx} y={H - 8} textAnchor="middle">
                {r.decile}
              </text>
            </g>
          );
        })}
      </svg>
      <ChartTable id="t1-deciles-table" chartId="t1_deciles" label={T1_COPY.decilesTitle}>
        <table className="w-full border-collapse whitespace-nowrap text-sm">
          <caption className="sr-only">{T1_COPY.decilesTitle}</caption>
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] text-muted">
              <th scope="col" className="py-2 pr-4 font-medium">
                Income decile
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Change
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Range
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                £ a year
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.decile} className="border-b border-line">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {r.decile === 1 ? "1 (lowest)" : r.decile === 10 ? "10 (highest)" : r.decile}
                </th>
                <td className="py-2 pr-4 text-right">{pctChange(r.rel_change_pct)}</td>
                <td className="py-2 pr-4 text-right text-muted">
                  {pctChange(r.range[0])} to {pctChange(r.range[2])}
                </td>
                <td className="py-2 text-right">{gbpChange(r.avg_change_gbp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartTable>
    </div>
  );
}
