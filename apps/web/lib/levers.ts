import type { Lever } from "@ledger/schema";
import type { Change } from "@ledger/engine";
import type { Model } from "@ledger/engine";
import { MINUS, fixed, gbp } from "./format";

/** How lever values and changes read in the UI. Shared by the sandbox and the share page (server-safe). */

export const decimalsOf = (step: number) => (Number.isInteger(step) ? 0 : (String(step).split(".")[1]?.length ?? 0));

/** Decimals to show: enough for the step and for a published base like 52.95p. */
const decimalsFor = (lever: Lever) => Math.max(decimalsOf(lever.step), decimalsOf(lever.base));

/** "20%", "2.3%", "3.75%", "+7%", "£12,570", "52.95p" */
export function leverValueText(lever: Lever, v: number): string {
  if (lever.unit === "gbp") return gbp(v);
  const s = fixed(v, decimalsFor(lever));
  if (lever.unit === "pence") return `${s}p`;
  if (lever.unit === "pct") return `${v > 0 ? "+" : ""}${s}%`;
  return `${s}%`;
}

/** "+2pp", "+1.2pp of GDP", "+7%", "+£500", "+2p a litre" */
export function leverDeltaText(lever: Lever, d: number): string {
  const sign = d > 0 ? "+" : MINUS;
  if (lever.unit === "gbp") return `${sign}${gbp(Math.abs(d))}`;
  const s = fixed(Math.abs(d), decimalsOf(lever.step));
  if (lever.unit === "pence") return `${sign}${s}p a litre`;
  if (lever.unit === "pct") return `${sign}${s}%`;
  if (lever.unit === "pct_gdp") return `${sign}${s}pp of GDP`;
  return `${sign}${s}pp`;
}


/** "VAT standard rate +2pp", "£2 bus fare cap (England)", "Paid for by: Turn £400m of climate aid into loans" */
export function changeLabel(model: Model, c: Change): string {
  const lever = model.leverById.get(c.lever_id)!;
  if (c.kind === "measure") return lever.label;
  if (c.kind === "funding") {
    const option = lever.funding_options?.find((f) => f.id === c.funding_id);
    return `Paid for by: ${option?.label.replace(/ \(.*\)$/, "") ?? ""}`;
  }
  return `${lever.label} ${leverDeltaText(lever, c.delta ?? 0)}`;
}
