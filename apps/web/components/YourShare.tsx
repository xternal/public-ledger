"use client";

import { useEffect, useMemo, useState } from "react";
import { yourShare } from "@ledger/engine";
import { ARCHETYPES, REGIONS, t1Range, type ArchetypeId, type RegionId, type T1Result } from "@ledger/schema";
import { gbp, grouped, rangeText, signed } from "@/lib/format";
import { useScenario } from "@/lib/scenario";
import { useT1 } from "@/lib/t1";
import { LIKE_ME_COPY, gbpChange, provenanceText } from "@/lib/t1-copy";
import { QualityBadge, SectionHeading, WithProvenance } from "./ui";

/**
 * Income tax and NI on a salary, split the way the state spends it (PRD F3).
 * The salary lives in this component's state only: it is never sent,
 * stored or tracked (invariant 7).
 */
export function YourShare() {
  const { seed, model, result, settings } = useScenario();
  const [salary, setSalary] = useState(seed.tax.your_share_defaults.salary_gbp);
  const share = useMemo(() => yourShare(model, seed.tax, result, settings, salary), [model, seed.tax, result, settings, salary]);
  const labelOf = (id: string) => seed.statement.spending.find((l) => l.id === id)?.label ?? id;
  const max = Math.max(...share.by_line.map((l) => l.gbp), share.borrowed_on_top_gbp, 1);
  const taxP = { quality: seed.tax.meta.quality, method_note: seed.tax.meta.method_note };

  return (
    <section id="you" aria-labelledby="you-h" className="scroll-mt-16 pt-20">
      <SectionHeading
        id="you-h"
        title="Your share of the bill"
        intro="Income tax and National Insurance on a salary, under today's rates or your scenario, split the way the state spends it."
      />
      <div className="grid items-start gap-10 md:grid-cols-[300px_minmax(0,1fr)]">
        <div className="grid gap-4 rounded-panel border border-line p-5">
          <div className="grid gap-1.5">
            <label htmlFor="salary" className="text-label font-medium text-muted">
              Annual salary
            </label>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[22px] font-semibold text-faint">
                £
              </span>
              <input
                id="salary"
                inputMode="numeric"
                autoComplete="off"
                value={salary ? grouped(salary) : ""}
                onChange={(e) => setSalary(Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0))}
                className="w-full rounded-control border border-line-strong bg-bg py-2 pl-8 pr-3 text-[22px] font-semibold tracking-[-0.02em] text-ink"
              />
            </div>
            <span className="text-caption text-muted">Stays on this device. We never see it.</span>
          </div>
          <dl className="m-0 grid gap-2 text-sm">
            <div className="flex justify-between">
              <dt>Income tax</dt>
              <dd className="m-0">{gbp(share.scenario.income_tax)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>National Insurance</dt>
              <dd className="m-0">{gbp(share.scenario.ni)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 font-semibold">
              <dt>You pay a year</dt>
              <dd className="m-0">{gbp(share.scenario.total)}</dd>
            </div>
            {Math.abs(share.diff) > 0.5 && (
              <div className="flex justify-between">
                <dt className="text-muted">Against today</dt>
                <dd className={`m-0 font-medium ${share.diff > 0 ? "text-bad" : "text-good"}`}>{signed(share.diff, gbp, 0.5)}</dd>
              </div>
            )}
          </dl>
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
            Excludes VAT, council tax and other taxes you also pay. Rates for {seed.tax.meta.geography}, {seed.tax.meta.tax_year}.
            <WithProvenance p={taxP}>
              <QualityBadge quality={taxP.quality} />
            </WithProvenance>
          </p>
        </div>

        <ul className="m-0 grid list-none gap-3 p-0" aria-label="Your tax split by what it pays for">
          {share.by_line.map((l) => (
            <li key={l.id} className="grid grid-cols-[112px_minmax(0,1fr)_64px] items-center gap-3 text-[13px] sm:grid-cols-[190px_minmax(0,1fr)_80px] sm:gap-4 sm:text-sm">
              <span className="leading-tight">{labelOf(l.id)}</span>
              <span className="h-2 overflow-hidden rounded-full bg-sunk">
                <i className="block h-full rounded-full bg-spend" style={{ width: `${(l.gbp / max) * 100}%` }} />
              </span>
              <span className="text-right font-medium">{gbp(l.gbp)}</span>
            </li>
          ))}
          <li className="mt-2 grid grid-cols-[112px_minmax(0,1fr)_64px] items-center gap-3 border-t border-line pt-4 text-[13px] sm:grid-cols-[190px_minmax(0,1fr)_80px] sm:gap-4 sm:text-sm">
            <span className="font-semibold">Plus borrowing on top</span>
            <span className="h-2 overflow-hidden rounded-full bg-sunk">
              <i className="hatch block h-full rounded-full" style={{ width: `${(share.borrowed_on_top_gbp / max) * 100}%` }} />
            </span>
            <span className="text-right font-semibold text-debt-ink">{gbp(share.borrowed_on_top_gbp)}</span>
          </li>
        </ul>
      </div>
      <PeopleLikeMe />
    </section>
  );
}

/** The reader's household type and region, kept in this browser only (invariant 7): never sent, never tracked. */
const LIKE_ME_KEY = "ledger.people-like-me";

interface LikeMe {
  archetype: ArchetypeId;
  region: RegionId;
}

const isArchetype = (v: unknown): v is ArchetypeId => ARCHETYPES.some((a) => a.id === v);
const isRegion = (v: unknown): v is RegionId => REGIONS.some((r) => r.id === v);

function useLikeMe(): [LikeMe, (next: LikeMe) => void] {
  const [choice, setChoice] = useState<LikeMe>({ archetype: ARCHETYPES[0].id, region: REGIONS[0].id });
  // Read after mount, so the server render and the first client render match.
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(LIKE_ME_KEY) ?? "null");
      if (saved && typeof saved === "object") {
        const { archetype, region } = saved as Record<string, unknown>;
        setChoice((c) => ({ archetype: isArchetype(archetype) ? archetype : c.archetype, region: isRegion(region) ? region : c.region }));
      }
    } catch {
      // Storage blocked or unreadable: keep the defaults.
    }
  }, []);
  const update = (next: LikeMe) => {
    setChoice(next);
    try {
      window.localStorage.setItem(LIKE_ME_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: the choice lasts for this page view.
    }
  };
  return [choice, update];
}

