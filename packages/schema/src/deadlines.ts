/**
 * Deadline windows (PRD F7 "follow a deadline window", PRE_SHIP_REVIEW F9):
 * "tell me what's due". Shared by the site's "Coming up" list, the deadline
 * feeds and the alerts job, so all three agree on what is due when.
 *
 * A window is whole calendar months in UK time, starting with the current
 * month: on 8 October 2026 "next 3 months" covers 1 October to 31 December
 * 2026. Calendar months keep the words exact ("due between October and
 * December") and the monthly "coming due" message lines up with them.
 *
 * Dates are YYYY-MM-DD strings compared as strings; only "today" needs a
 * clock, and it is always the UK date (BST or GMT), never the UTC one.
 */

export const DEADLINE_WINDOWS = ["this-month", "next-3-months", "next-12-months"] as const;
export type DeadlineWindow = (typeof DEADLINE_WINDOWS)[number];

/** How many calendar months each window covers, the current one included. */
export const WINDOW_MONTHS: Record<DeadlineWindow, number> = { "this-month": 1, "next-3-months": 3, "next-12-months": 12 };

export const WINDOW_LABEL: Record<DeadlineWindow, string> = {
  "this-month": "Due this month",
  "next-3-months": "Due in the next 3 months",
  "next-12-months": "Due in the next 12 months",
};

/** Statuses that end a promise's story: nothing is "coming due" once it has one. Mirrors TERMINAL in apps/web/lib/promises.ts. */
export const FINISHED_STATUSES = ["delivered", "failed", "quietly_dropped", "unscoreable"] as const;

/**
 * Alerts also cover the month before the window starts, so the outcome of a
 * deadline at the end of a month still reaches its followers when it is
 * recorded early the next month (the nightly job appends `deadline_missed`
 * the day after a deadline, and the change may be merged days later).
 */
export const ALERT_GRACE_MONTHS = 1;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const isDeadlineWindow = (x: unknown): x is DeadlineWindow => typeof x === "string" && (DEADLINE_WINDOWS as readonly string[]).includes(x);

/** Today's date in UK time as YYYY-MM-DD (en-CA formats dates that way). */
export const ukDay = (now: Date = new Date()): string => now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });

/** Months since year 0, for arithmetic: "2026-10-08" → 2026 × 12 + 9. */
function monthNumber(day: string): number {
  const m = DAY.exec(day);
  if (!m) throw new Error(`not a YYYY-MM-DD date: ${day}`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}

const pad = (n: number) => String(n).padStart(2, "0");
const yearOf = (n: number) => Math.floor(n / 12);
const monthOf = (n: number) => (n % 12) + 1;

function firstDay(n: number): string {
  return `${yearOf(n)}-${pad(monthOf(n))}-01`;
}

function lastDay(n: number): string {
  // Day 0 of the next month is the last day of this one; UTC so no clock change can shift it.
  const days = new Date(Date.UTC(yearOf(n), monthOf(n), 0)).getUTCDate();
  return `${yearOf(n)}-${pad(monthOf(n))}-${pad(days)}`;
}

export interface DayRange {
  /** First day covered, YYYY-MM-DD. */
  from: string;
  /** Last day covered, YYYY-MM-DD. */
  to: string;
}

/** The days a window covers on a UK day: the 1st of this month to the last day of the window's last month. */
export function windowRange(w: DeadlineWindow, today: string): DayRange {
  const n = monthNumber(today);
  return { from: firstDay(n), to: lastDay(n + WINDOW_MONTHS[w] - 1) };
}

/** Whether a deadline falls in a window on a UK day. No deadline is never due. */
export function isDueIn(deadline: string | null | undefined, w: DeadlineWindow, today: string): boolean {
  if (!deadline || !DAY.test(deadline)) return false;
  const r = windowRange(w, today);
  return deadline >= r.from && deadline <= r.to;
}

/**
 * The windows whose followers hear about an outcome (delivered, deadline
 * passed) of a promise with this deadline, on a UK day: the deadline falls
 * in the window, or in the grace month before it.
 */
export function alertWindows(deadline: string | null | undefined, today: string): DeadlineWindow[] {
  if (!deadline || !DAY.test(deadline)) return [];
  const from = firstDay(monthNumber(today) - ALERT_GRACE_MONTHS);
  return DEADLINE_WINDOWS.filter((w) => deadline >= from && deadline <= windowRange(w, today).to);
}

/** "October 2026", "October to December 2026", "December 2026 to February 2027". */
export function windowWords(w: DeadlineWindow, today: string): string {
  const n = monthNumber(today);
  const end = n + WINDOW_MONTHS[w] - 1;
  const name = (m: number) => MONTH_NAMES[monthOf(m) - 1]!;
  if (end === n) return `${name(n)} ${yearOf(n)}`;
  if (yearOf(end) === yearOf(n)) return `${name(n)} to ${name(end)} ${yearOf(n)}`;
  return `${name(n)} ${yearOf(n)} to ${name(end)} ${yearOf(end)}`;
}

/** "in October 2026", "between October and December 2026", "between December 2026 and February 2027": for "due …". */
export function windowPhrase(w: DeadlineWindow, today: string): string {
  const words = windowWords(w, today);
  if (WINDOW_MONTHS[w] === 1) return `in ${words}`;
  return `between ${words.replace(" to ", " and ")}`;
}

/** "2026-10" for a UK day: the month a monthly "coming due" message belongs to. */
export const monthKey = (today: string): string => today.slice(0, 7);

/** Open promises due in a window, nearest deadline first (ties by id). Finished ones are left out. */
export function dueInWindow<T extends { id: string; deadline?: string | null; status: string }>(items: readonly T[], w: DeadlineWindow, today: string): T[] {
  const finished = new Set<string>(FINISHED_STATUSES);
  return items
    .filter((c) => !finished.has(c.status) && isDueIn(c.deadline, w, today))
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!) || a.id.localeCompare(b.id));
}

/** Of the windows someone follows, the one that covers the most (one monthly message, not one per window). */
export function widestWindow(windows: readonly DeadlineWindow[]): DeadlineWindow | null {
  return [...windows].sort((a, b) => WINDOW_MONTHS[b] - WINDOW_MONTHS[a])[0] ?? null;
}
