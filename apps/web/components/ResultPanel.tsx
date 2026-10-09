"use client";

import { useState } from "react";
import type { Range } from "@ledger/schema";
import { mortgageDelta, type Change } from "@ledger/engine";
import { direction, fixed, gbp, gbpBn, millions, rangeText, signed, signedBn } from "@/lib/format";
import { useScenario } from "@/lib/scenario";
import { track } from "@/lib/analytics";
import { FanChart } from "./FanChart";
import { changeLabel } from "@/lib/levers";
import { QualityBadge, RangeStrip, WithProvenance } from "./ui";
import { WhoGains } from "./WhoGains";

const RANGE_HEADROOM = 1.15;
const scaleFor = (r: Range) => Math.max(Math.abs(r[0]), Math.abs(r[2])) * RANGE_HEADROOM;

function Tile({
  label,
  value,
  range,
  rangeLabel,
  tone,
  note,
}: {
  label: string;
  value: string;
  range: Range;
  rangeLabel: string;
  tone: "up" | "down" | "flat";
  note?: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <div className="text-label text-muted">{label}</div>
      <div
        className={`whitespace-nowrap text-[26px] font-semibold leading-[1.15] tracking-[var(--tracking-figure)] ${tone === "up" ? "text-bad" : tone === "down" ? "text-good" : ""}`}
      >
        {value}
      </div>
      <RangeStrip range={range} scale={scaleFor(range)} tone={tone} />
      <div className="text-[12.5px] text-muted">{rangeLabel}</div>
      {note && <div className="text-[12.5px] text-muted">{note}</div>}
    </div>
  );
}

function useChangeLabel() {
  const { model } = useScenario();
  return (c: Change) => changeLabel(model, c);
}

function ShareActions() {
  const { code } = useScenario();
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  const href = `/s/${code}`;
  const copy = async () => {
    const url = new URL(href, window.location.href).href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      track("scenario_shared", { method: "copy" });
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      window.prompt("Copy this link", url);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={copy}
        className="cursor-pointer rounded-full bg-ink px-3 py-1 text-label font-semibold text-bg hover:opacity-90"
        aria-live="polite"
      >
        {copied ? "Link copied" : "Copy link"}
      </button>
      <a href={href} className="rounded-full border border-line-strong px-3 py-1 text-label font-medium text-muted no-underline hover:border-ink hover:text-ink">
        Share page
      </a>
    </div>
  );
}

const COPIED_MS = 2000;

function LinkNotice() {
  const { linkNotice, dismissLinkNotice } = useScenario();
  if (!linkNotice) return null;
  return (
    <div role="status" className="flex flex-wrap items-start justify-between gap-3 rounded-control bg-sunk px-4 py-3 text-label text-muted">
      <span>{linkNotice}</span>
      <button type="button" onClick={dismissLinkNotice} className="cursor-pointer font-medium text-ink underline underline-offset-2">
        Dismiss
      </button>
    </div>
  );
}

/** How much of a VAT change reaches shop prices: the one figure in the sandbox still without an official source. */
const VAT_PRICE_RULE = {
  quality: "training",
  method_note:
    "TODO(source): the share of a VAT change that reaches the consumer prices index is a rule of thumb, pending an official estimate (for example the Bank of England's or the ONS's analysis of the January 2011 VAT rise).",
} as const;

