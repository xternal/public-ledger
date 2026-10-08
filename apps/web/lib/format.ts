import type { Range } from "@ledger/schema";

/** Typographic minus, used for every negative number in the UI. */
export const MINUS = "−";

const BN_PER_GBP = 1e9;
const PEOPLE_PER_MILLION = 1e6;
const PERCENT = 100;
/** Below this, a change is shown as no change. */
const NOISE = 1e-4;

const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const oneDp = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const twoDp = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

const withMinus = (s: string) => s.replace("-", MINUS);

/** 1,368 for big numbers, 24.5 for mid-sized ones, 0.45 under £1bn (a bus cap must not round to £0.5bn). */
export const fmtBn = (x: number) => {
  const a = Math.abs(x);
  return withMinus((a >= PERCENT ? whole : a >= 1 ? oneDp : twoDp).format(x));
};
export const gbpBn = (x: number) => (x < 0 ? MINUS : "") + `£${fmtBn(Math.abs(x))}bn`;
export const gbpTn = (bn: number) => `£${oneDp.format(bn / 1000)}tn`;
export const gbp = (x: number) => (x < -0.5 ? MINUS : "") + `£${whole.format(Math.abs(Math.round(x)))}`;
export const fixed = (x: number, dp: number) => withMinus(x.toFixed(dp));
export const millions = (m: number) => `${oneDp.format(m)}m`;
export const grouped = (x: number) => whole.format(x);

export const signOf = (x: number, noise = NOISE) => (x > noise ? "+" : x < -noise ? MINUS : "");
export const signed = (x: number, f: (abs: number) => string, noise = NOISE) => signOf(x, noise) + f(Math.abs(x));
export const signedBn = (x: number) => signed(x, (a) => `£${fmtBn(a)}bn`);

/** "+£0.45bn to +£0.6bn" */
export const rangeText = (r: Range, f: (x: number) => string) => `${f(r[0])} to ${f(r[2])}`;

export const direction = (x: number, noise = NOISE): "up" | "down" | "flat" =>
  x > noise ? "up" : x < -noise ? "down" : "flat";

/** UI units for the statement (PRD F1). */
export type Unit = "bn" | "hh" | "p";

export interface UnitContext {
  households_m: number;
  /** Total spending, the denominator for "pence per £1". */
  total_bn: number;
}

export const perHousehold = (bn: number, households_m: number) => (bn * BN_PER_GBP) / (households_m * PEOPLE_PER_MILLION);

export function inUnit(bn: number, unit: Unit, ctx: UnitContext): string {
  if (unit === "hh") return gbp(perHousehold(bn, ctx.households_m));
  if (unit === "p") return `${fixed((bn / ctx.total_bn) * PERCENT, 1)}p`;
  return gbpBn(bn);
}

export function deltaInUnit(bn: number, unit: Unit, ctx: UnitContext): string {
  if (unit === "hh") return signed(perHousehold(bn, ctx.households_m), (a) => gbp(a), 0.5);
  if (unit === "p") return signed((bn / ctx.total_bn) * PERCENT, (a) => `${a.toFixed(2)}p`);
  return signedBn(bn);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y!, m: MONTHS[(m ?? 1) - 1]!, d: d ?? 1 };
};

/** "22 Jul 2026" (fixed three-letter months; some ICU builds print "Sept") */
export const longDate = (iso: string) => {
  const { y, m, d } = parts(iso);
  return `${d} ${m} ${y}`;
};

/** "Jul 2026" */
export const monthYear = (iso: string) => {
  const { y, m } = parts(iso);
  return `${m} ${y}`;
};

/** "2026-27" → "26/27" for tight axes. */
export const shortYear = (fy: string) => fy.slice(2).replace("-", "/");

export const shareOf = (part: number, whole_: number) => (part / whole_) * PERCENT;

const GBP_PER_MILLION = 1e6;
const GBP_PER_BILLION = 1e9;

/** A contract value in pounds: "£395,493", "£12.3m", "£1.2bn". Other currencies keep their code: "1,200 EUR". */
export function money(amount: number, currency = "GBP"): string {
  const a = Math.abs(amount);
  const sign = amount < 0 ? MINUS : "";
  if (currency !== "GBP") return `${sign}${whole.format(a)} ${currency}`;
  if (a >= GBP_PER_BILLION) return `${sign}£${fmtBn(a / GBP_PER_BILLION)}bn`;
  if (a >= GBP_PER_MILLION) return `${sign}£${oneDp.format(a / GBP_PER_MILLION)}m`;
  return `${sign}£${whole.format(Math.round(a))}`;
}

/** "+£54,507", "−£1.2m"; no sign for no change. */
export const signedMoney = (amount: number, currency = "GBP") => signOf(amount, 0.5) + money(Math.abs(amount), currency);

/** "+13.8%" */
export const signedPct = (x: number) => signed(x, (a) => `${oneDp.format(a)}%`, 0.05);
