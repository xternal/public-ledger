import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml, stringify } from "yaml";
import { ActorFile, PromiseFile, cardViews } from "@ledger/schema";
import { loadConfig } from "../src/config";
import { decrypt, encrypt, lookupHash } from "../src/crypto";
import { type Db, testDb } from "../src/db";
import { outboxMailer, type MailMessage, type Mailer } from "../src/mail";
import { telegramSender } from "../src/telegram-api";
import { rateLimit } from "../src/spam";
import {
  actorsFrom,
  buildFeed,
  diffContent,
  fanOut,
  partyOf,
  processChanges,
  runDigest,
  runMaintenance,
  snapshotsFor,
  type AlertContext,
  type ChangeEvent,
  type GitRunner,
} from "../src/alerts";

const SITE = "https://ledger.test";
const config = loadConfig({ SITE_URL: SITE });
const T0 = new Date("2026-10-06T09:00:00Z");
const DAY = 86_400_000;

// ---------------------------------------------------------------- fixtures

const ACTORS = {
  "keir-starmer": { id: "keir-starmer", name: "Keir Starmer", kind: "person", party_id: "labour", roles: [{ title: "Prime Minister", from: "2024-07-05" }] },
  labour: { id: "labour", name: "Labour Party", kind: "party", roles: [] },
  "andy-burnham": { id: "andy-burnham", name: "Andy Burnham", kind: "person", party_id: "labour", roles: [{ title: "Prime Minister", from: "2026-07-20" }] },
  "reform-uk": { id: "reform-uk", name: "Reform UK", kind: "party", roles: [] },
};
const actorFiles = new Map(Object.values(ACTORS).map((a) => [`content/actors/${a.id}.yaml`, stringify(a)]));
const actors = actorsFrom(actorFiles);

type Card = Record<string, unknown> & { id: string };
function card(over: Partial<Card> & { id: string }): Card {
  return {
    actor_id: "andy-burnham",
    made_on: "2026-07-22",
    policy_area: "economic_affairs",
    status: "in_plan",
    origin: "manual",
    sources: [{ title: "Press release", url: "https://www.gov.uk/government/news/bus" }],
    versions: [
      {
        version: 1,
        text: "A £2 cap on bus fares for millions across the country.",
        recorded_on: "2026-07-22",
        source_url: "https://www.gov.uk/government/news/bus",
        quote_checked_on: "2026-10-06",
        parameters: { who: "Bus passengers", how_much_bn_per_year: [0.36, 0.4, 0.44], when: "2027", funded_by: "Reprioritised DESNZ budget" },
      },
    ],
    events: [
      { date: "2026-07-22", type: "promised", text: "PM announces a £2 cap" },
      { date: "2026-07-22", type: "in_plan", text: "Written statement names the funding", evidence_url: "https://www.gov.uk/government/speeches/bus" },
    ],
    replies: [],
    ...over,
  };
}
const files = (...cards: Card[]) => new Map(cards.map((c) => [`content/promises/${c.id}.yaml`, stringify(c)]));
const BUS = card({ id: "uk-bus-cap-2-2026" });
const withEvents = (c: Card, ...extra: object[]) => ({ ...c, events: [...(c.events as object[]), ...extra] });
const FUNDED_EVENT = { date: "2026-10-05", type: "funded", text: "Autumn Budget allocates £400m in the Estimates", evidence_url: "https://www.gov.uk/budget-2026" };
const statusChange = () => ({ before: files(BUS), after: files({ ...withEvents(BUS, FUNDED_EVENT), status: "funded" }) });

const diff = (before: Map<string, string>, after: Map<string, string>, commit = "c0ffee1") => diffContent(before, after, { commit, siteUrl: SITE, actors });

// ---------------------------------------------------------------- test plumbing

let db: Db;
let telegrams: { chatId: string; text: string }[];

function captureMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return { sent, send: async (m) => void sent.push(m) };
}

