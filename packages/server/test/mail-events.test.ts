import { createHmac, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { type Db, testDb } from "../src/db";
import { lookupHash, normaliseEmail } from "../src/crypto";
import { handleResendEvent, verifyResendSignature } from "../src/mail-events";

const config = loadConfig({ SITE_URL: "https://ledger.test" });
const NOW = new Date("2026-10-09T09:00:00Z");
const SECRET = `whsec_${Buffer.alloc(24, 7).toString("base64")}`;

const sign = (id: string, ts: string, body: string, secret = SECRET) =>
  `v1,${createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;

describe("Resend webhook signatures", () => {
  const body = JSON.stringify({ type: "email.bounced" });
  const ts = String(Math.floor(NOW.getTime() / 1000));

  it("accepts a valid signature", () => {
    expect(verifyResendSignature(SECRET, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, body, NOW)).toBe(true);
  });

  it("accepts any one valid signature in a space-separated list", () => {
    const sig = `v1,${Buffer.alloc(32).toString("base64")} ${sign("msg_1", ts, body)}`;
    expect(verifyResendSignature(SECRET, { id: "msg_1", timestamp: ts, signature: sig }, body, NOW)).toBe(true);
  });

  it("refuses a wrong secret, a changed body, a stale timestamp and missing headers", () => {
    const other = `whsec_${Buffer.alloc(24, 9).toString("base64")}`;
    expect(verifyResendSignature(SECRET, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body, other) }, body, NOW)).toBe(false);
    expect(verifyResendSignature(SECRET, { id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body) }, `${body} `, NOW)).toBe(false);
    const old = String(Math.floor(NOW.getTime() / 1000) - 600);
    expect(verifyResendSignature(SECRET, { id: "msg_1", timestamp: old, signature: sign("msg_1", old, body) }, body, NOW)).toBe(false);
    expect(verifyResendSignature(SECRET, { id: null, timestamp: ts, signature: sign("msg_1", ts, body) }, body, NOW)).toBe(false);
  });
});

describe("bounces and complaints", () => {
  let db: Db;
  const subscribe = async (email: string) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO subscription (id, channel, address_enc, address_hash, consent_text_version, consent_at, confirmed_at, manage_token_hash)
       VALUES ($1, 'email', 'x', $2, 'v1', now(), now(), $3)`,
      [id, lookupHash(config.lookupPepper, "email", normaliseEmail(email)), randomUUID()],
    );
    await db.query("INSERT INTO subscription_target (subscription_id, kind, target_id) VALUES ($1, 'all', '*')", [id]);
    return id;
  };
  const count = async () => Number((await db.query<{ n: string }>("SELECT count(*) AS n FROM subscription"))[0]!.n);
  const event = (type: string, to: string[], bounceType?: string) => ({ type, data: { to, ...(bounceType ? { bounce: { type: bounceType } } : {}) } });

  beforeEach(async () => {
    db = await testDb();
    await subscribe("Reader@Example.org");
    await subscribe("other@example.org");
  });

  it("deletes the subscription for a permanent bounce, with what it follows", async () => {
    expect(await handleResendEvent({ db, config, now: NOW }, event("email.bounced", ["reader@example.org"], "Permanent"))).toEqual({ action: "removed", kind: "bounce" });
    expect(await count()).toBe(1);
    expect(Number((await db.query<{ n: string }>("SELECT count(*) AS n FROM subscription_target"))[0]!.n)).toBe(1);
  });

  it("deletes the subscription for a spam complaint, matching a named address", async () => {
    expect(await handleResendEvent({ db, config, now: NOW }, event("email.complained", ["Reader <reader@example.org>"]))).toEqual({ action: "removed", kind: "complaint" });
    expect(await count()).toBe(1);
  });

  it("leaves everything alone for a temporary bounce or another event", async () => {
    expect((await handleResendEvent({ db, config, now: NOW }, event("email.bounced", ["reader@example.org"], "Temporary"))).action).toBe("none");
    expect((await handleResendEvent({ db, config, now: NOW }, event("email.delivered", ["reader@example.org"]))).action).toBe("none");
    expect((await handleResendEvent({ db, config, now: NOW }, null)).action).toBe("none");
    expect(await count()).toBe(2);
  });

  it("counts the event without any address", async () => {
    await handleResendEvent({ db, config, now: NOW }, event("email.complained", ["nobody@example.org"]));
    const rows = await db.query<{ prop_key: string; prop_value: string }>("SELECT prop_key, prop_value FROM usage_daily WHERE event = 'mail_feedback' ORDER BY prop_key");
    expect(rows.map((r) => `${r.prop_key}=${r.prop_value}`)).toEqual(["=", "kind=complaint", "removed=no"]);
  });
});