function Chevron() {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className="pointer-events-none absolute right-3 top-1/2 size-3 -translate-y-1/2 text-muted">
      <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LikeMeFigure({ label, gbpYear, sub }: { label: string; gbpYear: number; sub?: string }) {
  const range = t1Range(gbpYear);
  const tone = gbpYear < -0.5 ? "text-debt-ink" : gbpYear > 0.5 ? "text-good" : "";
  return (
    <div className="grid min-w-0 content-start gap-1">
      <div className="text-label text-muted">{label}</div>
      <div className={`text-[26px] font-semibold leading-[1.15] tracking-[var(--tracking-figure)] ${tone}`}>
        {gbpChange(gbpYear)} <span className="text-[15px] font-medium tracking-normal text-muted">a year</span>
      </div>
      <div className="text-[12.5px] text-muted">range {rangeText(range, gbpChange)}</div>
      {sub && <div className="text-[12.5px] text-muted">{sub}</div>}
    </div>
  );
}

function LikeMeResult({ result, choice }: { result: T1Result; choice: LikeMe }) {
  const household = result.households.find((h) => h.id === choice.archetype);
  const region = result.regions.find((r) => r.id === choice.region);
  const regionName = REGIONS.find((r) => r.id === choice.region)!.name;
  return (
    <div className="grid gap-5">
      <div className="grid gap-6 sm:grid-cols-2">
        {household ? (
          <LikeMeFigure
            label={LIKE_ME_COPY.householdResult}
            gbpYear={household.change_gbp}
            sub={`${LIKE_ME_COPY.netIncome}: ${gbp(household.baseline_net_gbp)} → ${gbp(household.reform_net_gbp)}`}
          />
        ) : (
          <p className="m-0 text-sm text-muted">{LIKE_ME_COPY.noHousehold}</p>
        )}
        {region ? (
          <LikeMeFigure label={LIKE_ME_COPY.regionResult(region.name)} gbpYear={region.avg_change_gbp} sub="Per household" />
        ) : (
          <div className="grid content-start gap-1">
            <div className="text-label text-muted">{LIKE_ME_COPY.regionResult(regionName)}</div>
            <p className="m-0 text-sm text-muted">{LIKE_ME_COPY.noRegion(regionName)}</p>
          </div>
        )}
      </div>
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <WithProvenance p={{ quality: "modelled", method_note: `${provenanceText(result.provenance)} ${LIKE_ME_COPY.spending}` }}>
          <QualityBadge quality="modelled" />
        </WithProvenance>
        <span>PolicyEngine UK {result.provenance.model_version}. Static: no change in behaviour.</span>
        <a href="#who-gains">{LIKE_ME_COPY.seeAll}</a>
      </p>
    </div>
  );
}

/**
 * "People like me" (M5): fixed example households and regions from the T1
 * result the scenario panel fetched. This block never fetches on its own and
 * never sends the reader's choice anywhere.
 */
function PeopleLikeMe() {
  const t1 = useT1();
  const [choice, setChoice] = useLikeMe();
  if (!t1) return null;
  const { phase, applicable } = t1;

  let body: React.ReactNode;
  if (!applicable) {
    body = (
      <p className="m-0 text-sm text-muted">
        {LIKE_ME_COPY.idle} <a href="#statement">{LIKE_ME_COPY.idleLink}</a>
      </p>
    );
  } else if (phase.kind === "ready") {
    body = <LikeMeResult result={phase.result} choice={choice} />;
  } else {
    const text =
      phase.kind === "pending"
        ? LIKE_ME_COPY.pending
        : phase.kind === "error"
          ? LIKE_ME_COPY.failed
          : phase.kind === "not_applicable"
            ? LIKE_ME_COPY.notApplicable
            : LIKE_ME_COPY.ask;
    body = (
      <p className="m-0 text-sm text-muted">
        {text} {phase.kind !== "pending" && phase.kind !== "not_applicable" && <a href="#who-gains">{LIKE_ME_COPY.askLink}</a>}
      </p>
    );
  }

  return (
    <div className="mt-12 grid items-start gap-6 border-t border-line pt-8 md:grid-cols-[300px_minmax(0,1fr)] md:gap-10">
      <div className="grid gap-4">
        <div>
          <h3 id="like-me-h" className="text-[18px] font-semibold">
            {LIKE_ME_COPY.heading}
          </h3>
          <p className="mt-1 text-label text-muted">{LIKE_ME_COPY.intro}</p>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="like-me-household" className="text-label font-medium text-muted">
            {LIKE_ME_COPY.household}
          </label>
          <div className="relative">
            <select
              id="like-me-household"
              className="select"
              value={choice.archetype}
              onChange={(e) => isArchetype(e.target.value) && setChoice({ ...choice, archetype: e.target.value })}
            >
              {ARCHETYPES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <Chevron />
          </div>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="like-me-region" className="text-label font-medium text-muted">
            {LIKE_ME_COPY.region}
          </label>
          <div className="relative">
            <select
              id="like-me-region"
              className="select"
              value={choice.region}
              onChange={(e) => isRegion(e.target.value) && setChoice({ ...choice, region: e.target.value })}
            >
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <Chevron />
          </div>
        </div>
      </div>
      <div aria-live="polite" aria-labelledby="like-me-h" role="region" className="min-w-0 md:pt-1">
        {body}
      </div>
    </div>
  );
}
