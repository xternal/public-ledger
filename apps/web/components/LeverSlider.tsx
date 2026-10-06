"use client";

import type { CSSProperties } from "react";
import type { Lever } from "@ledger/schema";
import { CONTROLLED_BY_LABEL } from "@/lib/copy";
import { MINUS, fixed } from "@/lib/format";
import { track } from "@/lib/analytics";
import { useScenario } from "@/lib/scenario";
import { QualityBadge, WithProvenance, qualityKey } from "./ui";

const decimalsOf = (step: number) => (Number.isInteger(step) ? 0 : (String(step).split(".")[1]?.length ?? 0));

/** "20%", "2.3%", "3.75%", "+7%" */
export function leverValueText(lever: Lever, v: number): string {
  const s = fixed(v, decimalsOf(lever.step));
  if (lever.unit === "pct") return `${v > 0 ? "+" : ""}${s}%`;
  return `${s}%`;
}

/** "+2pp", "+1.2pp of GDP", "+7%" */
export function leverDeltaText(lever: Lever, d: number): string {
  const sign = d > 0 ? "+" : MINUS;
  const s = fixed(Math.abs(d), decimalsOf(lever.step));
  if (lever.unit === "pct") return `${sign}${s}%`;
  if (lever.unit === "pct_gdp") return `${sign}${s}pp of GDP`;
  return `${sign}${s}pp`;
}

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
          <b className={`text-sm font-semibold ${changed ? "text-debt" : "text-ink"}`}>{leverValueText(lever, value)}</b>
          {changed ? (
            <button
              type="button"
              onClick={() => setLever(lever.id, lever.base)}
              className="cursor-pointer text-caption text-faint underline decoration-dotted underline-offset-2 hover:text-ink"
              aria-label={`Reset ${lever.label} to today's ${leverValueText(lever, lever.base)}`}
            >
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
          onChange={(e) => {
            setLever(lever.id, Number(e.target.value));
            track("lever_changed", { lever_id: lever.id });
          }}
        />
      </div>
      <div id={`${id}-who`} className="-mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption text-faint">
        <span>{CONTROLLED_BY_LABEL[lever.controlled_by]}</span>
        <WithProvenance p={lever} align="end">
          <QualityBadge quality={qualityKey(lever)} />
        </WithProvenance>
      </div>
    </div>
  );
}