export function ResultPanel() {
  const { seed, result, settings, model, applyPreset } = useScenario();
  const { macro, macro: { provenance } } = seed.statement;
  const rules = seed.levers.macro_rules;
  const y1 = result.y1;
  const d = y1.d_borrowing_bn;
  const any = result.changes.length > 0;
  const tone = direction(d[1]);
  const changeLabel = useChangeLabel();

  const heading = !any
    ? "No changes yet"
    : tone === "up"
      ? `Borrowing up ${gbpBn(d[1])} a year`
      : tone === "down"
        ? `Borrowing down ${gbpBn(-d[1])} a year`
        : "Borrowing unchanged";

  const rate = model.rateLever;
  const mortgage = rate?.household;
  const rateNow = rate ? (settings[rate.id] as number) : macro.bank_rate_pct;
  const rateMoved = rate && Math.abs(rateNow - rate.base) > 1e-9;
  const dm = mortgage && rate && rateMoved ? mortgageDelta(mortgage, rate.base, rateNow) : 0;

  // Tiles in the right-hand column on phones open their tip leftwards, so it stays on screen (no sideways scroll at 390px).
  // GDP uses the OBR's fiscal multipliers (macro_rules, with their own quality); the price effect of VAT is still a rule of thumb.
  const multipliers = (align: "start" | "end") => (
    <WithProvenance p={rules} align={align} className={align === "end" ? "w-full" : ""}>
      <QualityBadge quality={rules.quality}>{rules.quality === "training" ? "Rule of thumb" : "OBR multipliers"}</QualityBadge>
    </WithProvenance>
  );
  const priceRule = (align: "start" | "end") => (
    <WithProvenance p={VAT_PRICE_RULE} align={align} className={align === "end" ? "w-full" : ""}>
      <QualityBadge quality={VAT_PRICE_RULE.quality}>Rule of thumb</QualityBadge>
    </WithProvenance>
  );

  return (
    <div id="scenario" className="mt-12 grid gap-8 border-t border-line pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-label text-muted">Your scenario against today, year one</div>
          <h2 className="mt-1 text-title font-semibold">
            {heading}
          </h2>
        </div>
        {any && (
          <div className="flex flex-wrap items-center gap-2">
            <ShareActions />
            <button
              type="button"
              onClick={() => applyPreset(null)}
              className="cursor-pointer rounded-full border border-line-strong px-3 py-1 text-label font-medium text-muted hover:border-ink hover:text-ink"
            >
              Reset all levers
            </button>
          </div>
        )}
      </div>
      <LinkNotice />

      <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
        <Tile
          label="Borrowing, per year"
          value={signedBn(d[1])}
          range={d}
          rangeLabel={any ? `range ${rangeText(d, signedBn)}` : "no change"}
          tone={tone}
        />
        <Tile
          label="Per household, per year"
          value={signed(y1.per_household_gbp[1], gbp, 0.5)}
          range={y1.per_household_gbp}
          rangeLabel={any ? `range ${rangeText(y1.per_household_gbp, (x) => signed(x, gbp, 0.5))}` : "no change"}
          tone={direction(y1.per_household_gbp[1], 0.5)}
          note={
            <span className="flex flex-wrap items-center gap-2">
              {millions(macro.households_m)} households
              <WithProvenance p={provenance.households_m!} align="end" className="grow">
                <QualityBadge quality={provenance.households_m!.quality} />
              </WithProvenance>
            </span>
          }
        />
        <Tile
          label="Prices (CPI), one-off"
          value={`${signed(y1.cpi_pp[1], (a) => fixed(a, 1))}pp`}
          range={y1.cpi_pp}
          rangeLabel={y1.cpi_pp[1] !== 0 ? `range ${rangeText(y1.cpi_pp, (x) => signed(x, (a) => fixed(a, 1)))}pp` : "no change"}
          tone={direction(y1.cpi_pp[1])}
          note={priceRule("start")}
        />
        <Tile
          label="GDP, year one"
          value={`${signed(y1.gdp_pct[1], (a) => fixed(a, 2))}%`}
          range={y1.gdp_pct}
          rangeLabel={any ? `range ${rangeText(y1.gdp_pct, (x) => signed(x, (a) => fixed(a, 2)))}%` : "no change"}
          tone="flat"
          note={multipliers("end")}
        />
      </div>

      <div className="grid items-start gap-10 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <FanChart />
        <div>
          <p className="mb-2 text-label text-muted">What moved</p>
          <ul className="m-0 grid list-none p-0 text-sm">
            {any ? (
              result.changes.map((c, i) => {
                const t = direction(c.d_borrowing_bn[1]);
                return (
                  <li key={i} className="flex justify-between gap-3 border-b border-line py-2.5">
                    <span>{changeLabel(c)}</span>
                    <span className="grid shrink-0 justify-items-end">
                      <span className={`font-medium ${t === "up" ? "text-bad" : t === "down" ? "text-good" : ""}`}>{signedBn(c.d_borrowing_bn[1])} borrowing</span>
                      {c.d_borrowing_bn[0] !== c.d_borrowing_bn[2] && (
                        <span className="text-caption text-muted">{rangeText(c.d_borrowing_bn, signedBn)}</span>
                      )}
                    </span>
                  </li>
                );
              })
            ) : (
              <li className="border-b border-line py-2.5 text-muted">Move a lever or pick a proposal. Every result shows a low–high range.</li>
            )}
          </ul>
          {mortgage && rateMoved && (
            <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
              A {gbp(mortgage.reference_loan_gbp)} repayment mortgage over {mortgage.term_years} years on a tracker at Bank Rate plus{" "}
              {fixed(mortgage.spread_over_bank_rate_pp, 0)}pp:{" "}
              <b className={`font-semibold ${dm > 0 ? "text-bad" : "text-good"}`}>{signed(dm, gbp, 0.5)} a month</b>. Most UK borrowers are on fixed
              rates and feel this when they remortgage. Bank Rate is set by the Bank of England, not the government.
            </p>
          )}
        </div>
      </div>

      <WhoGains />
    </div>
  );
}
