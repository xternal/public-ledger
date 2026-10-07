"use client";

import type { CSSProperties } from "react";
import type { Lever } from "@ledger/schema";
import { CONTROLLED_BY_LABEL } from "@/lib/copy";
import { track } from "@/lib/analytics";
import { leverValueText } from "@/lib/levers";

export { leverDeltaText, leverValueText } from "@/lib/levers";
import { useScenario } from "@/lib/scenario";
import { QualityBadge, WithProvenance, qualityKey } from "./ui";

const pct = (lever: Lever, v: number) => ((v - lever.min) / (lever.max - lever.min)) * 100;

export function LeverSlider({ lever }: { lever: Lever }) {
  const { settings, setLever } = useScenario();
  const value = settings[lever.id] as number;
  const changed = Math.abs(value - lever.base) > 1e-9;
  const a = pct(lever, Math.min(value, lever.base));
  const b = pct(lever, Math.max(value, lever.base));
  const track_ = changed
    ? `linear-gradient(to right, var(--line-strong) 0 ${a}%, var(--debt) ${a}% ${b}%, var(--line-strong) ${b}% 100%)`
    : "var(--line-strong)";
  const id = `lever-${lever.id}`;

  return (
    <div className="grid gap-0.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <label htmlFor={id} className="font-medium">
          {lever.label}
        </label>
        <span className="flex items-baseline gap-2 whitespace-nowrap">
          <b className={`text-sm font-semibold ${changed ? "text-debt-ink" : "text-ink"}`}>{leverValueText(lever, value)}</b>
          {changed ? (
            <button
              type="button"
              onClick={() => setLever(lever.id, lever.base)}
              className="inline-flex min-h-6 cursor-pointer items-center text-caption text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
            >
              {/* The spoken name contains the visible words (WCAG 2.5.3, label in name). */}
              <span className="sr-only">Reset {lever.label} to </span>
              today {leverValueText(lever, lever.base)}
            </button>
          ) : null}
        </span>
      </div>
      <div className="relative">
        {changed && (
          <span aria-hidden className="pointer-events-none absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-faint" style={{ left: `calc(${pct(lever, lever.base)}% + ${(0.5 - pct(lever, lever.base) / 100) * 16}px)` }} />
        )}
        <input
          id={id}
          type="range"
          className="lever-range relative"
          min={lever.min}
          max={lever.max}
          step={lever.step}
          value={value}
          style={{ "--track": track_ } as CSSProperties}
          aria-describedby={`${id}-who`}
          aria-valuetext={`${leverValueText(lever, value)}, today ${leverValueText(lever, lever.base)}`}
          onChange={(e) => setLever(lever.id, Number(e.target.value))}
          onPointerUp={() => track("lever_changed", { lever_id: lever.id })}
          onKeyUp={() => track("lever_changed", { lever_id: lever.id })}
        />
      </div>
      <div id={`${id}-who`} className="-mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption text-muted">
        <span>{CONTROLLED_BY_LABEL[lever.controlled_by]}</span>
        <WithProvenance p={lever} align="end">
          <QualityBadge quality={qualityKey(lever)} />
        </WithProvenance>
      </div>
    </div>
  );
}
