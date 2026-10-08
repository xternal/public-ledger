import { truncate, ukDate } from "./labels";

/**
 * Alert and digest wording. Plain text, no tracking, and every email carries
 * the manage link and the one-click unsubscribe link (PRIVACY_AND_ACCOUNTS.md).
 */

export interface MessageEvent {
  /** Null for changes that belong to no card (a new edition of the headline figures). */
  promise_id: string | null;
  summary: string;
  url: string;
  /** Card heading; falls back to the promise id, or to a heading for the kind of change. */
  title?: string;
  change_type?: string;
}

/** Headings for changes that belong to no card. */
const GROUP_TITLE: Record<string, string> = {
  edition: "The Statement: new official figures",
  coming_due: "Coming due",
};

export interface ManageLinks {
  manageUrl: string;
  unsubscribeUrl: string;
}

/** Follow builder's URL conventions (brief: shared conventions). */
export function manageLinks(siteUrl: string, manageToken: string): ManageLinks {
  const site = siteUrl.replace(/\/$/, "");
  const t = encodeURIComponent(manageToken);
  return { manageUrl: `${site}/follow/manage?t=${t}`, unsubscribeUrl: `${site}/api/follow/unsubscribe?t=${t}` };
}

interface Group {
  title: string;
  url: string;
  lines: string[];
}

/** One block per card (or per kind of change that belongs to no card), in the order the changes arrived. */
export function groupByCard(events: MessageEvent[]): Group[] {
  const groups = new Map<string, Group>();
  for (const e of events) {
    const key = e.promise_id ?? `~${e.change_type ?? ""}:${e.url}`;
    const fallback = e.promise_id ?? GROUP_TITLE[e.change_type ?? ""] ?? "Public Ledger";
    const g = groups.get(key) ?? { title: e.title || fallback, url: e.url, lines: [] };
    if (!g.lines.includes(e.summary)) g.lines.push(e.summary);
    groups.set(key, g);
  }
  return [...groups.values()];
}

function blocks(events: MessageEvent[]): string {
  return groupByCard(events)
    .map((g) => [g.title, ...g.lines.map((l) => `  - ${l}`), `  ${g.url}`].join("\n"))
    .join("\n\n");
}

/** Every email ends with the subscription's manage and one-click unsubscribe links. */
export function footer(links: ManageLinks): string {
  return [
    "--",
    "Change what you follow, switch to a weekly digest, or delete your data:",
    links.manageUrl,
    "",
    "Stop all alerts with one click:",
    links.unsubscribeUrl,
    "",
    "Keep these links to yourself: anyone who has them can change your alerts.",
    "Public Ledger sends plain-text email with no tracking, never shows who follows what, and never shares or sells its lists.",
  ].join("\n");
}

export function alertEmail(events: MessageEvent[], links: ManageLinks): { subject: string; text: string } {
  const cards = groupByCard(events);
  const subject =
    events.length === 1
      ? truncate(`${events[0]!.summary} | ${cards[0]!.title}`, 140)
      : cards.length === 1
        ? truncate(`${events.length} changes: ${cards[0]!.title}`, 140)
        : `${events.length} changes to ${events.every((e) => e.promise_id) ? "promises" : "what"} you follow`;
  const onCards = events.every((e) => e.promise_id);
  const intro = !onCards
    ? "Something you follow on Public Ledger has changed."
    : cards.length === 1
      ? "A promise you follow on Public Ledger has changed."
      : "Promises you follow on Public Ledger have changed.";
  return { subject, text: [intro, "", blocks(events), "", footer(links)].join("\n") };
}

export function digestEmail(events: MessageEvent[], links: ManageLinks, now = new Date()): { subject: string; text: string } {
  const n = events.length;
  const subject = `Your weekly Public Ledger digest: ${n} ${n === 1 ? "change" : "changes"}`;
  const intro = `Changes to ${events.every((e) => e.promise_id) ? "promises" : "what"} you follow, in the week to ${ukDate(now)}.`;
  return { subject, text: [intro, "", blocks(events), "", footer(links)].join("\n") };
}

/** Telegram allows 4,096 characters; we stay well under. Stopping is done in the bot itself. */
export function telegramText(events: MessageEvent[], opts: { digest?: boolean; now?: Date } = {}): string {
  const head = opts.digest ? `Weekly digest, week to ${ukDate(opts.now ?? new Date())}` : null;
  const body = groupByCard(events)
    .map((g) => [g.title, ...g.lines.map((l) => `• ${l}`), g.url].join("\n"))
    .join("\n\n");
  const text = [head, body, "Send /stop to stop these alerts."].filter(Boolean).join("\n\n");
  return text.length <= 3800 ? text : `${text.slice(0, 3700)}…\n\nMore changes on the site. Send /stop to stop these alerts.`;
}

export function submitterEmail(ref: string, url: string, kind: "card" | "evidence"): { subject: string; text: string } {
  const what = kind === "card" ? `Your submission ${ref} became this card:` : `The evidence you sent (${ref}) is now on this card:`;
  return {
    subject: `Your submission ${ref} is on Public Ledger`,
    text: [
      "Thank you.",
      "",
      what,
      url,
      "",
      "Two editors checked it against the original source before it was published.",
      "",
      "This is the last email about this submission. We delete your email address from it once this is sent.",
      "",
      "Public Ledger",
    ].join("\n"),
  };
}