function ctx(over: Partial<AlertContext> = {}): AlertContext {
  return {
    db,
    config,
    mailer: outboxMailer(db, config),
    telegram: telegramSender(config, telegrams),
    partyOf: (id) => partyOf(actors, id),
    now: T0,
    ...over,
  };
}

async function subscribe(o: { channel?: "email" | "telegram"; address: string; cadence?: "instant" | "weekly"; confirmed?: boolean; targets: [string, string][]; createdAt?: Date }) {
  const id = randomUUID();
  const channel = o.channel ?? "email";
  const created = (o.createdAt ?? T0).toISOString();
  await db.query(
    `INSERT INTO subscription (id, channel, address_enc, address_hash, cadence, consent_text_version, consent_at, confirmed_at, manage_token_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, 'test', $6, $7, 'not-a-real-hash', $6)`,
    [id, channel, encrypt(config.encryptionKey, o.address), lookupHash(config.lookupPepper, channel, o.address), o.cadence ?? "instant", created, o.confirmed === false ? null : created],
  );
  for (const [kind, target] of o.targets) await db.query("INSERT INTO subscription_target (subscription_id, kind, target_id) VALUES ($1, $2, $3)", [id, kind, target]);
  return id;
}

async function outbox() {
  const rows = await db.query<{ to_enc: string; subject: string; body_text: string; headers: Record<string, string> }>("SELECT to_enc, subject, body_text, headers FROM mail_outbox ORDER BY id");
  return rows.map((r) => ({ to: decrypt(config.encryptionKey, r.to_enc), subject: r.subject, text: r.body_text, headers: r.headers }));
}

async function usage(event: string, key = "", value = ""): Promise<number> {
  const [r] = await db.query<{ count: string }>("SELECT count FROM usage_daily WHERE event = $1 AND prop_key = $2 AND prop_value = $3", [event, key, value]);
  return Number(r?.count ?? 0);
}

