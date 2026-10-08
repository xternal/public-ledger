import { backtestSummary } from "@ledger/schema";
import { getForecasts } from "@/lib/data";
import { OG } from "@/lib/og";
import { methodImage } from "@/lib/method-og";
import { BACKTEST_TITLE, dueMonth } from "@/lib/method-copy";
import { grouped } from "@/lib/format";

export const alt = "Public Ledger: forecasts recorded and checked against the official outturn";
export const size = OG.size;
export const contentType = "image/png";

export default async function Image() {
  const { forecasts } = getForecasts();
  const shown = backtestSummary(forecasts.filter((f) => f.recorded_as === "shown"));
  const all = backtestSummary(forecasts);
  return methodImage({
    title: BACKTEST_TITLE,
    figures: [
      { value: grouped(all.recorded), label: "forecasts recorded" },
      { value: grouped(all.scored), label: "checked so far" },
      { value: shown.hit_rate === null ? "–" : `${Math.round(shown.hit_rate * 100)}%`, label: "hit rate" },
    ],
    foot: shown.next_due ? `Next outturn due ${dueMonth(shown.next_due.month)}. Misses are listed, not hidden.` : "Misses are listed, not hidden.",
  });
}
