"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Quality, Range, T1Result } from "@ledger/schema";
import { REGIONS, t0t1Disagree, t1Range } from "@ledger/schema";
import type { Change } from "@ledger/engine";
import { direction, fixed, longDate, rangeText, signed, signedBn } from "@/lib/format";
import { useScenario } from "@/lib/scenario";
import { INDIRECT_TAX_LEVERS, isT1Lever, useT1, type T1Phase } from "@/lib/t1";
import {
  INEQUALITY_LABEL,
  POVERTY_LABEL,
  T1_COPY,
  T1_FAIL_COPY,
  disagreeText,
  gbpChange,
  pctChange,
  ppChange,
  provenanceText,
} from "@/lib/t1-copy";
import { DecileChart } from "./DecileChart";
import { WinnersBar } from "./WinnersBar";
import { ChartTable } from "./ChartTable";
import { QualityBadge, RangeStrip, WithProvenance } from "./ui";

const RANGE_HEADROOM = 1.15;
/** "About a minute": the progress bar fills over this long, then waits near the end. */
const EXPECTED_MS = 75_000;
const PROGRESS_CAP = 0.92;
const TICK_MS = 1_000;
/** Lowest quality first, so a tile shows the weakest label among the levers behind it. */
const QUALITY_RANK: Quality[] = ["training", "approx", "modelled", "sourced"];

/** Sum of the T0 borrowing ranges of the changes T1 also models, so both sides cover the same levers. */
function t0ForT1(changes: readonly Change[]): Range {
  return changes
    .filter((c) => c.kind === "lever" && isT1Lever(c.lever_id))
    .reduce<Range>((a, c) => [a[0] + c.d_borrowing_bn[0], a[1] + c.d_borrowing_bn[1], a[2] + c.d_borrowing_bn[2]], [0, 0, 0]);
}

/** The status line readers and screen readers get for each phase (announced politely). */
function statusText(phase: T1Phase): string {
  switch (phase.kind) {
    case "pending":
      return phase.restarted ? T1_COPY.restarted : T1_COPY.pending;
    case "error":
      return T1_FAIL_COPY[phase.reason];
    case "not_applicable":
      return T1_COPY.notApplicable;
    case "ready":
      return "PolicyEngine's results are below.";
    case "idle":
      return "";
  }
}

/**
 * "Who gains and loses": T1 (PolicyEngine microsimulation) under the scenario
 * result. Shown only when the scenario moves a lever T1 models; starts only
 * when the reader asks.
 */
export function WhoGains() {
  const t1 = useT1();
  const { model } = useScenario();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusInside = useRef(false);
  const phaseKind = t1?.phase.kind;

  // A button that held focus can disappear when the phase changes; hand focus to the heading so keyboard users keep their place.
  useEffect(() => {
    if (!focusInside.current) return;
    if (!document.activeElement || document.activeElement === document.body) headingRef.current?.focus({ preventScroll: true });
  }, [phaseKind]);

  if (!t1 || !t1.applicable) return null;
  const { phase, start, cancel, notModelled } = t1;
  const labelOf = (id: string) => model.leverById.get(id)?.label.split(",")[0] ?? id;
  const notInModel = notModelled.length > 0 && (
    <p className="m-0 text-[12.5px] leading-relaxed text-muted">
      {T1_COPY.notInModel} {notModelled.map(labelOf).join(", ")}.
    </p>
  );
  const status = statusText(phase);
  const statusVisible = phase.kind === "pending" || phase.kind === "error" || phase.kind === "not_applicable";

  return (
    <section id="who-gains" aria-labelledby="who-gains-h" className="grid scroll-mt-20 gap-6 border-t border-line pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[66ch]">
          <div className="text-label text-muted">{T1_COPY.kicker}</div>
          <h3 id="who-gains-h" ref={headingRef} tabIndex={-1} className="mt-1 text-title font-semibold">
            {T1_COPY.heading}
          </h3>
          <p className="mt-1.5 text-muted">{T1_COPY.intro}</p>
        </div>
      </div>

      <div
        ref={bodyRef}
        className="grid gap-6"
        onFocus={() => (focusInside.current = true)}
        onBlur={(e) => (focusInside.current = !!bodyRef.current?.contains(e.relatedTarget as Node | null))}
      >
        <p role="status" aria-live="polite" className={statusVisible ? "m-0 max-w-[66ch] text-body" : "sr-only"}>
          {status}
        </p>

        {phase.kind === "idle" && (
          <div className="grid justify-items-start gap-2">
            <button
              type="button"
              onClick={start}
              className="cursor-pointer rounded-full bg-ink px-4 py-2 text-label font-semibold text-bg hover:opacity-90"
            >
              {T1_COPY.start}
            </button>
            <p className="m-0 text-caption text-muted">{T1_COPY.startNote}</p>
            {notInModel}
          </div>
        )}

        {phase.kind === "pending" && <Pending startedAt={phase.startedAt} onCancel={cancel} />}

        {(phase.kind === "error" || phase.kind === "not_applicable") && (
          <div className="grid justify-items-start gap-2">
            {phase.kind === "error" && (
              <button
                type="button"
                onClick={start}
                className="cursor-pointer rounded-full border border-line-strong px-4 py-2 text-label font-medium text-ink hover:border-ink"
              >
                {T1_COPY.retry}
              </button>
            )}
            {notInModel}
          </div>
        )}

        {phase.kind === "ready" && <Results result={phase.result} notInModel={notInModel} />}
      </div>
    </section>
  );
}

