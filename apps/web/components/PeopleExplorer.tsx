"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Assumption, AssumptionDetail, PeopleBundle, PeopleProvenance, Range, SpendingScenario, Variant, VariantChart, VitalChart } from "@ledger/schema";
import { CONTROLLED_BY_LABEL } from "@/lib/copy";
import { PEOPLE_COPY as C } from "@/lib/people-copy";
import { track, type PeopleChartId } from "@/lib/analytics";
import { shortYear } from "@/lib/format";
import {
  ASSUMPTION_IDS,
  BASELINE,
  PRINCIPAL,
  choiceOf,
  combinations,
  fyStart,
  pctGdp,
  people as peopleFmt,
  per100,
  ratio,
  readChoice,
  variantFor,
  writeChoice,
  type AssumptionId,
  type Choice,
} from "@/lib/people-view";
import { ChartTable } from "./ChartTable";
import { FanKey, VariantFan, type FanLine, type KeyItem } from "./VariantFan";
import { QualityBadge, SourcesProvider, TextButton, WithProvenance } from "./ui";

/**
 * /people: assumption switches (published ONS variants and OBR scenarios only) and four
 * fans. The choice lives in the URL (?fertility=low&spending=higher_population) so a
 * view can be shared; the page renders the principal projection before that is read.
 */
export function PeopleExplorer({ people }: { people: PeopleBundle }) {
  const [choice, setChoice] = useState<Choice>(PRINCIPAL);
  const [spending, setSpending] = useState(BASELINE);
  // The choice comes from the URL once; only after that does the URL follow the choice.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const r = readChoice(new URLSearchParams(window.location.search), people);
    setChoice(r.choice);
    setSpending(r.spending);
    setReady(true);
  }, [people]);
  useEffect(() => {
    if (!ready) return;
    const url = writeChoice(new URL(window.location.href), choice, spending);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [choice, spending, ready]);

  const variant = variantFor(people.variants, choice);
  const selected = variant && variant.code !== "ppp" ? variant : null;
  const pick = (id: AssumptionId, value: string) => {
    track("people_assumption_changed", { assumption: id, value });
    setChoice((c) => ({ ...c, [id]: value }));
  };
  const pickScenario = (id: string) => {
    track("people_assumption_changed", { assumption: "spending", value: id });
    setSpending(id);
  };

  return (
    <SourcesProvider sources={people.sources}>
      <section aria-labelledby="assumptions-h" className="rounded-panel border border-line p-4 sm:p-5">
        <div className="mb-4 grid gap-1">
          <h2 id="assumptions-h" className="m-0 text-title font-semibold">
            {C.assumptionsTitle}
          </h2>
          <p className="m-0 text-label text-muted">{C.assumptionsIntro}</p>
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {people.assumptions
            .filter((a): a is Assumption & { id: AssumptionId } => ASSUMPTION_IDS.includes(a.id as AssumptionId))
            .map((a) => (
              <AssumptionGroup key={a.id} a={a} value={choice[a.id]} onChange={(v) => pick(a.id, v)} />
            ))}
        </div>
        <Status people={people} variant={variant} selected={selected} onPick={setChoice} />
        {people.assumptions
          .filter((a) => !ASSUMPTION_IDS.includes(a.id as AssumptionId))
          .map((a) => {
            // Our sentence first; the ONS note it quotes (the pension age timetable) folds away.
            const [ours, ons] = (a.note ?? "").split(" ONS: ");
            return (
              <div key={a.id} className="mt-4 grid gap-1 border-t border-line pt-4 text-label">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold text-ink">{a.label}</span>
                  <span className="text-caption text-muted">{CONTROLLED_BY_LABEL[a.controlled_by]}</span>
                </div>
                {ours && <p className="m-0 max-w-[90ch] text-muted">{ours}</p>}
                {ons && (
                  <details className="max-w-[90ch] text-muted">
                    <summary className="cursor-pointer text-caption font-medium text-accent">{C.spaTimetable}</summary>
                    <p className="m-0 mt-1 text-caption">{ons}</p>
                  </details>
                )}
              </div>
            );
          })}
      </section>

      <div className="grid gap-x-10 gap-y-12 pt-10 lg:grid-cols-2">
        <ProjectionBlock
          id="oadr"
          chartId="people_oadr"
          title={C.oadrTitle}
          term={C.oadrTerm}
          chart={people.charts.oadr}
          selected={selected}
          format={per100}
          tickFormat={(x) => String(x)}
        />
        <ProjectionBlock
          id="workers"
          chartId="people_workers"
          title={C.workersTitle}
          term={C.workersTerm}
          chart={people.charts.workers}
          selected={selected}
          format={ratio}
          tickFormat={(x) => String(x)}
        />
      </div>
      <div className="pt-12">
        <VitalBlock births={people.charts.births} deaths={people.charts.deaths} selected={selected} />
      </div>
      <div className="pt-12">
        <SpendingBlock people={people} scenarioId={spending} onPick={pickScenario} />
      </div>
    </SourcesProvider>
  );
}