beforeEach(async () => {
  db = await testDb();
  telegrams = [];
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

// ---------------------------------------------------------------- change detection

describe("diffContent", () => {
  it("finds nothing when nothing changed, and ignores deleted cards", () => {
    expect(diff(files(BUS), files(BUS))).toEqual([]);
    expect(diff(files(BUS), new Map())).toEqual([]);
  });

  it("announces a new card, with its submission reference for the submitter update", () => {
    const fresh = card({ id: "uk-free-buses-2026", origin: "reader_submission", submission_ref: "S-2026-10-0001" });
    const [e, ...rest] = diff(files(BUS), files(BUS, fresh));
    expect(rest).toEqual([]);
    expect(e).toMatchObject({
      change_type: "new_card",
      promise_id: "uk-free-buses-2026",
      actor_id: "andy-burnham",
      policy_area: "economic_affairs",
      url: `${SITE}/promise/uk-free-buses-2026`,
      submission_ref: "S-2026-10-0001",
      commit_sha: "c0ffee1",
    });
    expect(e!.summary).toBe("New promise card: Andy Burnham, “A £2 cap on bus fares for millions across the country.”");
    expect(e!.title).toBe("Andy Burnham: “A £2 cap on bus fares for millions across the country.”");
  });

  it("describes a status change and the event that came with it", () => {
    const { before, after } = statusChange();
    const events = diff(before, after);
    expect(events.map((e) => [e.change_type, e.summary])).toEqual([
      ["status", "Status changed: In plan → Funded"],
      ["event", "Funded, 5 October 2026: Autumn Budget allocates £400m in the Estimates"],
    ]);
    expect(events[1]!.evidence_url).toBe("https://www.gov.uk/budget-2026");
  });

  it("gives an automatic deadline_missed event its own type", () => {
    const due = { ...BUS, deadline: "2026-10-01" };
    const missed = withEvents(due, { date: "2026-10-02", type: "deadline_missed", text: "The deadline passed with no evidence of delivery recorded.", auto: true });
    const [e] = diff(files(due), files(missed));
    expect(e!.change_type).toBe("deadline_missed");
    expect(e!.summary).toBe("Deadline passed (1 October 2026): The deadline passed with no evidence of delivery recorded.");
  });

  it("shows a rewording old → new, and a cost change", () => {
    const v1 = (BUS.versions as object[])[0]!;
    const v2 = {
      version: 2,
      text: "A £2.50 cap on bus fares.",
      recorded_on: "2026-10-05",
      source_url: "https://www.gov.uk/government/news/bus-2",
      parameters: { who: "Bus passengers", how_much_bn_per_year: [0.5, 0.6, 0.7], when: "2027", funded_by: null },
    };
    const reworded = { ...BUS, versions: [v1, v2] };
    const events = diff(files(BUS), files(reworded));
    expect(events.map((e) => e.change_type)).toEqual(["version", "cost"]);
    expect(events[0]!.summary).toBe("Reworded: “A £2 cap on bus fares for millions across the country.” → “A £2.50 cap on bus fares.”");
    expect(events[1]!.summary).toBe("Cost changed: now costs £0.5bn to £0.7bn a year, was costs £0.36bn to £0.44bn a year");
  });

  it("announces a published right of reply", () => {
    const replied = { ...BUS, replies: [{ from_actor_id: "keir-starmer", date: "2026-10-05", text: "We will fund it in full." }] };
    const [e] = diff(files(BUS), files(replied));
    expect(e).toMatchObject({ change_type: "reply", summary: "Reply from Keir Starmer: We will fund it in full." });
  });

  it("gives stable ids, so a re-run never duplicates", () => {
    const { before, after } = statusChange();
    const a = diff(before, after, "c0ffee1");
    expect(diff(before, after, "c0ffee1").map((e) => e.id)).toEqual(a.map((e) => e.id));
    expect(new Set(a.map((e) => e.id)).size).toBe(a.length);
    // A status change can recur later (a correction, then the real change): its id includes the commit.
    // A history entry is append-only: the same event in an overlapping range keeps its id.
    const b = diff(before, after, "deadbee");
    expect(b[0]!.id).not.toBe(a[0]!.id);
    expect(b[1]!.id).toBe(a[1]!.id);
    expect(a[0]!.id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("reading content at a commit", () => {
  it("diffs only changed promise files and reads every actor at the new commit", () => {
    const { before, after } = statusChange();
    const tree: Record<string, Map<string, string>> = { aaa: new Map([...before, ...actorFiles]), bbb: new Map([...after, ...actorFiles]) };
    const calls: string[][] = [];
    const git: GitRunner = (args) => {
      calls.push(args);
      const [cmd, ...rest] = args;
      if (cmd === "rev-parse") {
        const ref = rest.at(-1)!.replace("^{commit}", "");
        if (ref in tree) return `${ref}\n`;
        throw new Error("unknown revision");
      }
      if (cmd === "diff") return "content/promises/uk-bus-cap-2-2026.yaml\n";
      if (cmd === "ls-tree") return [...tree[rest[2]!]!.keys()].filter((p) => p.startsWith(rest.at(-1)!)).join("\n");
      if (cmd === "show") {
        const [sha, path] = rest[0]!.split(":");
        const text = tree[sha!]?.get(path!);
        if (text === undefined) throw new Error("missing");
        return text;
      }
      throw new Error(`unexpected git ${args.join(" ")}`);
    };
    const snap = snapshotsFor(git, "aaa", "bbb");
    expect(snap.range).toEqual({ before: "aaa", after: "bbb" });
    expect([...snap.before.keys()]).toEqual(["content/promises/uk-bus-cap-2-2026.yaml"]);
    expect(snap.actors.get("andy-burnham")?.party_id).toBe("labour");
    expect(diffContent(snap.before, snap.after, { commit: "bbb", siteUrl: SITE, actors: snap.actors }).map((e) => e.change_type)).toEqual(["status", "event"]);
    // GitHub's all-zero `before` (new branch) falls back to the parent commit.
    const zero = snapshotsFor((args) => (args[0] === "rev-parse" && args.at(-1) === "bbb^^{commit}" ? "aaa" : git(args)), "0000000000000000000000000000000000000000", "bbb");
    expect(zero.range.before).toBe("aaa");
    expect(calls.every((c) => ["rev-parse", "diff", "ls-tree", "show"].includes(c[0]!))).toBe(true); // read-only git only
  });
});

// ---------------------------------------------------------------- fan-out

describe("fan-out", () => {
  it("matches promise, actor, party, area and all; ignores unconfirmed; queues weekly; one message per subscription", async () => {
    const promise = await subscribe({ address: "promise@example.org", targets: [["promise", "uk-bus-cap-2-2026"]] });
    const actor = await subscribe({ address: "actor@example.org", targets: [["actor", "andy-burnham"]] });
    const party = await subscribe({ channel: "telegram", address: "424242", targets: [["actor", "labour"]] });
    const area = await subscribe({ address: "area@example.org", targets: [["area", "economic_affairs"]] });
    const all = await subscribe({ address: "all@example.org", targets: [["all", "*"]] });
    const both = await subscribe({ address: "both@example.org", targets: [["promise", "uk-bus-cap-2-2026"], ["actor", "labour"]] });
    await subscribe({ address: "unconfirmed@example.org", confirmed: false, targets: [["promise", "uk-bus-cap-2-2026"]] });
    await subscribe({ address: "other@example.org", targets: [["promise", "uk-other-2026"], ["actor", "reform-uk"], ["area", "health"]] });
    const weekly = await subscribe({ address: "weekly@example.org", cadence: "weekly", targets: [["promise", "uk-bus-cap-2-2026"]] });

    const { before, after } = statusChange();
    const events = diff(before, after);
    const report = await fanOut(events, ctx());

    expect(report).toMatchObject({ changes: 2, newChanges: 2, emails: 5, telegrams: 1, queued: 2, failed: 0 });
    const mail = await outbox();
    expect(mail.map((m) => m.to).sort()).toEqual(["actor@example.org", "all@example.org", "area@example.org", "both@example.org", "promise@example.org"]);
    for (const m of mail) {
      expect(m.subject).toBe("2 changes: Andy Burnham: “A £2 cap on bus fares for millions across the country.”");
      expect(m.text).toContain("  - Status changed: In plan → Funded\n  - Funded, 5 October 2026: Autumn Budget allocates £400m in the Estimates\n  https://ledger.test/promise/uk-bus-cap-2-2026");
      expect(m.text).toMatch(/https:\/\/ledger\.test\/follow\/manage\?t=[A-Za-z0-9_-]+/);
      expect(m.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/ledger\.test\/api\/follow\/unsubscribe\?t=[A-Za-z0-9_-]+>$/);
      expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    }
    expect(telegrams).toHaveLength(1);
    expect(telegrams[0]!.chatId).toBe("424242");
    expect(telegrams[0]!.text).toContain("• Status changed: In plan → Funded");

    const rows = await db.query<{ subscription_id: string; status: string }>("SELECT subscription_id, status FROM delivery");
    const status = (id: string) => rows.filter((r) => r.subscription_id === id).map((r) => r.status);
    for (const id of [promise, actor, party, area, all, both]) expect(status(id)).toEqual(["sent", "sent"]);
    expect(status(weekly)).toEqual(["queued_digest", "queued_digest"]);
    expect(rows).toHaveLength(14);

    expect(await usage("alert_sent", "channel", "email")).toBe(10);
    expect(await usage("alert_sent", "channel", "telegram")).toBe(2);
    expect(await usage("alert_sent", "change_type", "status")).toBe(6);
  });

  it("is idempotent: a re-run sends nothing new and stores each change once", async () => {
    await subscribe({ address: "promise@example.org", targets: [["promise", "uk-bus-cap-2-2026"]] });
    const { before, after } = statusChange();
    const events = diff(before, after);
    await fanOut(events, ctx());
    const again = await fanOut(diff(before, after), ctx());
    expect(again).toMatchObject({ newChanges: 0, emails: 0, queued: 0 });
    expect(await outbox()).toHaveLength(1);
    expect(await db.query("SELECT id FROM change_event")).toHaveLength(2);
  });

  it("records a failed send and retries it on the next run", async () => {
    await subscribe({ address: "promise@example.org", targets: [["promise", "uk-bus-cap-2-2026"]] });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken: Mailer = { send: async () => Promise.reject(new Error("SES throttled")) };
    const { before, after } = statusChange();
    const first = await fanOut(diff(before, after), ctx({ mailer: broken }));
    expect(first).toMatchObject({ emails: 0, failed: 1 });
    expect((await db.query<{ status: string }>("SELECT status FROM delivery")).map((r) => r.status)).toEqual(["failed", "failed"]);
    expect(errors.mock.calls.flat().join(" ")).not.toContain("promise@example.org");
    // Provider errors can quote the recipient; logs never carry it.
    vi.mocked(console.error).mockClear();
    const quoting: Mailer = { send: async (m) => Promise.reject(new Error(`MessageRejected: Email address is not verified: ${m.to}`)) };
    await fanOut(diff(files(BUS), files({ ...BUS, status: "funded" }), "c0ffee9"), ctx({ mailer: quoting }));
    expect(errors.mock.calls.flat().join(" ")).toContain("[address]");
    expect(errors.mock.calls.flat().join(" ")).not.toContain("promise@example.org");
    const mail = captureMailer();
    const second = await fanOut(diff(before, after), ctx({ mailer: mail }));
    expect(second).toMatchObject({ emails: 1, failed: 0 });
    expect(mail.sent[0]!.to).toBe("promise@example.org");
    expect(mail.sent[0]!.unsubscribeUrl).toMatch(/\/api\/follow\/unsubscribe\?t=/);
  });

  it("rotates the manage link in every email: the link it carries is the one that works", async () => {
    const id = await subscribe({ address: "promise@example.org", targets: [["promise", "uk-bus-cap-2-2026"]] });
    const { before, after } = statusChange();
    await fanOut(diff(before, after), ctx());
    const [m] = await outbox();
    const token = /manage\?t=([A-Za-z0-9_-]+)/.exec(m!.text)![1]!;
    const { hashToken } = await import("../src/crypto");
    const [row] = await db.query<{ manage_token_hash: string }>("SELECT manage_token_hash FROM subscription WHERE id = $1", [id]);
    expect(row!.manage_token_hash).toBe(hashToken(token));
  });
});

// ---------------------------------------------------------------- digest and maintenance

describe("weekly digest", () => {
  it("sends one message per weekly subscription listing what was queued, then marks it sent", async () => {
    const weekly = await subscribe({ address: "weekly@example.org", cadence: "weekly", targets: [["actor", "labour"]] });
    await subscribe({ channel: "telegram", address: "777", cadence: "weekly", targets: [["area", "economic_affairs"]] });
    const { before, after } = statusChange();
    await fanOut(diff(before, after), ctx());
    const replied = { ...BUS, replies: [{ from_actor_id: "andy-burnham", date: "2026-10-07", text: "Funding is confirmed." }] };
    await fanOut(diff(files(BUS), files(replied), "c0ffee2"), ctx({ now: new Date(T0.getTime() + DAY) }));
    expect(await outbox()).toEqual([]);

    const titles = new Map([["uk-bus-cap-2-2026", "Andy Burnham: “A £2 cap on bus fares”"]]);
    const monday = new Date("2026-10-12T07:00:00Z");
    const report = await runDigest(ctx({ now: monday }), { titles });
    expect(report).toMatchObject({ subscriptions: 2, emails: 1, telegrams: 1, changes: 6, failed: 0 });
    const [m, ...more] = await outbox();
    expect(more).toEqual([]);
    expect(m!.to).toBe("weekly@example.org");
    expect(m!.subject).toBe("Your weekly Public Ledger digest: 3 changes");
    expect(m!.text).toContain("Changes to promises you follow, in the week to 12 October 2026.");
    expect(m!.text).toContain("Andy Burnham: “A £2 cap on bus fares”\n  - Status changed: In plan → Funded\n  - Funded, 5 October 2026");
    expect(m!.text).toContain("  - Reply from Andy Burnham: Funding is confirmed.");
    expect(m!.headers["List-Unsubscribe"]).toContain("/api/follow/unsubscribe?t=");
    expect(telegrams[0]!.text).toMatch(/^Weekly digest, week to 12 October 2026/);
    const statuses = await db.query<{ status: string }>("SELECT status FROM delivery WHERE subscription_id = $1", [weekly]);
    expect(statuses.map((s) => s.status)).toEqual(["sent", "sent", "sent"]);
    expect(await runDigest(ctx({ now: monday }))).toMatchObject({ subscriptions: 0, emails: 0 });
  });

  it("puts changes back in the queue when the digest cannot be sent", async () => {
    await subscribe({ address: "weekly@example.org", cadence: "weekly", targets: [["all", "*"]] });
    const { before, after } = statusChange();
    await fanOut(diff(before, after), ctx());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const report = await runDigest(ctx({ mailer: { send: () => Promise.reject(new Error("down")) } }));
    expect(report.failed).toBe(1);
    expect((await db.query<{ status: string }>("SELECT status FROM delivery")).map((r) => r.status)).toEqual(["queued_digest", "queued_digest"]);
  });
});

describe("maintenance", () => {
  it("deletes deliveries after 35 days, unconfirmed sign-ups after 7, and yesterday's rate-limit state", async () => {
    const sub = await subscribe({ address: "promise@example.org", targets: [["promise", "uk-bus-cap-2-2026"]] });
    await subscribe({ address: "stale@example.org", confirmed: false, targets: [["all", "*"]], createdAt: new Date(T0.getTime() - 8 * DAY) });
    await subscribe({ address: "recent@example.org", confirmed: false, targets: [["all", "*"]], createdAt: new Date(T0.getTime() - 1 * DAY) });
    const { before, after } = statusChange();
    await fanOut(diff(before, after), ctx({ now: new Date(T0.getTime() - 40 * DAY) }));
    const replied = { ...BUS, replies: [{ from_actor_id: "andy-burnham", date: "2026-10-05", text: "Confirmed." }] };
    await fanOut(diff(files(BUS), files(replied), "c0ffee2"), ctx());
    await rateLimit(db, "203.0.113.9", "submit", 3, new Date(T0.getTime() - DAY));

    const report = await runMaintenance(db, T0);
    expect(report).toMatchObject({ deliveries: 2, unconfirmed: 1 });
    expect(await db.query("SELECT change_id FROM delivery WHERE subscription_id = $1", [sub])).toHaveLength(1);
    const left = await db.query<{ address_enc: string }>("SELECT address_enc FROM subscription WHERE confirmed_at IS NULL");
    expect(left.map((r) => decrypt(config.encryptionKey, r.address_enc))).toEqual(["recent@example.org"]);
    expect(await db.query("SELECT * FROM rate_bucket")).toEqual([]);
  });
});

// ---------------------------------------------------------------- submitter updates

describe("submitter updates", () => {
  async function submission(id: string, o: { kind?: "new_promise" | "evidence"; promise_id?: string; url?: string; email?: string | null; status?: string } = {}) {
    await db.query(
      `INSERT INTO submission (id, kind, promise_id, url, url_normalised, contact_email_enc, status, received_at)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
      [id, o.kind ?? "new_promise", o.promise_id ?? null, o.url ?? "https://example.org/speech", o.email === null ? null : encrypt(config.encryptionKey, o.email ?? "reader@example.org"), o.status ?? "accepted", T0.toISOString()],
    );
  }

  it("tells the submitter their submission became a card, marks it merged and deletes the address", async () => {
    await submission("S-2026-10-0001");
    const fresh = card({ id: "uk-free-buses-2026", origin: "reader_submission", submission_ref: "S-2026-10-0001", credit: "busfan" });
    const report = await processChanges(diff(files(BUS), files(BUS, fresh)), ctx());
    expect(report.submitterUpdates).toBe(1);
    const [m] = await outbox();
    expect(m!.to).toBe("reader@example.org");
    expect(m!.subject).toBe("Your submission S-2026-10-0001 is on Public Ledger");
    expect(m!.text).toContain("Your submission S-2026-10-0001 became this card:\nhttps://ledger.test/promise/uk-free-buses-2026");
    const [row] = await db.query<Record<string, unknown>>("SELECT status, resulting_promise_id, contact_email_enc FROM submission");
    expect(row).toEqual({ status: "merged_into", resulting_promise_id: "uk-free-buses-2026", contact_email_enc: null });
    // A re-run does not write again.
    await processChanges(diff(files(BUS), files(BUS, fresh)), ctx());
    expect(await outbox()).toHaveLength(1);
  });

  it("marks evidence merged when its link arrives as an event, and handles a submitter with no email", async () => {
    await submission("S-2026-10-0002", { kind: "evidence", promise_id: "uk-bus-cap-2-2026", url: "https://www.gov.uk/budget-2026" });
    await submission("S-2026-10-0003", { kind: "evidence", promise_id: "uk-bus-cap-2-2026", url: "https://www.gov.uk/budget-2026", email: null, status: "in_review" });
    const { before, after } = statusChange();
    const report = await processChanges(diff(before, after), ctx());
    expect(report.submitterUpdates).toBe(1);
    const [m] = await outbox();
    expect(m!.text).toContain("The evidence you sent (S-2026-10-0002) is now on this card:");
    const rows = await db.query<{ id: string; status: string; resulting_promise_id: string }>("SELECT id, status, resulting_promise_id FROM submission ORDER BY id");
    expect(rows.map((r) => [r.id, r.status, r.resulting_promise_id])).toEqual([
      ["S-2026-10-0002", "merged_into", "uk-bus-cap-2-2026"],
      ["S-2026-10-0003", "merged_into", "uk-bus-cap-2-2026"],
    ]);
  });
});

// ---------------------------------------------------------------- acceptance

describe("acceptance (BUILD_PLAN M3b): a merged status change reaches RSS, email and Telegram", () => {
  it("takes two snapshots, runs the fan-out, and shows the feed entry, the email and the Telegram message", async () => {
    await subscribe({ address: "reader@example.org", targets: [["promise", "uk-bus-cap-2-2026"]] });
    await subscribe({ channel: "telegram", address: "123456789", targets: [["actor", "labour"]] });
    const { before, after } = statusChange();

    // 1. The alerts job on push to main: diff the two commits, fan out.
    const events: ChangeEvent[] = diff(before, after, "abc1234");
    const report = await processChanges(events, ctx());
    expect(report).toMatchObject({ emails: 1, telegrams: 1, failed: 0 });

    // 2. Email, with one-click unsubscribe.
    const [m] = await outbox();
    expect(m!.to).toBe("reader@example.org");
    expect(m!.text).toContain("Status changed: In plan → Funded");
    expect(m!.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/ledger\.test\/api\/follow\/unsubscribe\?t=.+>$/);
    expect(m!.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m!.text).not.toMatch(/<img|utm_|pixel/i);

    // 3. Telegram (captured: no bot token in tests).
    expect(telegrams).toEqual([{ chatId: "123456789", text: expect.stringContaining("• Status changed: In plan → Funded\n• Funded, 5 October 2026") }]);

    // 4. The Atom feed built from the merged content has the new entry first.
    const parsedActors = Object.values(ACTORS).map((a) => ActorFile.parse(a));
    const cards = cardViews([...after.values()].map((t) => PromiseFile.parse(parseYaml(t))), parsedActors);
    const xml = buildFeed(cards, "promise", "uk-bus-cap-2-2026", { siteUrl: SITE, today: "2026-10-06", title: "Public Ledger: £2 bus cap", alternatePath: "/promise/uk-bus-cap-2-2026" });
    const first = xml.split("<entry>")[1]!;
    expect(first).toContain("<title type=\"text\">Funded: Autumn Budget allocates £400m in the Estimates (Andy Burnham)</title>");
    expect(first).toContain("<updated>2026-10-05T00:00:00Z</updated>");
    expect(first).toContain("Status now: Funded.");
  });
});
