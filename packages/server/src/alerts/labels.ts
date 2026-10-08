/**
 * Reader-facing words for alerts and feeds. These mirror apps/web/lib/copy.ts
 * and apps/web/lib/promises.ts (the server package cannot import the web app);
 * keep them in step when the site's labels change.
 */

export const STATUS_LABEL: Record<string, string> = {
  promised: "Promised",
  in_plan: "In plan",
  legislated: "Legislated",
  funded: "Funded",
  delivering: "Delivering",
  delivered: "Delivered",
  failed: "Not met",
  quietly_dropped: "Undone",
  unscoreable: "Unscoreable",
};

export const EVENT_LABEL: Record<string, string> = {
  promised: "Promised",
  reworded: "Reworded",
  in_plan: "In plan",
  legislated: "Legislated",
  funded: "Funded",
  delivering: "Delivering",
  delivered: "Delivered",
  failed: "Not met",
  deadline: "Deadline",
  deadline_missed: "Deadline passed",
  reply: "Reply",
};

export const AREA_LABEL: Record<string, string> = {
  taxes: "Taxes",
  social_protection: "Social protection",
  health: "Health",
  education: "Education",
  economic_affairs: "Transport & economy",
  defence: "Defence",
  public_order: "Police, courts, prisons",
  general_services: "Running government",
  housing_env: "Housing & environment",
  culture: "Culture & sport",
};

export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
export const eventLabel = (t: string) => EVENT_LABEL[t] ?? t;
export const areaLabel = (a: string) => AREA_LABEL[a] ?? a;

/** "6 October 2026" for a YYYY-MM-DD date or an ISO timestamp, in UK time. */
export function ukDate(iso: string | Date): string {
  const d = typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
}

/** Today's date in UK time as YYYY-MM-DD. */
export const ukToday = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

const twoDp = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const oneDp = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const fmtBn = (x: number) => {
  const a = Math.abs(x);
  return (a >= 100 ? whole : a >= 1 ? oneDp : twoDp).format(a);
};

/**
 * "Costs £0.36bn to £0.44bn a year" or "Raises £10bn to £15bn a year"; cards store
 * cost to the public purse, so a negative range raises money (as on the site).
 */
export function costRangeText(r: readonly number[] | null | undefined): string {
  if (!r || r.length !== 3) return "Cost not stated";
  const [low, central, high] = r as [number, number, number];
  const raises = central < 0;
  const abs = [Math.abs(low), Math.abs(high)].sort((a, b) => a - b) as [number, number];
  return `${raises ? "Raises" : "Costs"} £${fmtBn(abs[0])}bn to £${fmtBn(abs[1])}bn a year`;
}