function Pending({ startedAt, onCancel }: { startedAt: number; onCancel: () => void }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, now - startedAt);
  const progress = Math.min(elapsed / EXPECTED_MS, PROGRESS_CAP);
  const s = Math.floor(elapsed / TICK_MS);
  return (
    <div className="grid gap-8">
      <div className="grid max-w-[480px] gap-2">
        <div className="h-1 overflow-hidden rounded-full bg-sunk" aria-hidden>
          <i className="block h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="flex items-center justify-between gap-3 text-caption text-muted">
          <span aria-hidden>
            {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
          </span>
          <button type="button" onClick={onCancel} className="cursor-pointer text-label font-medium text-muted underline underline-offset-2 hover:text-ink">
            {T1_COPY.cancel}
          </button>
        </div>
      </div>
      <Skeleton />
    </div>
  );
}

/** Placeholder blocks the size of the results (measured at desktop and phone widths), so nothing jumps when they arrive. */
function Skeleton() {
  const block = "rounded-control bg-sunk";
  return (
    <div className="grid gap-10" aria-hidden>
      <div className="grid gap-3">
        <div className={`${block} h-4 w-56`} />
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className={`${block} h-[166px]`} />
          <div className={`${block} h-[166px]`} />
          <div className={`${block} col-span-2 h-[148px] md:col-span-1 md:h-[166px]`} />
        </div>
      </div>
      <div className="grid gap-10 lg:grid-cols-2">
        <div className={`${block} h-[250px] sm:h-auto sm:aspect-[560/340] lg:aspect-auto lg:h-[460px]`} />
        <div className={`${block} h-[520px] sm:h-[480px] lg:h-[460px]`} />
      </div>
      <div className="grid gap-10 md:grid-cols-2">
        <div className={`${block} h-[440px] md:h-[415px]`} />
        <div className={`${block} h-[340px] md:h-[300px]`} />
      </div>
      <div className={`${block} h-16`} />
    </div>
  );
}

function Results({ result, notInModel }: { result: T1Result; notInModel: React.ReactNode }) {
  return (
    <div className="grid gap-10 transition-opacity duration-300 starting:opacity-0">
      <RevenueCompare result={result} notInModel={notInModel} />
      {/* The SVG chart needs the full width until large screens, or its text gets too small. */}
      <div className="grid items-start gap-10 lg:grid-cols-2">
        <DecileChart deciles={result.deciles} />
        <WinnersBar winners={result.winners} />
      </div>
      <div className="grid items-start gap-10 md:grid-cols-2">
        <RegionList regions={result.regions} />
        <PovertyLines result={result} />
      </div>
      <ProvenanceFooter result={result} />
    </div>
  );
}

function ModelTile({
  label,
  range,
  scale,
  note,
  badge,
}: {
  label: string;
  range: Range;
  scale: number;
  note: string;
  badge: React.ReactNode;
}) {
  const tone = direction(range[1]);
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <div className="text-label text-muted">{label}</div>
      <div
        className={`whitespace-nowrap text-[26px] font-semibold leading-[1.15] tracking-[var(--tracking-figure)] ${tone === "up" ? "text-bad" : tone === "down" ? "text-good" : ""}`}
      >
        {signedBn(range[1])}
      </div>
      <RangeStrip range={range} scale={scale} tone={tone} />
      <div className="text-[12.5px] text-muted">range {rangeText(range, signedBn)}</div>
      <div className="text-[12.5px] leading-snug text-muted">{note}</div>
      <div className="flex">{badge}</div>
    </div>
  );
}

