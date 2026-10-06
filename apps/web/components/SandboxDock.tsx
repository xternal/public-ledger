"use client";

import { GROUP_LABEL, GROUP_ORDER } from "@/lib/copy";
import { direction, rangeText, signedBn } from "@/lib/format";
import { useScenario } from "@/lib/scenario";
import { LeverSlider } from "./LeverSlider";
import { MeasureToggle } from "./MeasureToggle";

export function SandboxDock() {
  const { seed, model, presetId, applyPreset, result, isBaseYear, setYear } = useScenario();
  const d = result.y1.d_borrowing_bn;
  const any = result.changes.length > 0;
  const tone = direction(d[1]);
  const presets = [...seed.presets].sort((a, b) => Number(a.kind === "editorial") - Number(b.kind === "editorial"));

  return (
    <aside
      aria-labelledby="sandbox-h"
      className="grid gap-5 rounded-panel bg-sunk p-5 lg:sticky lg:top-[76px] lg:max-h-[calc(100dvh-92px)] lg:overflow-y-auto"
    >
      <div>
        <h2 id="sandbox-h" className="text-[18px] font-semibold">
          What if…
        </h2>
        <p className="mt-0.5 text-label text-muted">Move a lever or pick a proposal.</p>
      </div>

      {!isBaseYear && (
        <div className="grid gap-2 rounded-control bg-bg px-3.5 py-3 text-label text-muted shadow-[var(--shadow-control)]">
          <span>The sandbox runs on {seed.baseYear}, the latest full year, with today&apos;s tax and spending costings.</span>
          <button
            type="button"
            onClick={() => setYear(seed.baseYear)}
            className="cursor-pointer justify-self-start rounded-full bg-ink px-3 py-1 text-label font-semibold text-bg hover:opacity-90"
          >
            Back to {seed.baseYear}
          </button>
        </div>
      )}

      <fieldset disabled={!isBaseYear} className="m-0 grid min-w-0 gap-5 border-0 p-0 transition-opacity disabled:opacity-45">

      <div className="grid gap-0.5 rounded-control bg-bg px-3.5 py-3 shadow-[var(--shadow-control)]" aria-live="polite">
        <span className="text-caption text-muted">Borrowing, year one</span>
        {any ? (
          <>
            <span className={`text-[20px] font-semibold tracking-[-0.02em] ${tone === "up" ? "text-bad" : tone === "down" ? "text-good" : ""}`}>
              {signedBn(d[1])} a year
            </span>
            <span className="text-caption text-muted">range {rangeText(d, signedBn)}</span>
          </>
        ) : (
          <span className="text-[20px] font-semibold tracking-[-0.02em] text-muted">No change</span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Proposals">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={p.id === presetId}
            onClick={() => applyPreset(p.id === presetId ? null : p)}
            className="cursor-pointer rounded-full border border-line-strong bg-bg px-2.5 py-1 text-label font-medium text-ink transition-colors hover:border-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-bg"
          >
            {p.label}
          </button>
        ))}
      </div>

      {GROUP_ORDER.map((group) => {
        const levers = model.levers.filter((l) => l.group === group);
        if (!levers.length) return null;
        return (
          <fieldset key={group} className="m-0 grid gap-4 border-0 border-t border-line-strong p-0 pt-4">
            <legend className="float-left mb-1 w-full p-0 text-caption font-medium text-muted">{GROUP_LABEL[group]}</legend>
            {levers.map((l) => (l.unit === "toggle" ? <MeasureToggle key={l.id} lever={l} /> : <LeverSlider key={l.id} lever={l} />))}
          </fieldset>
        );
      })}
      </fieldset>
    </aside>
  );
}
