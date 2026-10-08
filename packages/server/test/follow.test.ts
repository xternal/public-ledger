import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { type Db, testDb } from "../src/db";
import { outboxMailer, type MailMessage, type Mailer } from "../src/mail";
import { decrypt } from "../src/crypto";
import {
  ADDRESS_DAILY_LIMIT,
  CONSENT_VERSION,
  confirmEmailFollow,
  confirmTokenState,
  confirmView,
  deleteByManageToken,
  followerCount,
  manageView,
  parseFollowRequest,
  prunePendingAdditions,
  pruneUnconfirmed,
  removeTarget,
  requestEmailFollow,
  manageToken,
  revokeManageLinks,
  setCadence,
  telegramFollow,
  type FollowContext,
  type Target,
} from "../src/follow";

const config = loadConfig({ SITE_URL: "https://ledger.test" });
const T0 = new Date("2026-10-06T09:00:00Z");
const DAY = 86_400_000;
const BUS: Target = { kind: "promise", id: "uk-bus-cap-2-2026" };
const BURNHAM: Target = { kind: "actor", id: "andy-burnham" };
const EMAIL = "Reader@Example.org";

function captureMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return { sent, send: async (m) => void sent.push(m) };
}

const tokenIn = (text: string, path: string) => new RegExp(`${path.replace(/[/?]/g, "\\$&")}\\?t=([A-Za-z0-9_.-]+)`).exec(text)?.[1];

let db: Db;
let mail: ReturnType<typeof captureMailer>;
const ctx = (now = T0): FollowContext => ({ db, config, mail, now, describe: (t) => `name of ${t.kind} ${t.id}` });

