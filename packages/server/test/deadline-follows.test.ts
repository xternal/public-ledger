import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { loadConfig } from "../src/config";
import { decrypt, encrypt, lookupHash } from "../src/crypto";
import { type Db, testDb } from "../src/db";
import { outboxMailer, type Mailer } from "../src/mail";
import { telegramSender } from "../src/telegram-api";
import { actorsFrom, diffContent, fanOut, partyOf, runComingDue, windowsFor, type AlertContext, type DueCard } from "../src/alerts";
import {
  feedPath,
  handleTelegramUpdate,
  parseFollowRequest,
  parseTarget,
  parseTelegramPayload,
  plainDescribe,
  requestEmailFollow,
  telegramBotApi,
  telegramPayload,
  type BotCall,
  type Target,
} from "../src/follow";

/** Follow a deadline window (PRE_SHIP_REVIEW F9): targets, outcome alerts in UK time, and the monthly "coming due" list. */

const SITE = "https://ledger.test";
const config = loadConfig({ SITE_URL: SITE });
const NEXT3: Target = { kind: "deadline_window", id: "next-3-months" };

let db: Db;
let telegrams: { chatId: string; text: string }[];

beforeEach(async () => {
  db = await testDb();
  telegrams = [];
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

async function subscribe(address: string, targets: [string, string][], o: { channel?: "email" | "telegram"; cadence?: "instant" | "weekly" } = {}) {
  const id = randomUUID();
  const channel = o.channel ?? "email";
  const at = "2026-09-01T09:00:00Z";
  await db.query(
    `INSERT INTO subscription (id, channel, address_enc, address_hash, cadence, consent_text_version, consent_at, confirmed_at, manage_token_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, 'test', $6, $6, 'not-a-real-hash', $6)`,
    [id, channel, encrypt(config.encryptionKey, address), lookupHash(config.lookupPepper, channel, address), o.cadence ?? "instant", at],
  );
  for (const [kind, target] of targets) await db.query("INSERT INTO subscription_target (subscription_id, kind, target_id) VALUES ($1, $2, $3)", [id, kind, target]);
  return id;
}

async function outbox() {
  const rows = await db.query<{ to_enc: string; subject: string; body_text: string }>("SELECT to_enc, subject, body_text FROM mail_outbox ORDER BY id");
  return rows.map((r) => ({ to: decrypt(config.encryptionKey, r.to_enc), subject: r.subject, text: r.body_text }));
}

// ---------------------------------------------------------------- targets

describe("deadline-window targets", () => {
  it("parse, round-trip through Telegram and name their feed", () => {
    expect(parseTarget({ kind: "deadline_window", id: "next-3-months" })).toEqual(NEXT3);
    expect(parseTarget({ kind: "deadline_window", id: "this-month" })).toEqual({ kind: "deadline_window", id: "this-month" });
    expect(parseTarget({ kind: "deadline_window", id: "next-5-years" })).toBeNull();
    expect(parseTarget({ kind: "deadline_window", id: "*" })).toBeNull();
    expect(telegramPayload(NEXT3)).toBe("d_next-3-months");
    expect(parseTelegramPayload("d_next-3-months")).toEqual(NEXT3);
    expect(parseTelegramPayload("d_tomorrow")).toBeNull();
    expect(feedPath(NEXT3)).toBe("/feeds/deadlines/next-3-months.xml");
    expect(plainDescribe(NEXT3)).toBe("Promises due in the next 3 months");
  });

  it("are accepted in a follow request", () => {
    const r = parseFollowRequest({ email: "reader@example.org", targets: [NEXT3], cadence: "instant", altcha: "x" });
    expect(r).toEqual({ ok: true, value: { email: "reader@example.org", targets: [NEXT3], cadence: "instant", altcha: "x" } });
    expect(parseFollowRequest({ email: "reader@example.org", targets: [{ kind: "deadline_window", id: "soon" }], cadence: "instant", altcha: "x" })).toEqual({ ok: false, field: "targets" });
  });

  it("are stored by email and by the bot, and counted without any window or promise id", async () => {
    const sent: { to: string; text: string }[] = [];
    const mail: Mailer = { send: async (m) => void sent.push({ to: m.to, text: m.text }) };
    await requestEmailFollow({ db, config, mail, now: new Date("2026-10-08T09:00:00Z") }, { email: "reader@example.org", targets: [NEXT3], cadence: "instant" });
    expect(sent[0]!.text).toContain("- Promises due in the next 3 months");

    const calls: BotCall[] = [];
    const bot = {
      db,
      config,
      now: new Date("2026-10-08T09:00:00Z"),
      isKnown: () => true,
      sender: telegramSender(config, telegrams),
      bot: telegramBotApi(config, calls),
    };
    const chat = { id: 4242, type: "private" };
    await handleTelegramUpdate(bot, { update_id: 1, message: { message_id: 1, date: 0, chat, text: "/start d_next-3-months" } });
    expect(calls[0]).toMatchObject({ method: "sendMessage", buttons: [[{ text: "Follow", data: "d_next-3-months" }]] });
    await handleTelegramUpdate(bot, { update_id: 2, callback_query: { id: "cb1", from: { id: 4242 }, data: "d_next-3-months", message: { message_id: 2, chat } } });
    expect(telegrams.at(-1)!.text).toContain("You now follow Promises due in the next 3 months.");

    const kinds = await db.query<{ kind: string; target_id: string }>("SELECT kind, target_id FROM subscription_target ORDER BY kind");
    expect(kinds).toEqual([
      { kind: "deadline_window", target_id: "next-3-months" },
      { kind: "deadline_window", target_id: "next-3-months" },
    ]);
    const usage = await db.query<{ prop_value: string }>("SELECT DISTINCT prop_value FROM usage_daily");
    expect(usage.map((u) => u.prop_value).sort()).toEqual(["", "deadline_window", "email", "telegram"]);
  });
});

// ---------------------------------------------------------------- outcome alerts

const actorFiles = new Map([["content/actors/andy-burnham.yaml", stringify({ id: "andy-burnham", name: "Andy Burnham", kind: "person", party_id: "labour" })]]);
const actors = actorsFrom(actorFiles);

function card(over: Record<string, unknown>) {
  return {
    id: "uk-bus-cap-2-2026",
    actor_id: "andy-burnham",
    made_on: "2026-07-22",
    policy_area: "economic_affairs",
    status: "in_plan",
    deadline: "2026-10-31",
    versions: [{ version: 1, text: "A £2 cap on bus fares.", recorded_on: "2026-07-22" }],
    events: [{ date: "2026-07-22", type: "promised", text: "Announced" }],
    replies: [],
    ...over,
  };
}
const files = (c: object) => new Map([["content/promises/uk-bus-cap-2-2026.yaml", stringify(c)]]);
const diff = (before: object, after: object) => diffContent(files(before), files(after), { commit: "c0ffee1", siteUrl: SITE, actors });
const missed = (c: ReturnType<typeof card>, date: string) => ({ ...c, events: [...c.events, { date, type: "deadline_missed", text: "The deadline passed with no evidence of delivery recorded.", auto: true }] });
const delivered = (c: ReturnType<typeof card>, date: string) => ({ ...c, status: "delivered", events: [...c.events, { date, type: "delivered", text: "Cap in force", evidence_url: "https://www.gov.uk/bus" }] });

function ctx(now: Date, over: Partial<AlertContext> = {}): AlertContext {
  return { db, config, mailer: outboxMailer(db, config), telegram: telegramSender(config, telegrams), partyOf: (id) => partyOf(actors, id), now, ...over };
}

describe("deadline-window alerts", () => {
  it("fire only for outcomes: delivered and deadline passed, not other changes", () => {
    const due = card({});
    expect(diff(due, delivered(due, "2026-10-20")).map((e) => [e.change_type, e.outcome])).toEqual([
      ["status", "delivered"],
      ["event", "delivered"],
    ]);
    expect(diff(due, missed(due, "2026-11-01")).map((e) => [e.change_type, e.outcome])).toEqual([["deadline_missed", "deadline_missed"]]);
    const funded = diff(due, { ...due, status: "funded" });
    expect(funded.map((e) => e.outcome)).toEqual([undefined]);
    expect(windowsFor(funded[0]!, new Date("2026-10-08T09:00:00Z"))).toEqual([]);
  });

  it("reach followers of a deadline at a month's end when it is recorded early the next month (GMT)", async () => {
    const thisMonth = await subscribe("month@example.org", [["deadline_window", "this-month"]]);
    await subscribe("year@example.org", [["deadline_window", "next-12-months"]]);
    await subscribe("other@example.org", [["area", "health"]]);
    const due = card({});
    // 00:30 GMT on 1 November 2026 (the clocks went back on 25 October): November in the UK.
    const report = await fanOut(diff(due, missed(due, "2026-11-01")), ctx(new Date("2026-11-01T00:30:00Z")));
    expect(report).toMatchObject({ emails: 2 });
    const mail = await outbox();
    expect(mail.map((m) => m.to).sort()).toEqual(["month@example.org", "year@example.org"]);
    expect(mail[0]!.text).toContain("Deadline passed (31 October 2026)");
    expect(await db.query("SELECT change_id FROM delivery WHERE subscription_id = $1", [thisMonth])).toHaveLength(1);
  });

  it("use the UK day: 23:30 UTC on 30 September is already October in the UK (BST)", async () => {
    await subscribe("month@example.org", [["deadline_window", "this-month"]]);
    const due = card({ deadline: "2026-10-15" });
    const events = diff(due, delivered(due, "2026-09-30"));
    expect(windowsFor(events[0]!, new Date("2026-09-30T23:30:00Z"))).toEqual(["this-month", "next-3-months", "next-12-months"]);
    // At 22:30 UTC it is still 30 September in the UK: an October deadline is not "this month" yet.
    expect(windowsFor(events[0]!, new Date("2026-09-30T22:30:00Z"))).toEqual(["next-3-months", "next-12-months"]);
    await fanOut(events, ctx(new Date("2026-09-30T23:30:00Z")));
    expect((await outbox()).map((m) => m.to)).toEqual(["month@example.org"]);
  });

  it("leave out early deliveries outside the window, and long-past deadlines", async () => {
    await subscribe("month@example.org", [["deadline_window", "this-month"]]);
    await subscribe("quarter@example.org", [["deadline_window", "next-3-months"]]);
    const later = card({ deadline: "2026-12-24" });
    await fanOut(diff(later, delivered(later, "2026-10-08")), ctx(new Date("2026-10-08T09:00:00Z")));
    expect((await outbox()).map((m) => m.to)).toEqual(["quarter@example.org"]);
    const old = card({ id: "uk-bus-cap-2-2026", deadline: "2026-04-06" });
    const report = await fanOut(diff(old, missed(old, "2026-10-08")), ctx(new Date("2026-10-08T09:00:00Z")));
    expect(report.emails).toBe(0);
  });
});

// ---------------------------------------------------------------- the monthly list

const CARDS: DueCard[] = [
  { id: "uk-mental-health-strategy-2026", deadline: "2026-12-24", status: "promised", title: "Wes Streeting: “A new mental health strategy”" },
  { id: "uk-electricity-vat-2026", deadline: "2026-10-01", status: "delivered", title: "Rachel Reeves: “Cut VAT on electricity”" },
  { id: "uk-bus-cap-2-2026", deadline: "2027-01-01", status: "in_plan", title: "Andy Burnham: “A £2 cap on bus fares”" },
  { id: "uk-overdue-2026", deadline: "2026-11-02", status: "promised", title: "Someone: “Something due on 2 November”" },
];

describe("the monthly coming-due list", () => {
  const firstMonday = new Date("2026-11-02T07:00:00Z"); // 07:00 GMT, Monday 2 November 2026

  it("goes to each deadline-window follower once a month, for the widest window they follow", async () => {
    await subscribe("both@example.org", [["deadline_window", "this-month"], ["deadline_window", "next-3-months"]]);
    await subscribe("weekly@example.org", [["deadline_window", "next-3-months"]], { cadence: "weekly" });
    await subscribe("5150", [["deadline_window", "next-12-months"]], { channel: "telegram" });
    await subscribe("area@example.org", [["area", "health"]]);

    const report = await runComingDue(ctx(firstMonday), { cards: CARDS, commit: "c0ffee1" });
    expect(report).toEqual({ subscriptions: 3, emails: 2, telegrams: 1, failed: 0 });
    const mail = await outbox();
    expect(mail.map((m) => m.to).sort()).toEqual(["both@example.org", "weekly@example.org"]);
    const m = mail[0]!;
    expect(m.subject).toBe("Coming due: 3 promises between November 2026 and January 2027");
    expect(m.text).toContain("3 promises on Public Ledger are due between November 2026 and January 2027, nearest deadline first.");
    expect(m.text).toContain(
      "2 November 2026: Someone: “Something due on 2 November” (Promised)\n  https://ledger.test/promise/uk-overdue-2026\n\n24 December 2026: Wes Streeting: “A new mental health strategy” (Promised)",
    );
    expect(m.text).not.toContain("electricity"); // delivered: not coming due
    expect(m.text).toContain("You get this list once a month because you follow “Due in the next 3 months”.");
    expect(m.text).toMatch(/https:\/\/ledger\.test\/follow\/manage\?t=/);
    expect(telegrams[0]!.text).toMatch(/^Coming due between November 2026 and October 2027: 3 promises, nearest first\./);

    // A second run the same month sends nothing.
    expect(await runComingDue(ctx(new Date("2026-11-03T07:00:00Z")), { cards: CARDS, commit: "c0ffee2" })).toMatchObject({ subscriptions: 0, emails: 0 });
    const counted = await db.query<{ prop_key: string; prop_value: string; count: string }>("SELECT prop_key, prop_value, count FROM usage_daily WHERE event = 'alert_sent' ORDER BY prop_key, prop_value");
    expect(counted.map((r) => [r.prop_key, r.prop_value, Number(r.count)])).toEqual([
      ["", "", 3],
      ["change_type", "coming_due", 3],
      ["channel", "email", 2],
      ["channel", "telegram", 1],
    ]);
  });

  it("waits for the first week of a UK month, unless forced, and says nothing when nothing is due", async () => {
    await subscribe("month@example.org", [["deadline_window", "this-month"]]);
    expect(await runComingDue(ctx(new Date("2026-11-09T07:00:00Z")), { cards: CARDS, commit: "c" })).toMatchObject({ skipped: "not_first_week", emails: 0 });
    // 23:30 UTC on 31 October is still October in the UK (GMT): not the first week of November.
    expect(await runComingDue(ctx(new Date("2026-10-31T23:30:00Z")), { cards: CARDS, commit: "c" })).toMatchObject({ skipped: "not_first_week" });
    // Nothing open is due in December's first week list for "this month" except the 24 December strategy.
    expect(await runComingDue(ctx(new Date("2026-12-07T07:00:00Z")), { cards: CARDS, commit: "c" })).toMatchObject({ emails: 1 });
    // January 2027: only the bus cap (1 January).
    expect(await runComingDue(ctx(new Date("2027-01-04T07:00:00Z")), { cards: CARDS, commit: "c" })).toMatchObject({ emails: 1 });
    // February 2027: nothing due this month, so no message at all.
    expect(await runComingDue(ctx(new Date("2027-02-01T07:00:00Z")), { cards: CARDS, commit: "c" })).toMatchObject({ subscriptions: 0, emails: 0 });
    expect(await runComingDue(ctx(new Date("2026-11-20T07:00:00Z")), { cards: CARDS, commit: "c", force: true })).toMatchObject({ emails: 1 });
  });

  it("retries a failed send on the next run", async () => {
    await subscribe("month@example.org", [["deadline_window", "next-3-months"]]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken: Mailer = { send: () => Promise.reject(new Error("down")) };
    expect(await runComingDue(ctx(firstMonday, { mailer: broken }), { cards: CARDS, commit: "c" })).toMatchObject({ failed: 1 });
    expect(await runComingDue(ctx(firstMonday), { cards: CARDS, commit: "c" })).toMatchObject({ emails: 1, failed: 0 });
  });
});
