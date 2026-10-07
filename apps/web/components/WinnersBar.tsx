"use client";

import type { CSSProperties } from "react";
import type { T1Result, WinnerShares } from "@ledger/schema";
import { T1_COPY, WINNER_LABEL, share } from "@/lib/t1-copy";
import { ChartTable } from "./ChartTable";

type Bucket = keyof WinnerShares;

/** Gains on the left, losses on the right, as PolicyEngine draws them. Losses in borrowing orange, gains in green (deltas only). */
const ORDER: Bucket[] = ["gain_more_5", "gain_less_5", "no_change", "lose_less_5", "lose_more_5"];
const FILL: Record<Bucket, string> = {
  gain_more_5: "var(--good)",
  gain_less_5: "color-mix(in srgb, var(--good) 40%, var(--bg))",
  no_change: "var(--line-strong)",
  lose_less_5: "color-mix(in srgb, var(--debt) 42%, var(--bg))",
  lose_more_5: "var(--debt)",
};

/** Segments narrower than this are not drawn (the legend and table still give them). */
const MIN_SEGMENT_PCT = 0.25;

const losing = (s: WinnerShares) => s.lose_less_5 + s.lose_more_5;
const gaining = (s: WinnerShares) => s.gain_less_5 + s.gain_more_5;

function Stack({ s, className }: { s: WinnerShares; className: string }) {
  return (
    <span className={`flex overflow-hidden rounded-[3px] bg-sunk ${className}`} aria-hidden>
      {ORDER.map((b) => {
        const w = s[b] * 100;
        if (w < MIN_SEGMENT_PCT) return null;
        const style: CSSProperties = { width: `${w}%`, background: FILL[b] };
        return <i key={b} className="block h-full shrink-0 not-last:border-r not-last:border-bg" style={style} />;
      })}
    </span>
  );
}

const Swatch = ({ b }: { b: Bucket }) => <i className="size-2.5 shrink-0 rounded-[2px]" style={{ background: FILL[b] }} aria-hidden />;

/** Share of households gaining or losing: one bar for everyone, then one compact bar per income decile. */
export function WinnersBar({ winners }: { winners: T1Result["winners"] }) {
  const { all, by_decile } = winners;
  return (
    <div className="min-w-0">
      <p className="mb-3 text-label font-medium text-ink">{T1_COPY.winnersTitle}</p>
      <p className="mb-1.5 text-caption text-muted">{T1_COPY.winnersAll}</p>
      <Stack s={all} className="h-6" />
      <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-x-6 gap-y-1 p-0 text-[13px] min-[420px]:grid-cols-2" aria-label={T1_COPY.winnersAll}>
        {ORDER.map((b) => (
          <li key={b} className="flex items-center justify-between gap-3 border-b border-line py-1">
            <span className="inline-flex items-center gap-2 text-muted">
              <Swatch b={b} />
              {WINNER_LABEL[b]}
            </span>
            <span className="font-medium">{share(all[b])}</span>
          </li>
        ))}
      </ul>

      <p className="mb-1.5 mt-5 text-caption text-muted">{T1_COPY.winnersByDecile}</p>
      <div
        className="grid gap-1"
        role="img"
        aria-label={`By income decile. Households losing income: ${share(losing(by_decile[0]!))} in decile 1 (lowest incomes), ${share(losing(by_decile[9]!))} in decile 10 (highest). Households gaining: ${share(gaining(by_decile[0]!))} and ${share(gaining(by_decile[9]!))}.`}
      >
        {by_decile.map((s, i) => (
          <div key={i} className="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-2 text-caption text-muted">
            <span className="text-right">{i + 1}</span>
            <Stack s={s} className="h-3" />
          </div>
        ))}
      </div>
      <ChartTable id="t1-winners-table" chartId="t1_winners" label={T1_COPY.winnersTitle}>
        <table className="w-full border-collapse whitespace-nowrap text-sm">
          <caption className="sr-only">{T1_COPY.winnersTitle}</caption>
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] text-muted">
              <th scope="col" className="py-2 pr-4 font-medium">
                Households
              </th>
              {ORDER.map((b) => (
                <th key={b} scope="col" className="py-2 pr-4 text-right font-medium last:pr-0">
                  {WINNER_LABEL[b]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[all, ...by_decile].map((s, i) => (
              <tr key={i} className="border-b border-line">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {i === 0 ? T1_COPY.winnersAll : `Decile ${i}${i === 1 ? " (lowest)" : i === 10 ? " (highest)" : ""}`}
                </th>
                {ORDER.map((b) => (
                  <td key={b} className="py-2 pr-4 text-right last:pr-0">
                    {share(s[b])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ChartTable>
    </div>
  );
}