function RevenueCompare({ result, notInModel }: { result: T1Result; notInModel: React.ReactNode }) {
  const { result: t0Result, model, seed } = useScenario();
  const t0 = useMemo(() => t0ForT1(t0Result.changes), [t0Result.changes]);
  // T1 reports the change in the government's balance; the page talks about borrowing, which moves the other way.
  const t1 = t1Range(-result.budget.net_bn);
  const scale = Math.max(...t0.map(Math.abs), ...t1.map(Math.abs)) * RANGE_HEADROOM;
  const differ = t0t1Disagree(t0, t1[1]);

  // T0's figures come from the levers' own costings; show the weakest quality label among them.
  const weakest = t0Result.changes
    .filter((c) => c.kind === "lever" && isT1Lever(c.lever_id))
    .map((c) => model.leverById.get(c.lever_id)!)
    .sort((a, b) => QUALITY_RANK.indexOf(a.quality) - QUALITY_RANK.indexOf(b.quality))[0];

  return (
    <div>
      <p className="mb-3 text-label text-muted">{T1_COPY.revenueTitle}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <ModelTile
          label={T1_COPY.t0Label}
          range={t0}
          scale={scale}
          note={T1_COPY.t0Note}
          badge={
            weakest && (
              <WithProvenance p={{ quality: weakest.quality, source_id: weakest.source_id, method_note: weakest.method_note }}>
                <QualityBadge quality={weakest.quality} />
              </WithProvenance>
            )
          }
        />
        <ModelTile
          label={T1_COPY.t1Label}
          range={t1}
          scale={scale}
          note={T1_COPY.t1Note}
          badge={
            // Right-hand column on phones: the tip opens leftwards so it stays on screen.
            <WithProvenance p={{ quality: "modelled", method_note: provenanceText(result.provenance) }} align="end" className="w-full">
              <QualityBadge quality="modelled" />
            </WithProvenance>
          }
        />
        <div className="col-span-2 grid content-start gap-2 text-sm leading-relaxed md:col-span-1">
          <p className="m-0">{differ ? disagreeText(result.provenance, result.year, seed.baseYear) : T1_COPY.agree}</p>
          {notInModel && (
            <>
              <p className="m-0 text-[12.5px] text-muted">{T1_COPY.coversOnly}</p>
              {notInModel}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RegionList({ regions }: { regions: T1Result["regions"] }) {
  const rows = useMemo(
    () => [...regions].sort((a, b) => b.avg_change_gbp - a.avg_change_gbp).map((r) => ({ ...r, range: t1Range(r.avg_change_gbp) })),
    [regions],
  );
  if (!rows.length) return null;
  const missing = REGIONS.filter((r) => !regions.some((x) => x.id === r.id)).map((r) => r.name);
  const max = Math.max(...rows.map((r) => Math.max(Math.abs(r.range[0]), Math.abs(r.range[2]))), 1);
  const pos = (x: number) => `${(Math.abs(x) / max) * 100}%`;

  return (
    <div className="min-w-0">
      <p className="mb-1 text-label font-medium text-ink">{T1_COPY.regionsTitle}</p>
      <p className="mb-3 text-caption text-muted">{T1_COPY.regionsNote}</p>
      <ul className="m-0 grid list-none gap-2.5 p-0">
        {rows.map((r) => {
          const loss = r.avg_change_gbp < 0;
          const [a, b] = [Math.abs(r.range[0]), Math.abs(r.range[2])].sort((x, y) => x - y) as [number, number];
          return (
            <li key={r.id} className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-[13px] sm:text-sm">
              <span className="leading-tight">{r.name}</span>
              <span className="relative h-2" aria-hidden>
                <span className="absolute inset-0 rounded-full bg-sunk" />
                <i
                  className="absolute inset-y-0 left-0 block rounded-full"
                  style={{ width: pos(r.avg_change_gbp), background: loss ? "var(--debt)" : "var(--good)" }}
                />
                <i className="absolute top-1/2 block h-px -translate-y-1/2 bg-ink/55" style={{ left: pos(a), width: `calc(${pos(b)} - ${pos(a)})` }} />
              </span>
              <span className="text-right font-medium">{gbpChange(r.avg_change_gbp)}</span>
            </li>
          );
        })}
      </ul>
      {missing.map((name) => (
        <p key={name} className="mb-0 mt-3 text-[12.5px] text-muted">
          {T1_COPY.regionMissing(name)}
        </p>
      ))}
      <ChartTable id="t1-regions-table" chartId="t1_regions" label={T1_COPY.regionsTitle}>
        <table className="w-full border-collapse whitespace-nowrap text-sm">
          <caption className="sr-only">{T1_COPY.regionsTitle}</caption>
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] text-muted">
              <th scope="col" className="py-2 pr-4 font-medium">
                Region
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                £ a year
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Range
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {r.name}
                </th>
                <td className="py-2 pr-4 text-right">{gbpChange(r.avg_change_gbp)}</td>
                <td className="py-2 pr-4 text-right text-muted">
                  {gbpChange(r.range[0])} to {gbpChange(r.range[2])}
                </td>
                <td className="py-2 text-right">{pctChange(r.rel_change_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartTable>
    </div>
  );
}

const pct1 = (x: number) => `${fixed(x * 100, 1)}%`;
const gini = (x: number) => fixed(x, 3);
const GINI_NOISE = 0.0005;
const giniChange = (before: number, after: number) =>
  Math.abs(after - before) < GINI_NOISE ? "no change" : signed(after - before, (a) => fixed(a, 3));

function PovertyLines({ result }: { result: T1Result }) {
  const { poverty, inequality } = result;
  const indirect = result.modelled.some((id) => INDIRECT_TAX_LEVERS.has(id));
  const povertyStill = (Object.keys(POVERTY_LABEL) as (keyof typeof POVERTY_LABEL)[]).every(
    (k) => ppChange(poverty[k].baseline, poverty[k].reform) === "no change",
  );
  const row = (key: string, label: string, before: string, after: string, change: string) => (
    <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-b border-line py-2">
      <dt>{label}</dt>
      <dd className="m-0 text-right">
        <span className="font-medium">
          {before} → {after}
        </span>
        <span className="ml-2 inline-block min-w-[4.5rem] text-[12.5px] text-muted">{change}</span>
      </dd>
    </div>
  );
  return (
    <div className="min-w-0">
      <p className="mb-1 text-label font-medium text-ink">{T1_COPY.povertyTitle}</p>
      <p className="mb-2 text-caption text-muted">{T1_COPY.povertyNote}</p>
      <dl className="m-0 text-sm">
        {(Object.keys(POVERTY_LABEL) as (keyof typeof POVERTY_LABEL)[]).map((k) =>
          row(k, POVERTY_LABEL[k], pct1(poverty[k].baseline), pct1(poverty[k].reform), ppChange(poverty[k].baseline, poverty[k].reform)),
        )}
        {row(
          "gini",
          INEQUALITY_LABEL.gini,
          gini(inequality.gini.baseline),
          gini(inequality.gini.reform),
          giniChange(inequality.gini.baseline, inequality.gini.reform),
        )}
        {(["top_10_pct_share", "top_1_pct_share"] as const).map((k) =>
          row(k, INEQUALITY_LABEL[k], pct1(inequality[k].baseline), pct1(inequality[k].reform), ppChange(inequality[k].baseline, inequality[k].reform)),
        )}
      </dl>
      {indirect && povertyStill && <p className="mb-0 mt-3 text-[12.5px] leading-relaxed text-muted">{T1_COPY.povertyIndirect}</p>}
    </div>
  );
}

function ProvenanceFooter({ result }: { result: T1Result }) {
  const p = result.provenance;
  return (
    <div className="grid gap-1.5 border-t border-line pt-4 text-[12.5px] leading-relaxed text-muted">
      <p className="m-0">{provenanceText(p)}</p>
      <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1">
        <WithProvenance p={{ quality: "modelled", method_note: provenanceText(p) }}>
          <QualityBadge quality="modelled" />
        </WithProvenance>
        <span>Run on {longDate(p.fetched_at.slice(0, 10))}</span>
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium">
          {T1_COPY.openInPe}
        </a>
      </p>
    </div>
  );
}
