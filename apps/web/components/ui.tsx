"use client";

import { useId, type ReactNode } from "react";
import type { Provenance as ProvenanceT, Quality, Range } from "@ledger/schema";
import { QUALITY_HELP, QUALITY_LABEL } from "@/lib/copy";
import { useScenario } from "@/lib/scenario";

type QualityKey = Quality | "plug";

export const qualityKey = (p: { quality: Quality; plug?: boolean | undefined }): QualityKey => (p.plug ? "plug" : p.quality);

export function QualityBadge({ quality, children }: { quality: QualityKey; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-caption font-medium text-muted">
      <i className="q-dot" data-q={quality} aria-hidden />
      {children ?? QUALITY_LABEL[quality]}
    </span>
  );
}

export function QualityDot({ quality }: { quality: QualityKey }) {
  return <i className="q-dot" data-q={quality} role="img" aria-label={QUALITY_LABEL[quality]} title={QUALITY_LABEL[quality]} />;
}

/** The body of a provenance tip: quality, method and source link. */
export function ProvenanceDetail({ p }: { p: Partial<ProvenanceT> & { quality: Quality } }) {
  const { seed } = useScenario();
  const source = p.source_id ? seed.sources.find((s) => s.id === p.source_id) : undefined;
  const q = qualityKey(p);
  return (
    <span className="grid gap-1">
      <QualityBadge quality={q} />
      <span>{p.method_note ?? QUALITY_HELP[q]}</span>
      {source && (
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="font-medium">
          {source.title}
        </a>
      )}
    </span>
  );
}

/**
 * Wrap a number so its provenance shows on hover or keyboard focus
 * (DESIGN_HANDOFF principle 4: provenance is one glance away).
 */
export function WithProvenance({
  p,
  children,
  className = "",
  align = "start",
}: {
  p: Partial<ProvenanceT> & { quality: Quality };
  children: ReactNode;
  className?: string;
  /** "end" opens the tip leftwards, for badges near the right edge. */
  align?: "start" | "end";
}) {
  const id = useId();
  return (
    <span className={`tip-host inline-flex items-center gap-2 ${className}`} tabIndex={0} aria-describedby={id}>
      {children}
      <span className="tip" role="tooltip" id={id} data-align={align}>
        <ProvenanceDetail p={p} />
      </span>
    </span>
  );
}

export function SectionHeading({
  id,
  title,
  intro,
  aside,
}: {
  id?: string;
  title: string;
  intro?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-[66ch]">
        <h2 id={id} className="text-title font-semibold">
          {title}
        </h2>
        {intro && <p className="mt-1.5 text-muted">{intro}</p>}
      </div>
      {aside}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-control bg-sunk p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className="cursor-pointer rounded-md px-3 py-1.5 text-label font-medium text-muted transition-colors hover:text-ink aria-pressed:bg-bg aria-pressed:text-ink aria-pressed:shadow-[var(--shadow-control)]"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A low–high range drawn as a line with the central value as a dot
 * (DESIGN_HANDOFF "Result tile ... with range line"). Zero is marked.
 */
export function RangeStrip({ range, scale, tone }: { range: Range; scale: number; tone: "up" | "down" | "flat" }) {
  if (scale <= 0) return <div className="h-2" aria-hidden />;
  const pos = (x: number) => `${50 + (x / scale) * 50}%`;
  const color = tone === "up" ? "var(--bad)" : tone === "down" ? "var(--good)" : "var(--faint)";
  return (
    <div className="relative h-2" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
      <div className="absolute top-0 h-2 w-px bg-line-strong" style={{ left: "50%" }} />
      <div
        className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full opacity-50"
        style={{ left: pos(range[0]), width: `calc(${pos(range[2])} - ${pos(range[0])})`, background: color }}
      />
      <div
        className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ left: pos(range[1]), background: color }}
      />
    </div>
  );
}

export function TextButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`cursor-pointer text-label font-medium text-accent underline decoration-from-font underline-offset-2 hover:opacity-80 ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}
