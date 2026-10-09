"use client";

import type { Lever } from "@ledger/schema";
import { STEP_TOLERANCE, stepValues } from "@ledger/schema";
import { snapToStep } from "@ledger/engine";
import { CONTROLLED_BY_LABEL, STEPPED_LEVER_NOTE } from "@/lib/copy";
import { track } from "@/lib/analytics";
import { leverValueText } from "@/lib/levers";
import { useScenario } from "@/lib/scenario";
import { QualityBadge, WithProvenance, qualityKey } from "./ui";

/**
 * A lever its source costs only at some steps, and says cannot be scaled
 * (HMRC's capital gains tax rates). One choice per step, nothing in between:
 * a radio group, so it works by keyboard (Tab in, arrow keys to choose).
 */
export function LeverSteps({ lever }: { lever: Lever }) {
  const { settings, setLever } = useScenario();
  const value = snapToStep(lever, settings[lever.id] as number);
  const changed = Math.abs(value - lever.base) > STEP_TOLERANCE;
  const id = `lever-${lever.id}`;

  return (
    <fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0" aria-describedby={`${id}-note ${id}-who`}>
      <legend className="float-left mb-0.5 w-full p-0 text-sm">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-medium">{lever.label}</span>
          {/* The checked option already says this to screen readers. */}
          <b aria-hidden className={`whitespace-nowrap text-sm font-semibold ${changed ? "text-debt-ink" : "text-ink"}`}>
            {leverValueText(lever, value)}
          </b>
        </span>
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {stepValues(lever).map((v, i) => (
          <label
            key={v}
            className="cursor-pointer rounded-full border border-line-strong bg-bg px-3 py-1 text-label font-medium text-ink transition-colors hover:border-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-bg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus has-[:disabled]:cursor-default"
          >
            <input
              type="radio"
              className="sr-only"
              name={id}
              value={v}
              checked={Math.abs(v - value) < STEP_TOLERANCE}
              onChange={() => {
                setLever(lever.id, v);
                // A choice here is one finished change, not a slider tick (docs/CUSTOMER_JOURNEYS.md).
                track("lever_changed", { lever_id: lever.id });
              }}
            />
            {leverValueText(lever, v)}
            {i === 0 && " today"}
          </label>
        ))}
      </div>
      <p id={`${id}-note`} className="m-0 text-caption text-muted">
        {STEPPED_LEVER_NOTE}
      </p>
      <div id={`${id}-who`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption text-muted">
        <span>{CONTROLLED_BY_LABEL[lever.controlled_by]}</span>
        <WithProvenance p={lever} align="end">
          <QualityBadge quality={qualityKey(lever)} />
        </WithProvenance>
      </div>
    </fieldset>
  );
}
