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

/** "£115bn", "£24.6bn", "£0.45bn": as the site shows billions (apps/web/lib/format.ts gbpBn). */
export function gbpBnText(x: number): string {
  return `${x < 0 ? "−" : ""}£${fmtBn(x)}bn`;
}

const MINUS = "−";
const GBP_PER_MILLION = 1e6;
const GBP_PER_BILLION = 1e9;

/** A contract value: "£395,493", "£12.3m", "£1.2bn"; other currencies keep their code: "1,200 EUR" (apps/web/lib/format.ts money). */
export function moneyText(amount: number, currency = "GBP"): string {
  const a = Math.abs(amount);
  const sign = amount < 0 ? MINUS : "";
  if (currency !== "GBP") return `${sign}${whole.format(a)} ${currency}`;
  if (a >= GBP_PER_BILLION) return `${sign}£${fmtBn(a / GBP_PER_BILLION)}bn`;
  if (a >= GBP_PER_MILLION) return `${sign}£${oneDp.format(a / GBP_PER_MILLION)}m`;
  return `${sign}£${whole.format(Math.round(a))}`;
}

/** "+£7,498", "−£1.2m". */
export const signedMoneyText = (amount: number, currency = "GBP") => `${amount > 0.5 ? "+" : amount < -0.5 ? MINUS : ""}${moneyText(Math.abs(amount), currency)}`;

/** "+6.4%", "−12%". */
export const signedPctText = (x: number) => `${x > 0.05 ? "+" : x < -0.05 ? MINUS : ""}${oneDp.format(Math.abs(x))}%`;

/** Words kept in capitals when a notice's ALL-CAPS name is set in normal case (apps/web/lib/contracts.ts). */
const KEEP_UPPER = new Set(["NHS", "UK", "PV", "EV", "EVC", "LLP", "PLC", "CIC", "BDP", "LED", "GB", "HM", "PCC", "ICB"]);

/** "BRIGHT SPARK ENERGY SOLUTIONS LIMITED" → "Bright Spark Energy Solutions Limited"; mixed-case names are left alone. */
export function displayName(name: string): string {
  if (/[a-z]/.test(name)) return name;
  return name
    .split(/(\s+|-|\/)/)
    .map((w) => (KEEP_UPPER.has(w) || !/[A-Z]/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join("");
}

/** Cards show their contracts once money is committed (apps/web/lib/contracts.ts CONTRACT_STATUSES); alerts follow the page. */
export const CONTRACT_STATUSES: readonly string[] = ["funded", "delivering", "delivered"];
