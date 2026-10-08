"use client";

import { useMemo } from "react";
import { scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";
import type { Range } from "@ledger/schema";
import { FAN } from "@/lib/chart-config";

/**
 * A projection drawn as a fan, in the visual language of FanChart (the debt fan on the
 * home page): a soft band for the range, a solid line for the official central path
 * (here the ONS principal projection or the OBR baseline) and a dashed line for the
 * variant the reader picked. Past values, when given, lead into the projection.
 * Unlike FanChart it is not tied to the sandbox: it takes its series as props.
 */

export type FanTone = "rec" | "spend";

export interface FanLine {
  id: string;
  label: string;
  tone: FanTone;
  /** x positions (years) of the projection, with one range and one principal value each. */
  years: number[];
  range: Range[];
  principal: number[];
  /** The reader's pick, when it is not the principal projection. */
  selected?: { label: string; values: number[] } | null;
  past?: { years: number[]; values: number[] };
}

const STROKE: Record<FanTone, string> = { rec: "var(--rec)", spend: "var(--spend)" };
const FILL: Record<FanTone, string> = { rec: "var(--rec-soft)", spend: "var(--spend-soft)" };
// Room between end labels, in chart units: enough for the 16px labels phones get (globals.css, .fan text).
const LABEL_GAP = 17;
// Room between x-axis labels, in chart units: a five-character label at the phone size.
const MIN_TICK_GAP = 52;

export function VariantFan({
  lines,
  format,
  tickFormat = format,
  xTicks,
  xTickFormat = String,
  ariaLabel,
  marginLeft = FAN.margin.left,
}: {
  lines: FanLine[];
  /** Value labels at the line ends. */
  format: (x: number) => string;
  /** Y axis labels; defaults to `format`. */
  tickFormat?: (x: number) => string;
  /** Fixed x ticks (e.g. the years a table is published for); otherwise every decade or so. */
  xTicks?: number[];
  xTickFormat?: (x: number) => string;
  ariaLabel: string;
  marginLeft?: number;
}) {
  const { width: W, height: H } = FAN;
  const m = { ...FAN.margin, left: marginLeft };

  const geo = useMemo(() => {
    const xs = lines.flatMap((l) => [...l.years, ...(l.past?.years ?? [])]);
    const ys = lines.flatMap((l) => [...l.range.flatMap((r) => [r[0], r[2]]), ...(l.past?.values ?? []), ...(l.selected?.values ?? [])]);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const pad = (hi - lo) * 0.06 || 1;
    const y = scaleLinear().domain([lo - pad, hi + pad]).range([H - m.bottom, m.top]).nice(FAN.yTicks);
    const x = scaleLinear().domain([Math.min(...xs), Math.max(...xs)]).range([m.left, W - m.right]);
    const pts = (years: number[], values: number[]) => years.map((yr, i) => [yr, values[i]!] as [number, number]);
    const path = line<[number, number]>().x((d) => x(d[0])).y((d) => y(d[1]));
    const drawn = lines.map((l) => {
      // Join the projection to the last past value, so estimate and projection read as one line.
      const lead = l.past?.years.length ? ([[l.past.years.at(-1)!, l.past.values.at(-1)!]] as [number, number][]) : [];
      const bandPts = [...lead.map(([yr, v]) => [yr, v, v] as const), ...l.years.map((yr, i) => [yr, l.range[i]![0], l.range[i]![2]] as const)];
      const band = area<readonly [number, number, number]>().x((d) => x(d[0])).y0((d) => y(d[1])).y1((d) => y(d[2]))(bandPts) ?? "";
      return {
        line: l,
        band,
        past: l.past?.years.length ? path(pts(l.past.years, l.past.values)) ?? "" : "",
        principal: path([...lead, ...pts(l.years, l.principal)]) ?? "",
        selected: l.selected ? path([...lead, ...pts(l.years, l.selected.values)]) ?? "" : "",
        projectionStart: l.past?.years.length ? x(l.past.years.at(-1)!) : null,
      };
    });
    // Fixed ticks can crowd (the OBR's 2025-26 and 2030-31): label a tick only if it clears the last label drawn.
    const ticks: number[] = [];
    for (const t of xTicks ?? x.ticks(6).filter((t) => Number.isInteger(t))) {
      if (ticks.length === 0 || x(t) - x(ticks.at(-1)!) >= MIN_TICK_GAP) ticks.push(t);
    }
    return { x, y, drawn, ticks };
  }, [lines, xTicks, H, W, m.bottom, m.top, m.left, m.right]);

  // End labels: one per drawn line, nudged apart so they never overlap.
  const labels = useMemo(() => {
    const out: { key: string; y: number; text: string; tone: FanTone; strong: boolean }[] = [];
    for (const { line: l } of geo.drawn) {
      const lastX = l.years.length - 1;
      out.push({ key: `${l.id}-p`, y: geo.y(l.principal[lastX]!), text: format(l.principal[lastX]!), tone: l.tone, strong: true });
      if (l.selected) out.push({ key: `${l.id}-s`, y: geo.y(l.selected.values[lastX]!), text: format(l.selected.values[lastX]!), tone: l.tone, strong: false });
    }
    out.sort((a, b) => a.y - b.y);
    for (let i = 1; i < out.length; i++) if (out[i]!.y - out[i - 1]!.y < LABEL_GAP) out[i]!.y = out[i - 1]!.y + LABEL_GAP;
    return out;
  }, [geo, format]);

  const endX = W - m.right;
  const boundary = geo.drawn.find((d) => d.projectionStart !== null)?.projectionStart ?? null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="fan block h-auto w-full" role="img" aria-label={ariaLabel}>
      {geo.y.ticks(FAN.yTicks).map((t) => (
        <g key={t}>
          <line x1={m.left} x2={W - m.right} y1={geo.y(t)} y2={geo.y(t)} style={{ stroke: "var(--line)" }} />
          <text x={m.left - 8} y={geo.y(t) + 4} textAnchor="end">
            {tickFormat(t)}
          </text>
        </g>
      ))}
      {geo.ticks.map((t) => (
        <text key={t} x={geo.x(t)} y={H - 8} textAnchor="middle">
          {xTickFormat(t)}
        </text>
      ))}
      {boundary !== null && <line x1={boundary} x2={boundary} y1={m.top} y2={H - m.bottom} style={{ stroke: "var(--line-strong)", strokeDasharray: "2 3" }} />}
      {geo.drawn.map((d) => (
        <g key={d.line.id}>
          <path d={d.band} style={{ fill: FILL[d.line.tone] }} />
          {d.past && <path d={d.past} style={{ fill: "none", stroke: STROKE[d.line.tone], strokeWidth: 1.6, strokeLinejoin: "round" }} />}
          <path d={d.principal} style={{ fill: "none", stroke: STROKE[d.line.tone], strokeWidth: 2.2, strokeLinejoin: "round" }} />
          {d.selected && <path d={d.selected} style={{ fill: "none", stroke: STROKE[d.line.tone], strokeWidth: 2, strokeDasharray: "5 3", strokeLinejoin: "round" }} />}
          <circle cx={endX} cy={geo.y(d.line.principal.at(-1)!)} r={FAN.dotRadius} style={{ fill: STROKE[d.line.tone] }} />
        </g>
      ))}
      {labels.map((l) => (
        <text key={l.key} x={endX + 7} y={l.y + 4} style={{ fill: l.strong ? STROKE[l.tone] : "var(--muted)", fontWeight: l.strong ? 600 : 400 }}>
          {l.text}
        </text>
      ))}
    </svg>
  );
}

export type KeyItem = { kind: "line" | "dash" | "band"; tone: FanTone; label: string };

/** The key under a fan: what each solid line, dashed line and band means. */
export function FanKey({ items }: { items: KeyItem[] }) {
  return (
    <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption text-muted">
      {items.map((it) => (
        <li key={`${it.kind}-${it.tone}-${it.label}`} className="flex items-center gap-1.5">
          {it.kind === "band" ? (
            <i aria-hidden className="inline-block h-2.5 w-5 shrink-0 rounded-sm" style={{ background: FILL[it.tone] }} />
          ) : (
            <svg width="22" height="8" aria-hidden className="shrink-0">
              <line x1="1" x2="21" y1="4" y2="4" style={{ stroke: STROKE[it.tone], strokeWidth: 2.2, strokeDasharray: it.kind === "dash" ? "5 3" : undefined }} />
            </svg>
          )}
          {it.label}
        </li>
      ))}
    </ul>
  );
}
