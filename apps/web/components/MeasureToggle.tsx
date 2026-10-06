"use client";

import type { Lever } from "@ledger/schema";
import { fundingKey } from "@ledger/schema";
import { isOn } from "@ledger/engine";
import { CONTROLLED_BY_LABEL } from "@/lib/copy";
import { gbpBn, longDate, rangeText } from "@/lib/format";
import { track } from "@/lib/analytics";
import { useScenario } from "@/lib/scenario";
import { QualityBadge, WithProvenance, qualityKey } from "./ui";

/** An announced measure: on/off, plus how it is paid for (DESIGN_HANDOFF "Measure toggle"). */
export function MeasureToggle({ lever }: { lever: Lever }) {
  const { seed, settings, setLever, setFunding } = useScenario();
  const on = isOn(settings[lever.id] as number);
  const funding = (settings[fundingKey(lever.id)] as string | undefined) ?? lever.funding_options?.[0]?.id;
  const card = lever.promise_id ? seed.promises.promises.find((p) => p.id === lever.promise_id) : undefined;
  const id = `measure-${lever.id}`;
  const fundingOption = lever.funding_options?.find((f) => f.id === funding);

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
        {lever.label}
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="switch"
          checked={on}
          onChange={(e) => {
            setLever(lever.id, e.target.checked ? lever.max : lever.min);
            track("lever_changed", { lever_id: lever.id });
          }}
        />
      </label>
      <p className="m-0 text-caption text-muted">
        {card && <>Announced {longDate(card.made_on)}. </>}
        Costs {rangeText(lever.effect.per_unit_bn.y1, gbpBn)} a year.
      </p>
      {lever.funding_options && (
        <div className={`grid gap-1.5 transition-opacity ${on ? "" : "opacity-50"}`}>
          <label htmlFor={`${id}-funding`} className="text-caption text-muted">
            Paid for by
          </label>
          <div className="relative">
            <select
              id={`${id}-funding`}
              className="select"
              value={funding}
              disabled={!on}
              onChange={(e) => setFunding(lever.id, e.target.value)}
            >
              {lever.funding_options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <svg aria-hidden viewBox="0 0 12 12" className="pointer-events-none absolute right-3 top-1/2 size-3 -translate-y-1/2 text-muted">
              <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          {on && fundingOption?.quality && (
            <span className="text-caption text-muted">
              <WithProvenance p={{ quality: fundingOption.quality, source_id: fundingOption.source_id, method_note: fundingOption.method_note }}>
                <QualityBadge quality={fundingOption.quality} />
              </WithProvenance>
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption text-muted">
        <span>{CONTROLLED_BY_LABEL[lever.controlled_by]}</span>
        <WithProvenance p={lever} align="end">
          <QualityBadge quality={qualityKey(lever)} />
        </WithProvenance>
      </div>
    </div>
  );
}