// ------------------------------------------------------------------ controls

function detailText(d: AssumptionDetail): string | null {
  if ("male" in d) return C.lifeExpectancy(d.male, d.female);
  if (!("value" in d)) return null;
  if (d.unit === "children_per_woman") return C.childrenPerWoman(d.value);
  if (d.unit === "persons_k") return d.value === 0 ? C.noNetMigration : C.netMigration(peopleFmt(d.value));
  return String(d.value);
}

function AssumptionGroup({ a, value, onChange }: { a: Assumption; value: string; onChange: (v: string) => void }) {
  const year = a.options.map((o) => ("year" in o.detail ? o.detail.year : null)).find(Boolean);
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
      <legend className="mb-2 flex w-full flex-wrap items-baseline justify-between gap-x-3 p-0">
        <span className="text-body font-semibold text-ink">{a.label}</span>
        <span className="text-caption text-muted">{CONTROLLED_BY_LABEL[a.controlled_by]}</span>
      </legend>
      <div className="grid gap-1.5">
        {a.options.map((o) => {
          const d = detailText(o.detail);
          return (
            <label
              key={o.value}
              className="flex cursor-pointer items-baseline justify-between gap-3 rounded-control px-3 py-2 text-label text-muted shadow-[var(--shadow-control)] transition-colors hover:text-ink has-checked:bg-sunk has-checked:text-ink has-checked:shadow-[inset_0_0_0_1.5px_var(--ink)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
            >
              <input type="radio" name={a.id} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
              <span className="font-medium">{o.label}</span>
              {d && <span className="text-right text-caption tabular-nums">{d}</span>}
            </label>
          );
        })}
      </div>
      {year && <p className="m-0 text-caption text-faint">{C.assumptionYear(year)}</p>}
    </fieldset>
  );
}

function Status({ people, variant, selected, onPick }: { people: PeopleBundle; variant: Variant | undefined; selected: Variant | null; onPick: (c: Choice) => void }) {
  if (!variant) {
    return (
      <div role="status" className="mt-4 grid gap-2 rounded-control bg-warn/8 p-3 text-label text-ink">
        <p className="m-0">{C.notPublished}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {combinations(people.variants).map((v) => (
            <TextButton key={v.code} onClick={() => onPick(choiceOf(v))}>
              {v.label}
            </TextButton>
          ))}
          <TextButton onClick={() => onPick(PRINCIPAL)}>{C.backToPrincipal}</TextButton>
        </div>
      </div>
    );
  }
  return (
    <p role="status" className="m-0 mt-4 min-h-[1.45em] text-label text-muted">
      {selected ? `${C.showing(selected.label)}${selected.in_range ? "" : ` ${C.specialCase}`}` : ""}
    </p>
  );
}

// ------------------------------------------------------------------ charts

function Provenance({ p, align = "end" }: { p: PeopleProvenance; align?: "start" | "end" }) {
  return (
    <WithProvenance p={p} align={align}>
      <QualityBadge quality={p.quality} />
    </WithProvenance>
  );
}

function ChartHeader({ id, title, term, summary, prov }: { id: string; title: string; term: string; summary: ReactNode; prov: PeopleProvenance }) {
  return (
    <div className="mb-3 grid gap-1.5">
      <h3 id={`${id}-h`} className="m-0 max-w-[40ch] text-lead font-semibold leading-snug">
        {title}
      </h3>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-label text-muted">
        <Provenance p={prov} align="start" />
        <span>{term}</span>
      </div>
      <p className="m-0 text-body text-ink">{summary}</p>
    </div>
  );
}

/** Chart labels for thousands of people: 557 -> "557k", 1200 -> "1.2m". The tables give the full figure. */
const thousandsShort = (k: number) => (k >= 1000 ? `${(k / 1000).toFixed(1).replace(/\.0$/, "")}m` : `${Math.round(k)}k`);

const rangeText = (r: Range, f: (x: number) => string) => `${f(r[0])} ${C.tableTo} ${f(r[2])}`;

function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return <th className={`py-2 pr-4 font-medium ${right ? "text-right" : ""}`}>{children}</th>;
}