beforeEach(async () => {
  db = await testDb();
  mail = captureMailer();
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

async function usage(event: string): Promise<number> {
  const [r] = await db.query<{ count: string }>("SELECT count FROM usage_daily WHERE event = $1 AND prop_key = ''", [event]);
  return Number(r?.count ?? 0);
}

describe("email follow: start → confirm → manage → unsubscribe → delete", () => {
  it("runs the whole lifecycle", async () => {
    await requestEmailFollow(ctx(), { email: EMAIL, targets: [BUS], cadence: "instant" });
    expect(mail.sent).toHaveLength(1);
    const confirm = mail.sent[0]!;
    expect(confirm.to).toBe("reader@example.org");
    expect(confirm.text).toContain("name of promise uk-bus-cap-2-2026");
    expect(confirm.unsubscribeUrl).toBeUndefined();
    const ct = tokenIn(confirm.text, "/follow/confirm")!;
    expect(ct).toBeTruthy();

    const [pending] = await db.query<{ confirmed_at: unknown; consent_text_version: string; consent_at: unknown }>("SELECT confirmed_at, consent_text_version, consent_at FROM subscription");
    expect(pending!.confirmed_at).toBeNull();
    expect(pending!.consent_text_version).toBe(CONSENT_VERSION);
    expect(pending!.consent_at).toBeTruthy();

    // Confirm (POST) → welcome email with a working manage link and one-click unsubscribe.
    const res = await confirmEmailFollow(ctx(new Date(T0.getTime() + 3600_000)), ct);
    expect(res).toMatchObject({ ok: true, kind: "signup" });
    if (!res.ok) return;
    const welcome = mail.sent[1]!;
    expect(welcome.text).toContain(`https://ledger.test/follow/manage?t=${res.manageToken}`);
    expect(welcome.unsubscribeUrl).toBe(`https://ledger.test/api/follow/unsubscribe?t=${res.manageToken}`);
    expect(await confirmEmailFollow(ctx(), ct)).toEqual({ ok: false, reason: "invalid" }); // single use

    // Manage: see, switch to weekly, follow more, remove one.
    let view = await manageView({ db, config }, res.manageToken);
    expect(view).toEqual({ channel: "email", cadence: "instant", addressHint: "r•••@example.org", targets: [BUS] });
    expect(await setCadence(ctx(), res.manageToken, "weekly")).toBe(true);
    expect((await manageView({ db, config }, res.manageToken))!.cadence).toBe("weekly");
    expect(await usage("digest_chosen")).toBe(1);

    // Following more is confirmed by email too, like the first sign-up.
    await requestEmailFollow(ctx(new Date(T0.getTime() + 7200_000)), { email: "reader@example.org", targets: [BURNHAM], cadence: "instant" });
    const added = mail.sent[2]!;
    expect(added.subject).toBe("Confirm what to add to your Public Ledger alerts");
    const manage2 = tokenIn(added.text, "/follow/manage")!;
    expect(manage2).toBe(res.manageToken); // the same link in every email, so any email's link keeps working
    expect((await manageView({ db, config }, manage2))!.targets).toEqual([BUS]);
    const addResult = await confirmEmailFollow(ctx(new Date(T0.getTime() + 7300_000)), tokenIn(added.text, "/follow/confirm"));
    expect(addResult).toEqual({ ok: true, kind: "addition", manageToken: res.manageToken });
    view = await manageView({ db, config }, manage2);
    expect(view!.targets).toEqual([BUS, BURNHAM]);
    expect(view!.cadence).toBe("weekly"); // a follow request never changes a confirmed choice

    expect(await removeTarget(ctx(), manage2, BUS)).toBe("removed");
    expect((await manageView({ db, config }, manage2))!.targets).toEqual([BURNHAM]);

    // One-click unsubscribe deletes the subscription and, by cascade, what it followed.
    const unsub = tokenIn(added.unsubscribeUrl!, "/api/follow/unsubscribe")!;
    expect(await deleteByManageToken(ctx(), unsub, "unsubscribe")).toBe(true);
    expect(await db.query("SELECT 1 FROM subscription")).toHaveLength(0);
    expect(await db.query("SELECT 1 FROM subscription_target")).toHaveLength(0);
    expect(await deleteByManageToken(ctx(), unsub, "unsubscribe")).toBe(false);
    expect(await usage("follow_started")).toBe(2);
    expect(await usage("follow_confirmed")).toBe(1);
    expect(await usage("unsubscribe_completed")).toBe(1);
  });

  it("'Stop all alerts and delete my data' really deletes and is counted as a deletion", async () => {
    await requestEmailFollow(ctx(), { email: EMAIL, targets: [BUS, BURNHAM], cadence: "weekly" });
    const res = await confirmEmailFollow(ctx(), tokenIn(mail.sent[0]!.text, "/follow/confirm"));
    if (!res.ok) throw new Error("confirm failed");
    expect(await deleteByManageToken(ctx(), res.manageToken, "delete")).toBe(true);
    expect(await db.query("SELECT 1 FROM subscription")).toHaveLength(0);
    expect(await db.query("SELECT 1 FROM subscription_target")).toHaveLength(0);
    expect(await usage("data_deleted")).toBe(1);
    expect(await manageView({ db, config }, res.manageToken)).toBeNull();
  });

  it("removing the last target deletes the address too", async () => {
    await requestEmailFollow(ctx(), { email: EMAIL, targets: [BUS], cadence: "instant" });
    const res = await confirmEmailFollow(ctx(), tokenIn(mail.sent[0]!.text, "/follow/confirm"));
    if (!res.ok) throw new Error("confirm failed");
    expect(await removeTarget(ctx(), res.manageToken, BURNHAM)).toBe("not_following");
    expect(await removeTarget(ctx(), res.manageToken, BUS)).toBe("deleted");
    expect(await db.query("SELECT 1 FROM subscription")).toHaveLength(0);
  });

  it("manage links are stable, unforgeable and revocable", async () => {
    await requestEmailFollow(ctx(), { email: EMAIL, targets: [BUS], cadence: "instant" });
    const res = await confirmEmailFollow(ctx(), tokenIn(mail.sent[0]!.text, "/follow/confirm"));
    if (!res.ok) throw new Error("confirm failed");
    const [{ id }] = (await db.query<{ id: string }>("SELECT id FROM subscription")) as [{ id: string }];
    expect(await manageToken(db, config, id)).toBe(res.manageToken);

    // Another subscription's id with this mac, a changed mac, or another server's key: all refused.
    const mac = res.manageToken.split(".")[1]!;
    expect(await manageView({ db, config }, `00000000-0000-4000-8000-000000000000.${mac}`)).toBeNull();
    expect(await manageView({ db, config }, `${id}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`)).toBeNull();
    const otherServer = loadConfig({ LEDGER_LOOKUP_PEPPER: Buffer.alloc(32, 9).toString("base64") });
    expect(await manageView({ db, config: otherServer }, res.manageToken)).toBeNull();

    await revokeManageLinks(db, id);
    expect(await manageView({ db, config }, res.manageToken)).toBeNull();
    const fresh = await manageToken(db, config, id);
    expect(fresh).not.toBe(res.manageToken);
    expect(await manageView({ db, config }, fresh)).not.toBeNull();
    await expect(manageToken(db, config, "00000000-0000-4000-8000-000000000000")).rejects.toThrow();
  });
});

describe("privacy of the email flow", () => {
  it("answers the same for a new and a known address", async () => {
    const first = await requestEmailFollow(ctx(), { email: EMAIL, targets: [BUS], cadence: "instant" });
    const again = await requestEmailFollow(ctx(), { email: EMAIL, targets: [BUS], cadence: "instant" });
    expect(first).toBeUndefined();
    expect(again).toBeUndefined();
    expect(mail.sent).toHaveLength(2); // a fresh confirmation link each time
    expect(await db.query("SELECT 1 FROM subscription")).toHaveLength(1);
    // The first link was replaced by the second.
    expect(await confirmTokenState(db, tokenIn(mail.sent[0]!.text, "/follow/confirm"), T0)).toBe("invalid");
    expect(await confirmTokenState(db, tokenIn(mail.sent[1]!.text, "/follow/confirm"), T0)).toBe("valid");
  });

  it("a GET (reading the token state) never confirms", async () => {
    await requestEmailFollow(ctx(), { email: EMAIL, targets: [BUS], cadence: "instant" });
    const ct = tokenIn(mail.sent[0]!.text, "/follow/confirm");
    for (let i = 0; i < 3; i++) expect(await confirmTokenState(db, ct, T0)).toBe("valid");
    const [row] = await db.query<{ confirmed_at: unknown; confirm_token_hash: unknown }>("SELECT confirmed_at, confirm_token_hash FROM subscription");
    expect(row!.confirmed_at).toBeNull();
    expect(row!.confirm_token_hash).not.toBeNull();
    expect(await usage("follow_confirmed")).toBe(0);
  });

  it("rejects an expired confirmation link", async () => {
    await requestEmailFollow(ctx(), { email: EMAIL, targets: [BUS], cadence: "instant" });
    const ct = tokenIn(mail.sent[0]!.text, "/follow/confirm");
    const later = new Date(T0.getTime() + 7 * DAY + 60_000);
    expect(await confirmTokenState(db, ct, later)).toBe("expired");
    expect(await confirmEmailFollow(ctx(later), ct)).toEqual({ ok: false, reason: "expired" });
    const [row] = await db.query<{ confirmed_at: unknown }>("SELECT confirmed_at FROM subscription");
    expect(row!.confirmed_at).toBeNull();
    expect(await confirmEmailFollow(ctx(), "not a token")).toEqual({ ok: false, reason: "invalid" });
  });

  it("never stores an address in plain text", async () => {
    const c: FollowContext = { ...ctx(), mail: outboxMailer(db, config) };
    await requestEmailFollow(c, { email: EMAIL, targets: [BUS], cadence: "instant" });
    const [mailRow] = await db.query<{ body_text: string }>("SELECT body_text FROM mail_outbox");
    const res = await confirmEmailFollow(c, tokenIn(mailRow!.body_text, "/follow/confirm"));
    expect(res.ok).toBe(true);
    await telegramFollow(c, "987654321", BURNHAM);

    const tables = (await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).map((r) => r.table_name);
    let dump = "";
    for (const t of tables) dump += JSON.stringify(await db.query(`SELECT * FROM ${t}`));
    expect(dump.toLowerCase()).not.toContain("reader@example.org");
    expect(dump.toLowerCase()).not.toContain("example.org");
    expect(dump).not.toContain("987654321");
    // Tokens are stored only as hashes (the development mail sink holds the email bodies, which carry links by design).
    let stored = "";
    for (const t of tables.filter((x) => x !== "mail_outbox")) stored += JSON.stringify(await db.query(`SELECT * FROM ${t}`));
    if (res.ok) expect(stored).not.toContain(res.manageToken);
    // …but the service can still read it back to send mail.
    const [sub] = await db.query<{ address_enc: string }>("SELECT address_enc FROM subscription WHERE channel = 'email'");
    expect(decrypt(config.encryptionKey, sub!.address_enc)).toBe("reader@example.org");
    // Usage counts carry no promise or actor ids.
    const values = (await db.query<{ prop_value: string }>("SELECT prop_value FROM usage_daily")).map((r) => r.prop_value);
    expect(values).not.toContain(BUS.id);
    expect(values).not.toContain(BURNHAM.id);
  });

  it("limits how many emails one address gets in a day, without changing anything", async () => {
    for (let i = 0; i < ADDRESS_DAILY_LIMIT + 2; i++) await requestEmailFollow(ctx(), { email: EMAIL, targets: [BUS], cadence: "instant" });
    expect(mail.sent).toHaveLength(ADDRESS_DAILY_LIMIT);
    // The last link sent still works.
    expect(await confirmTokenState(db, tokenIn(mail.sent.at(-1)!.text, "/follow/confirm"), T0)).toBe("valid");
  });
});

describe("follow requests for an address that is already confirmed", () => {
  async function confirmed(targets: Target[] = [BUS]) {
    await requestEmailFollow(ctx(), { email: EMAIL, targets, cadence: "instant" });
    const res = await confirmEmailFollow(ctx(), tokenIn(mail.sent.at(-1)!.text, "/follow/confirm"));
    if (!res.ok) throw new Error("confirm failed");
    const [{ id }] = (await db.query<{ id: string }>("SELECT id FROM subscription")) as [{ id: string }];
    return { manage: res.manageToken, id };
  }
  const followed = async (manage: string) => (await manageView({ db, config }, manage))!.targets;
  const later = (ms: number) => new Date(T0.getTime() + ms);

  it("adds nothing until the owner confirms, then adds exactly what was asked", async () => {
    const { manage, id } = await confirmed();
    await db.query("UPDATE subscription SET consent_text_version = 'older', consent_at = $2 WHERE id = $1", [id, T0.toISOString()]);
    const sentBefore = mail.sent.length;
    // A stranger who knows the address asks to add a politician to it.
    await requestEmailFollow(ctx(later(DAY)), { email: "reader@example.org", targets: [BURNHAM], cadence: "weekly" });
    expect(mail.sent).toHaveLength(sentBefore + 1);
    const ask = mail.sent.at(-1)!;
    expect(ask.to).toBe("reader@example.org");
    expect(ask.text).toContain("A request came in to add these to the alerts this address gets from Public Ledger:\n\n- name of actor andy-burnham");
    expect(ask.text).toContain("Nothing changes until you confirm.");
    expect(ask.unsubscribeUrl).toContain("/api/follow/unsubscribe?t=");

    // Nothing is followed, counted or alerted yet, and the request changed nothing the owner chose.
    expect(await followed(manage)).toEqual([BUS]);
    expect(await followerCount(db, "actor", BURNHAM.id, 1)).toBeNull();
    expect((await manageView({ db, config }, manage))!.cadence).toBe("instant");
    const [before] = await db.query<{ consent_text_version: string }>("SELECT consent_text_version FROM subscription");
    expect(before!.consent_text_version).toBe("older");

    // Opening the link reads only; pressing Confirm adds it and records the owner's consent.
    const ct = tokenIn(ask.text, "/follow/confirm")!;
    for (let i = 0; i < 2; i++) expect(await confirmView(db, ct, later(DAY))).toEqual({ state: "valid", kind: "addition", targets: [BURNHAM] });
    expect(await followed(manage)).toEqual([BUS]);
    expect(await confirmEmailFollow(ctx(later(2 * DAY)), ct)).toEqual({ ok: true, kind: "addition", manageToken: manage });
    expect(await followed(manage)).toEqual([BUS, BURNHAM]);
    expect(await db.query("SELECT 1 FROM pending_target")).toHaveLength(0);
    const [after] = await db.query<{ consent_text_version: string; consent_at: Date }>("SELECT consent_text_version, consent_at FROM subscription");
    expect(after!.consent_text_version).toBe(CONSENT_VERSION);
    expect(new Date(after!.consent_at).toISOString()).toBe(later(2 * DAY).toISOString());
    expect(mail.sent).toHaveLength(sentBefore + 1); // no welcome email for an addition
    expect(await confirmEmailFollow(ctx(later(2 * DAY)), ct)).toEqual({ ok: false, reason: "invalid" }); // single use
  });

  it("gives each request its own link, and moves a repeated target to the newest one", async () => {
    const { manage } = await confirmed();
    const area: Target = { kind: "area", id: "health" };
    await requestEmailFollow(ctx(later(1000)), { email: EMAIL, targets: [BURNHAM], cadence: "instant" });
    const first = tokenIn(mail.sent.at(-1)!.text, "/follow/confirm")!;
    await requestEmailFollow(ctx(later(2000)), { email: EMAIL, targets: [area, BURNHAM], cadence: "instant" });
    const second = tokenIn(mail.sent.at(-1)!.text, "/follow/confirm")!;
    expect(first).not.toBe(second);
    expect(await confirmView(db, first, later(3000))).toMatchObject({ state: "invalid" }); // its only target moved to the newer link
    expect(await confirmView(db, second, later(3000))).toEqual({ state: "valid", kind: "addition", targets: [BURNHAM, area] });
    await confirmEmailFollow(ctx(later(4000)), second);
    expect(await followed(manage)).toEqual([BUS, BURNHAM, area]);
  });

  it("says so, and changes nothing, when the address already follows everything asked", async () => {
    const { manage } = await confirmed([BUS, BURNHAM]);
    await requestEmailFollow(ctx(later(1000)), { email: EMAIL, targets: [BURNHAM], cadence: "weekly" });
    const note = mail.sent.at(-1)!;
    expect(note.subject).toBe("You already follow this on Public Ledger");
    expect(note.text).not.toContain("/follow/confirm");
    expect(await db.query("SELECT 1 FROM pending_target")).toHaveLength(0);
    expect((await manageView({ db, config }, manage))!.cadence).toBe("instant");
  });

  it("refuses an addition link after 7 days, and the daily job deletes what nobody confirmed", async () => {
    const { manage } = await confirmed();
    await requestEmailFollow(ctx(later(DAY)), { email: EMAIL, targets: [BURNHAM], cadence: "instant" });
    const ct = tokenIn(mail.sent.at(-1)!.text, "/follow/confirm")!;
    expect(await prunePendingAdditions(db, later(7 * DAY))).toBe(0);
    expect(await confirmEmailFollow(ctx(later(8 * DAY + 60_000)), ct)).toEqual({ ok: false, reason: "expired" });
    expect(await confirmView(db, ct, later(8 * DAY + 60_000))).toEqual({ state: "expired", kind: "addition", targets: [] });
    expect(await prunePendingAdditions(db, later(8 * DAY + 60_000))).toBe(1);
    expect(await confirmView(db, ct, later(8 * DAY + 60_000))).toMatchObject({ state: "invalid" });
    expect(await followed(manage)).toEqual([BUS]);
  });

  it("goes with the subscription when the owner deletes it", async () => {
    const { manage } = await confirmed();
    await requestEmailFollow(ctx(later(1000)), { email: EMAIL, targets: [BURNHAM], cadence: "instant" });
    const ct = tokenIn(mail.sent.at(-1)!.text, "/follow/confirm")!;
    expect(await deleteByManageToken(ctx(), manage, "delete")).toBe(true);
    expect(await db.query("SELECT 1 FROM pending_target")).toHaveLength(0);
    expect(await confirmEmailFollow(ctx(later(2000)), ct)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("pruneUnconfirmed", () => {
  it("deletes sign-ups older than 7 days that nobody confirmed", async () => {
    await requestEmailFollow(ctx(), { email: "old@example.org", targets: [BUS], cadence: "instant" });
    await requestEmailFollow(ctx(), { email: "done@example.org", targets: [BUS], cadence: "instant" });
    await confirmEmailFollow(ctx(), tokenIn(mail.sent[1]!.text, "/follow/confirm"));
    await requestEmailFollow(ctx(), { email: "renewed@example.org", targets: [BUS], cadence: "instant" });
    await requestEmailFollow(ctx(new Date(T0.getTime() + 5 * DAY)), { email: "renewed@example.org", targets: [BURNHAM], cadence: "instant" });

    expect(await pruneUnconfirmed(db, new Date(T0.getTime() + 6 * DAY))).toBe(0);
    expect(await pruneUnconfirmed(db, new Date(T0.getTime() + 8 * DAY))).toBe(1);
    const left = await db.query<{ confirmed: boolean }>("SELECT confirmed_at IS NOT NULL AS confirmed FROM subscription ORDER BY confirmed_at NULLS LAST");
    expect(left.map((r) => r.confirmed)).toEqual([true, false]);
    expect(await db.query("SELECT 1 FROM subscription_target")).toHaveLength(3); // done: 1, renewed: 2
  });
});

describe("followerCount", () => {
  async function confirmedFollower(email: string, t: Target) {
    const m = captureMailer();
    await requestEmailFollow({ ...ctx(), mail: m }, { email, targets: [t], cadence: "instant" });
    await confirmEmailFollow({ ...ctx(), mail: m }, tokenIn(m.sent[0]!.text, "/follow/confirm"));
  }

  it("is null below the threshold and exact at or above it; unconfirmed sign-ups do not count", async () => {
    await confirmedFollower("a@example.org", BUS);
    await confirmedFollower("b@example.org", BUS);
    await requestEmailFollow(ctx(), { email: "pending@example.org", targets: [BUS], cadence: "instant" });
    expect(await followerCount(db, "promise", BUS.id, 3)).toBeNull();
    await telegramFollow(ctx(), "1001", BUS);
    expect(await followerCount(db, "promise", BUS.id, 3)).toBe(3);
    expect(await followerCount(db, "actor", BURNHAM.id, 3)).toBeNull();
    expect(await followerCount(db, "promise", BUS.id, 50)).toBeNull();
  });
});

describe("parseFollowRequest", () => {
  it("accepts a good body and rejects bad ones", () => {
    const good = { email: " reader@example.org ", targets: [BUS, BUS, { kind: "area", id: "health" }, { kind: "all", id: "*" }], cadence: "weekly", altcha: "x" };
    const r = parseFollowRequest(good);
    expect(r).toEqual({ ok: true, value: { email: "reader@example.org", targets: [BUS, { kind: "area", id: "health" }, { kind: "all", id: "*" }], cadence: "weekly", altcha: "x" } });
    expect(parseFollowRequest({ ...good, email: "not-an-email" })).toEqual({ ok: false, field: "email" });
    expect(parseFollowRequest({ ...good, email: "a@b.co\nBcc: x@y.z" })).toEqual({ ok: false, field: "email" });
    expect(parseFollowRequest({ ...good, targets: [] })).toEqual({ ok: false, field: "targets" });
    expect(parseFollowRequest({ ...good, targets: [{ kind: "area", id: "made-up" }] })).toEqual({ ok: false, field: "targets" });
    expect(parseFollowRequest({ ...good, targets: [{ kind: "promise", id: "../etc" }] })).toEqual({ ok: false, field: "targets" });
    expect(parseFollowRequest({ ...good, cadence: "daily" })).toEqual({ ok: false, field: "cadence" });
    expect(parseFollowRequest({ ...good, altcha: undefined })).toEqual({ ok: false, field: "altcha" });
    expect(parseFollowRequest(null)).toEqual({ ok: false, field: "body" });
  });
});
