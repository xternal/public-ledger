"use client";

import { useId, useMemo, useState } from "react";
import { sankey, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from "d3-sankey";
import type { StatementLine } from "@ledger/schema";
import { DEBT_INTEREST_LINE } from "@ledger/engine";
import { useScenario } from "@/lib/scenario";
import { SANKEY, LABEL_DELTA_MIN_BN } from "@/lib/chart-config";
import { deltaInUnit, gbpBn, inUnit, type UnitContext } from "@/lib/format";
import { track } from "@/lib/analytics";
import { ProvenanceDetail, QualityDot, qualityKey } from "./ui";

export const BORROWING_ID = "borrowing";
const PURSE_ID = "purse";

export interface FlowLine {
  id: string;
  label: string;
  side: "income" | "spending";
  /** Scenario value, £bn. */
  v: number;
  /** Published value, £bn. */
  base: number;
  debt: boolean;
  line?: StatementLine;
}

/**
 * Lines for the Sankey, the mobile bar lists and the table: largest first,
 * balancing figures last, borrowing after income.
 */
export function useFlowLines() {
  const { seed, result } = useScenario();
  return useMemo(() => {
    const rank = (a: FlowLine, b: FlowLine) => Number(!!a.line?.plug) - Number(!!b.line?.plug) || b.v - a.v;
    const income: FlowLine[] = seed.statement.receipts
      .map((l) => ({ id: l.id, label: l.label, side: "income" as const, v: result.receipts[l.id] ?? 0, base: l.bn, debt: false, line: l }))
      .sort(rank);
    income.push({
      id: BORROWING_ID,
      label: "Borrowing",
      side: "income",
      v: Math.max(result.totals.borrowing_bn, 0),
      base: seed.statement.borrowing_bn,
      debt: true,
    });
    const spending: FlowLine[] = seed.statement.spending
      .map((l) => ({
        id: l.id,
        label: l.label,
        side: "spending" as const,
        v: Math.max(result.spending[l.id] ?? 0, 0),
        base: l.bn,
        debt: l.id === DEBT_INTEREST_LINE,
        line: l,
      }))
      .sort(rank);
    return { income, spending, total: result.totals.spending_bn };
  }, [seed, result]);
}

/** Is a change to this line bad for the public purse? Only more borrowing or more spending counts. */
export const isWorse = (f: FlowLine, delta: number) => (f.side === "income" ? f.id === BORROWING_ID && delta > 0 : delta > 0);

type N = FlowLine & { kind: "line" | "purse" };
type L = { debt: boolean; inbound: boolean };

export function Sankey({ active, onActive }: { active: string | null; onActive: (id: string | null) => void }) {
  const { unit, seed } = useScenario();
  const { income, spending, total } = useFlowLines();
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ctx: UnitContext = { households_m: seed.statement.macro.households_m, total_bn: total };

  const graph = useMemo(() => {
    const purse: N = { id: PURSE_ID, label: "Public purse", side: "income", v: total, base: total, debt: false, kind: "purse" };
    const left = income.map((f): N => ({ ...f, kind: "line" }));
    const right = spending.map((f): N => ({ ...f, kind: "line" }));
    const links = [
      ...left.filter((n) => n.v > 0).map((n) => ({ source: n.id, target: PURSE_ID, value: n.v, debt: n.debt, inbound: true })),
      ...right.filter((n) => n.v > 0).map((n) => ({ source: PURSE_ID, target: n.id, value: n.v, debt: n.debt, inbound: false })),
    ];
    const layout = sankey<N, L>()
      .nodeId((d) => d.id)
      .nodeWidth(SANKEY.nodeWidth)
      .nodePadding(SANKEY.nodePadding)
      .nodeSort(null as never)
      .extent([
        [SANKEY.labelGutterLeft, SANKEY.top],
        [SANKEY.width - SANKEY.labelGutterRight, SANKEY.height - SANKEY.bottom],
      ]);
    return layout({ nodes: [...left, purse, ...right].map((d) => ({ ...d })), links: links.map((d) => ({ ...d })) });
  }, [income, spending, total]);

  const linkPath = sankeyLinkHorizontal<N, L>();
  const touches = (l: SankeyLink<N, L>) => {
    const s = l.source as SankeyNode<N, L>;
    const t = l.target as SankeyNode<N, L>;
    return s.id === active || t.id === active;
  };
  const purse = graph.nodes.find((n) => n.id === PURSE_ID)!;

  return (
    <svg
      viewBox={`0 0 ${SANKEY.width} ${SANKEY.height}`}
      className="sankey block h-auto w-full min-w-[760px]"
      role="img"
      aria-label={`Sankey chart: ${gbpBn(total)} of public spending, funded by taxes, other income and borrowing. A table version follows.`}
      onMouseLeave={() => onActive(null)}
    >
      <defs>
        <pattern id={hatchId} width={SANKEY.hatchSize} height={SANKEY.hatchSize} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={SANKEY.hatchSize} height={SANKEY.hatchSize} style={{ fill: "var(--debt-soft)" }} />
          <line x1={0} y1={0} x2={0} y2={SANKEY.hatchSize} style={{ stroke: "var(--debt)", strokeWidth: 2.2 }} />
        </pattern>
      </defs>
      <g fill="none">
        {graph.links.map((l, i) => {
          const stroke = l.debt
            ? l.inbound
              ? `url(#${hatchId})`
              : "var(--debt-soft)"
            : l.inbound
              ? "var(--rec-soft)"
              : "var(--spend-soft)";
          return (
            <path
              key={i}
              className="flow"
              d={linkPath(l) ?? undefined}
              style={{ stroke, strokeWidth: Math.max(SANKEY.minLinkWidth, l.width ?? 0), opacity: active && !touches(l) ? SANKEY.dimOpacity : 1 }}
            />
          );
        })}
      </g>
      {graph.nodes.map((n) => {
        const x0 = n.x0 ?? 0;
        const x1 = n.x1 ?? 0;
        const y0 = n.y0 ?? 0;
        const y1 = n.y1 ?? 0;
        const fill = n.kind === "purse" ? "var(--ink)" : n.debt ? "var(--debt)" : n.side === "income" ? "var(--rec)" : "var(--spend)";
        if (n.kind === "purse") return <rect key={n.id} x={x0} y={y0} width={x1 - x0} height={Math.max(1, y1 - y0)} style={{ fill }} />;
        const left = n.side === "income";
        const x = left ? x0 - SANKEY.labelOffset : x1 + SANKEY.labelOffset;
        const y = (y0 + y1) / 2;
        const compact = y1 - y0 < SANKEY.compactNodeHeight;
        const delta = n.v - n.base;
        const showDelta = Math.abs(delta) > LABEL_DELTA_MIN_BN;
        const valueText = (
          <>
            {inUnit(n.v, unit, ctx)}
            {showDelta && <tspan className={isWorse(n, delta) ? "up" : "down"}>{`  ${deltaInUnit(delta, unit, ctx)}`}</tspan>}
          </>
        );
        const dim = active && active !== n.id ? SANKEY.dimOpacity + 0.3 : 1;
        return (
          <g
            key={n.id}
            className="node"
            tabIndex={0}
            role="button"
            aria-label={`${n.label}: ${inUnit(n.v, unit, ctx)}${showDelta ? `, change ${deltaInUnit(delta, unit, ctx)}` : ""}`}
            onMouseEnter={() => onActive(n.id)}
            onFocus={() => {
              onActive(n.id);
              track("statement_line_inspected", { line_id: n.id });
            }}
            onBlur={() => onActive(null)}
            style={{ opacity: dim }}
          >
            <rect x={x0} y={y0} width={x1 - x0} height={Math.max(1, y1 - y0)} style={{ fill }} />
            <rect x={left ? 0 : x1} y={y0 - 2} width={left ? x1 : SANKEY.width - x1} height={Math.max(1, y1 - y0) + 4} fill="transparent" />
            {compact ? (
              <text x={x} y={y + 4} textAnchor={left ? "end" : "start"} className="lbl">
                {n.label}
                <tspan className="val">{"  "}</tspan>
                <tspan className="val">{valueText}</tspan>
              </text>
            ) : (
              <>
                <text x={x} y={y - 2} textAnchor={left ? "end" : "start"} className="lbl">
                  {n.label}
                </text>
                <text x={x} y={y + 16} textAnchor={left ? "end" : "start"} className="val">
                  {valueText}
                </text>
              </>
            )}
          </g>
        );
      })}
      <text x={((purse.x0 ?? 0) + (purse.x1 ?? 0)) / 2} y={(purse.y0 ?? 0) - 12} textAnchor="middle" style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.015em" }}>
        {inUnit(total, unit, ctx)}
      </text>
    </svg>
  );
}

/** Mobile: two ranked bar lists with the total between them (DESIGN_HANDOFF). */
export function FlowList() {
  const { unit, seed } = useScenario();
  const { income, spending, total } = useFlowLines();
  const ctx: UnitContext = { households_m: seed.statement.macro.households_m, total_bn: total };
  const max = Math.max(...income.map((f) => f.v), ...spending.map((f) => f.v));
  const row = (f: FlowLine) => {
    const delta = f.v - f.base;
    return (
      <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-2">
          {f.label}
          {f.line && <QualityDot quality={qualityKey(f.line)} />}
        </span>
        <span className="text-right font-medium">
          {inUnit(f.v, unit, ctx)}
          {Math.abs(delta) > LABEL_DELTA_MIN_BN && (
            <small className={`ml-1.5 text-caption ${isWorse(f, delta) ? "text-bad" : "text-good"}`}>{deltaInUnit(delta, unit, ctx)}</small>
          )}
        </span>
        <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-sunk">
          <i
            className={`block h-full rounded-full ${f.debt ? "hatch" : f.side === "income" ? "bg-rec" : "bg-spend"}`}
            style={{ width: `${(f.v / max) * 100}%` }}
          />
        </span>
      </li>
    );
  };
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h3 className="text-label font-medium text-muted">Where it came from</h3>
        <ul className="m-0 grid list-none gap-3 p-0">{income.map(row)}</ul>
      </div>
      <div className="flex justify-between border-y border-line py-2.5 font-semibold">
        <span>Total spending</span>
        <span>{inUnit(total, unit, ctx)}</span>
      </div>
      <div className="grid gap-2">
        <h3 className="text-label font-medium text-muted">Where it went</h3>
        <ul className="m-0 grid list-none gap-3 p-0">{spending.map(row)}</ul>
      </div>
    </div>
  );
}

/** One line under the chart: what the hovered or focused line is and where its number comes from. */
export function LineInspector({ active }: { active: string | null }) {
  const { seed, unit } = useScenario();
  const { income, spending, total } = useFlowLines();
  const ctx: UnitContext = { households_m: seed.statement.macro.households_m, total_bn: total };
  const f = [...income, ...spending].find((x) => x.id === active);
  return (
    <div className="min-h-[60px] rounded-control bg-sunk px-4 py-3 text-label text-muted" aria-live="polite">
      {f ? (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-semibold text-ink">
            {f.label}{" "}
            <span className="ml-1 font-medium">{inUnit(f.v, unit, ctx)}</span>
          </span>
          {f.line?.desc && <span>{f.line.desc}</span>}
          <span className="basis-full">
            <ProvenanceDetail p={f.line ?? seed.statement.borrowing_provenance} />
          </span>
        </div>
      ) : (
        <span>Hover or tab to any line to see what it covers and where the number comes from.</span>
      )}
    </div>
  );
}