function ProjectionBlock({
  id,
  chartId,
  title,
  term,
  chart,
  selected,
  format,
  tickFormat,
}: {
  id: string;
  chartId: PeopleChartId;
  title: string;
  term: string;
  chart: VariantChart;
  selected: Variant | null;
  format: (x: number) => string;
  tickFormat: (x: number) => string;
}) {
  const ppp = chart.variants.ppp!;
  const sel = selected ? chart.variants[selected.code] : undefined;
  const n = chart.years.length - 1;
  const lines: FanLine[] = [
    { id, label: title, tone: "rec", years: chart.years, range: chart.range, principal: ppp, selected: sel && selected ? { label: selected.label, values: sel } : null },
  ];
  const summary = (
    <>
      <b className="font-semibold tabular-nums">{format(ppp[n]!)}</b> in {chart.years[n]} in the principal projection, from {format(ppp[0]!)} in {chart.years[0]}
      {sel && selected ? (
        <>
          ; <b className="font-semibold tabular-nums">{format(sel[n]!)}</b> with {selected.label.toLowerCase()}
        </>
      ) : null}
      . Variants range from {rangeText(chart.range[n]!, format)}.
    </>
  );
  const key: KeyItem[] = [
    { kind: "line", tone: "rec", label: C.principal },
    ...(selected ? [{ kind: "dash" as const, tone: "rec" as const, label: selected.label }] : []),
    { kind: "band", tone: "rec", label: C.band },
  ];
  return (
    <section aria-labelledby={`${id}-h`} className="min-w-0">
      <ChartHeader id={id} title={title} term={term} summary={summary} prov={chart.provenance} />
      <VariantFan
        lines={lines}
        format={format}
        tickFormat={tickFormat}
        ariaLabel={`${title}: ${format(ppp[0]!)} in ${chart.years[0]}, ${format(ppp[n]!)} in ${chart.years[n]} in the principal projection; variants range from ${rangeText(chart.range[n]!, format)}.`}
      />
      <FanKey items={key} />
      <ChartTable id={`${id}-table`} chartId={chartId} label={`${title}, by year`}>
        <table className="w-full border-collapse whitespace-nowrap text-sm tabular-nums">
          <caption className="sr-only">{title}, by year</caption>
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] text-muted">
              <Th>{C.tableYear}</Th>
              <Th right>{C.principal}</Th>
              {selected && <Th right>{selected.label}</Th>}
              <Th right>{C.tableRange}</Th>
            </tr>
          </thead>
          <tbody>
            {chart.years.map((y, i) => (
              <tr key={y} className="border-b border-line">
                <td className="py-2 pr-4">{y}</td>
                <td className="py-2 pr-4 text-right">{format(ppp[i]!)}</td>
                {selected && <td className="py-2 pr-4 text-right">{sel ? format(sel[i]!) : ""}</td>}
                <td className="py-2 pr-4 text-right text-muted">{rangeText(chart.range[i]!, format)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartTable>
    </section>
  );
}

function VitalBlock({ births, deaths, selected }: { births: VitalChart; deaths: VitalChart; selected: Variant | null }) {
  const line = (id: string, label: string, tone: "rec" | "spend", c: VitalChart): FanLine => {
    const sel = selected ? c.variants[selected.code] : undefined;
    return { id, label, tone, years: c.years, range: c.range, principal: c.variants.ppp!, past: c.past, selected: sel && selected ? { label: selected.label, values: sel } : null };
  };
  const lines = [line("births", C.births, "rec", births), line("deaths", C.deaths, "spend", deaths)];
  const n = births.years.length - 1;
  const crossover = births.years.find((y, i) => deaths.variants.ppp![deaths.years.indexOf(y)]! > births.variants.ppp![i]!);
  const lastPast = births.past.years.length - 1;
  const summary = (
    <>
      <b className="font-semibold tabular-nums">{peopleFmt(births.past.values[lastPast]!)}</b> births and{" "}
      <b className="font-semibold tabular-nums">{peopleFmt(deaths.past.values[deaths.past.values.length - 1]!)}</b> deaths in the year to mid-{births.past.years[lastPast]}.
      {crossover ? ` In the principal projection deaths outnumber births from ${crossover}, and by ${births.years[n]} there are ${peopleFmt(deaths.variants.ppp![n]!)} deaths to ${peopleFmt(births.variants.ppp![n]!)} births.` : ""}
    </>
  );
  const key: KeyItem[] = [
    { kind: "line", tone: "rec", label: C.births },
    { kind: "line", tone: "spend", label: C.deaths },
    ...(selected ? [{ kind: "dash" as const, tone: "rec" as const, label: selected.label }] : []),
    { kind: "band", tone: "rec", label: C.band },
  ];
  const allYears = [...births.past.years, ...births.years];
  const at = (c: VitalChart, y: number) => {
    const p = c.past.years.indexOf(y);
    if (p >= 0) return { value: c.past.values[p]!, range: null, sel: null };
    const i = c.years.indexOf(y);
    return { value: c.variants.ppp![i]!, range: c.range[i]!, sel: selected ? c.variants[selected.code]?.[i] ?? null : null };
  };
  return (
    <section aria-labelledby="vital-h" className="min-w-0">
      <ChartHeader id="vital" title={C.vitalTitle} term={C.vitalTerm} summary={summary} prov={births.provenance} />
      <div className="max-w-[600px]">
        <VariantFan
          lines={lines}
          format={thousandsShort}
          tickFormat={thousandsShort}
          marginLeft={48}
          ariaLabel={`${C.vitalTitle}. ${births.past.years[0]} to ${births.past.years[lastPast]}: ONS estimates. Then the principal projection${crossover ? `, in which deaths outnumber births from ${crossover}` : ""}: ${peopleFmt(deaths.variants.ppp![n]!)} deaths and ${peopleFmt(births.variants.ppp![n]!)} births in ${births.years[n]}.`}
        />
      </div>
      <FanKey items={key} />
      <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 text-caption text-muted">
        <span>{C.pastThenProjected}</span>
        <Provenance p={births.past.provenance!} align="start" />
      </p>
      <ChartTable id="vital-table" chartId="people_births" label={`${C.vitalTitle}, by year`}>
        <table className="w-full border-collapse whitespace-nowrap text-sm tabular-nums">
          <caption className="sr-only">{C.vitalTitle}, by year</caption>
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] text-muted">
              <Th>{C.tableYear}</Th>
              <Th right>{C.births}</Th>
              {selected && <Th right>{`${C.births}, ${selected.label}`}</Th>}
              <Th right>{`${C.births}, ${C.tableRange.toLowerCase()}`}</Th>
              <Th right>{C.deaths}</Th>
              {selected && <Th right>{`${C.deaths}, ${selected.label}`}</Th>}
              <Th right>{`${C.deaths}, ${C.tableRange.toLowerCase()}`}</Th>
            </tr>
          </thead>
          <tbody>
            {allYears.map((y) => {
              const b = at(births, y);
              const d = at(deaths, y);
              return (
                <tr key={y} className="border-b border-line">
                  <td className="py-2 pr-4">{y}</td>
                  <td className="py-2 pr-4 text-right">{peopleFmt(b.value)}</td>
                  {selected && <td className="py-2 pr-4 text-right">{b.sel !== null ? peopleFmt(b.sel) : ""}</td>}
                  <td className="py-2 pr-4 text-right text-muted">{b.range ? rangeText(b.range, peopleFmt) : C.estimate}</td>
                  <td className="py-2 pr-4 text-right">{peopleFmt(d.value)}</td>
                  {selected && <td className="py-2 pr-4 text-right">{d.sel !== null ? peopleFmt(d.sel) : ""}</td>}
                  <td className="py-2 pr-4 text-right text-muted">{d.range ? rangeText(d.range, peopleFmt) : C.estimate}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ChartTable>
    </section>
  );
}

function SpendingBlock({ people, scenarioId, onPick }: { people: PeopleBundle; scenarioId: string; onPick: (id: string) => void }) {
  const s = people.spending;
  const base = s.scenarios[0]!;
  const sc: SpendingScenario | null = scenarioId !== BASELINE ? s.scenarios.find((x) => x.id === scenarioId) ?? null : null;
  const xs = s.years.map(fyStart);
  const n = s.years.length - 1;
  const label = (x: number) => shortYear(s.years[xs.indexOf(x)] ?? String(x));
  const lines: FanLine[] = [
    { id: "spending", label: C.spendingTitle, tone: "spend", years: xs, range: s.range, principal: base.values, selected: sc ? { label: sc.label, values: sc.values } : null },
  ];
  const summary = (
    <>
      <b className="font-semibold tabular-nums">{pctGdp(base.values[n]!)}</b> of GDP in {s.years[n]} in the OBR baseline, from {pctGdp(base.values[0]!)} in {s.years[0]}
      {sc ? (
        <>
          ; <b className="font-semibold tabular-nums">{pctGdp(sc.values[n]!)}</b> in the scenario “{sc.label}”
        </>
      ) : null}
      . OBR scenarios range from {rangeText(s.range[n]!, pctGdp)}.
    </>
  );
  const key: KeyItem[] = [
    { kind: "line", tone: "spend", label: C.baseline },
    ...(sc ? [{ kind: "dash" as const, tone: "spend" as const, label: sc.label }] : []),
    { kind: "band", tone: "spend", label: C.scenarioBand },
  ];
  return (
    <section aria-labelledby="spending-h" className="min-w-0">
      <ChartHeader id="spending" title={C.spendingTitle} term={C.spendingTerm} summary={summary} prov={sc ?? base} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="min-w-0">
          <VariantFan
            lines={lines}
            format={pctGdp}
            tickFormat={(x) => `${x}%`}
            xTicks={xs}
            xTickFormat={label}
            ariaLabel={`${C.spendingTitle}: ${pctGdp(base.values[0]!)} in ${s.years[0]}, ${pctGdp(base.values[n]!)} in ${s.years[n]} in the OBR baseline; scenarios range from ${rangeText(s.range[n]!, pctGdp)}.`}
          />
          <FanKey items={key} />
          <p className="m-0 mt-1 text-caption text-muted">{C.spendingPoints}</p>
          <ChartTable id="spending-table" chartId="people_spending" label={`${C.spendingTitle}, by year`}>
            <table className="w-full border-collapse whitespace-nowrap text-sm tabular-nums">
              <caption className="sr-only">{C.spendingTitle}, by year and scenario</caption>
              <thead>
                <tr className="border-b border-line text-left text-[12.5px] text-muted">
                  <Th>{C.tableYear}</Th>
                  {s.scenarios.map((x) => (
                    <Th key={x.id} right>
                      {x.id === BASELINE ? C.baseline : x.label}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.years.map((y, i) => (
                  <tr key={y} className="border-b border-line">
                    <td className="py-2 pr-4">{y}</td>
                    {s.scenarios.map((x) => (
                      <td key={x.id} className={`py-2 pr-4 text-right ${x.id === scenarioId ? "font-semibold text-ink" : ""}`}>
                        {pctGdp(x.values[i]!)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ChartTable>
        </div>
        <fieldset className="m-0 grid min-w-0 content-start gap-1.5 border-0 p-0">
          <legend className="mb-2 p-0 text-body font-semibold text-ink">{C.spendingControl}</legend>
          {s.scenarios.map((x) => (
            <label
              key={x.id}
              className="grid cursor-pointer gap-0.5 rounded-control px-3 py-2 text-label text-muted shadow-[var(--shadow-control)] transition-colors hover:text-ink has-checked:bg-sunk has-checked:text-ink has-checked:shadow-[inset_0_0_0_1.5px_var(--ink)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
            >
              <input type="radio" name="spending" value={x.id} checked={scenarioId === x.id} onChange={() => onPick(x.id)} className="sr-only" />
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{x.id === BASELINE ? C.baseline : x.label}</span>
                <span className="tabular-nums">{pctGdp(x.values[n]!)}</span>
              </span>
              {x.controlled_by && <span className="text-caption text-muted">{CONTROLLED_BY_LABEL[x.controlled_by]}</span>}
            </label>
          ))}
        </fieldset>
      </div>
      <Components people={people} />
    </section>
  );
}

function Components({ people }: { people: PeopleBundle }) {
  const s = people.spending;
  const n = s.years.length - 1;
  return (
    <div className="mt-8 max-w-[640px]">
      <h4 className="m-0 mb-2 text-body font-semibold">{C.componentsTitle}</h4>
      <div role="region" aria-label={C.componentsTitle} tabIndex={0} className="overflow-x-auto">
        <table className="w-full border-collapse whitespace-nowrap text-sm tabular-nums">
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] text-muted">
              <Th>% of GDP</Th>
              <Th right>{s.years[0]}</Th>
              <Th right>{s.years[n]}</Th>
            </tr>
          </thead>
          <tbody>
            {s.components.map((c) => (
              <tr key={c.id} className="border-b border-line">
                <td className="py-2 pr-4">{c.label}</td>
                <td className="py-2 pr-4 text-right">{pctGdp(c.values[0]!)}</td>
                <td className="py-2 pr-4 text-right">{pctGdp(c.values[n]!)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2 pr-4">{C.baseline}</td>
              <td className="py-2 pr-4 text-right">{pctGdp(s.scenarios[0]!.values[0]!)}</td>
              <td className="py-2 pr-4 text-right">{pctGdp(s.scenarios[0]!.values[n]!)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
