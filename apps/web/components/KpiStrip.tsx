"use client";

import type { Provenance, Range } from "@ledger/schema";
import { DEBT_INTEREST_LINE, add, ordered } from "@ledger/engine";
import { useScenario } from "@/lib/scenario";
import { direction, fixed, gbpBn, gbpTn, longDate, rangeText, shareOf, signedBn } from "@/lib/format";
import { WithProvenance } from "./ui";

interface Kpi {
  label: string;
  value: string;
  sub: string;
  debt?: boolean;
  /** Scenario change, shown as a range (invariant 2). */
  change?: Range;
  p: Partial<Provenance> & { quality: Provenance["quality"] };
}

const SCENARIO_NOTE = "Scenario value: static costing, before behaviour. The range is shown underneath.";

export function KpiStrip() {
  const { seed, result, settings, model } = useScenario();
  const { macro, borrowing_provenance } = seed.statement;
  const { receipts_bn, spending_bn, borrowing_bn } = result.totals;
  const debtInterest = result.spending[DEBT_INTEREST_LINE] ?? 0;
  const raw = result.raw;
  const changed = result.changes.length > 0;

  const dReceipts = ordered(raw.d_tax_bn);
  const dSpending = ordered(add(raw.d_spending_non_interest_bn, raw.rate_y1_bn));
  const dInterest = ordered(raw.rate_y1_bn);
  const totalP = { quality: "sourced" as const, source_id: borrowing_provenance.source_id };
  const scenarioP = { quality: "modelled" as const, method_note: SCENARIO_NOTE };

  const rateLever = model.rateLever;
  const rate = rateLever ? (settings[rateLever.id] as number) : macro.bank_rate_pct;
  const rateChanged = Math.abs(rate - macro.bank_rate_pct) > 1e-9;

  const items: Kpi[] = [
    {
      label: "Income",
      value: gbpBn(receipts_bn),
      sub: "taxes and other receipts",
      change: dReceipts,
      p: direction(dReceipts[1]) === "flat" ? totalP : scenarioP,
    },
    {
      label: "Spending",
      value: gbpBn(spending_bn),
      sub: "all public spending",
      change: dSpending,
      p: direction(dSpending[1]) === "flat" ? totalP : scenarioP,
    },
    {
      label: "Borrowed",
      value: gbpBn(borrowing_bn),
      sub: `${fixed(shareOf(borrowing_bn, spending_bn), 1)}p of every £1 spent`,
      debt: true,
      change: result.y1.d_borrowing_bn,
      p: changed ? scenarioP : borrowing_provenance,
    },
    {
      label: "Debt",
      value: gbpTn(macro.psnd_bn),
      sub: `${fixed(macro.psnd_pct_gdp, 1)}% of GDP in\u00a0${seed.statement.meta.fiscal_year}`,
      p: macro.provenance.psnd_bn!,
    },
    {
      label: "Debt interest",
      value: gbpBn(debtInterest),
      sub: `${fixed(shareOf(debtInterest, spending_bn), 1)}p of every £1 spent`,
      debt: true,
      change: dInterest,
      p: direction(dInterest[1]) === "flat" ? (seed.statement.spending.find((l) => l.id === DEBT_INTEREST_LINE) ?? totalP) : scenarioP,
    },
    {
      label: "Bank Rate",
      value: `${fixed(rate, 2)}%`,
      sub: rateChanged ? "scenario value, set by the Bank of England" : `held ${longDate(macro.bank_rate_date)}`,
      p: rateChanged ? { quality: "modelled", method_note: "A value you set in the sandbox. The Bank of England sets Bank Rate, not the government." } : macro.provenance.bank_rate_pct!,
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-6 border-y border-line py-6 sm:grid-cols-3 lg:grid-cols-6 lg:gap-0 lg:divide-x lg:divide-line">
      {items.map((k) => {
        const tone = k.change ? direction(k.change[1]) : "flat";
        return (
          <div key={k.label} className="grid min-w-0 content-start gap-1 lg:px-5 lg:first:pl-0 lg:last:pr-0">
            <dt className="text-label text-muted">{k.label}</dt>
            <dd className="m-0">
              <WithProvenance p={k.p}>
                <span className={`whitespace-nowrap text-[clamp(22px,2.2vw,var(--text-figure))] font-semibold leading-[1.1] tracking-[var(--tracking-figure)] ${k.debt ? "text-debt" : ""}`}>
                  {k.value}
                </span>
              </WithProvenance>
            </dd>
            <dd className="m-0 text-[12.5px] text-muted">
              {k.change && tone !== "flat" ? (
                <span className={tone === "up" && k.debt ? "text-bad" : tone === "down" && k.debt ? "text-good" : "text-ink"}>
                  {signedBn(k.change[1])}
                  <span className="text-muted">, range {rangeText(k.change, signedBn)}</span>
                </span>
              ) : (
                k.sub
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
