import { describe, expect, it } from "vitest";
import { decrypt, encrypt, lookupHash, newToken, hashToken, sameHash, normaliseEmail } from "../src/crypto";
import { countUsage } from "../src/usage";
import { loadConfig } from "../src/config";
import { migrate, testDb } from "../src/db";

const key = Buffer.alloc(32, 1);

describe("crypto", () => {
  it("round-trips and never stores plaintext", () => {
    const enc = encrypt(key, "reader@example.org");
    expect(enc).not.toContain("reader");
    expect(decrypt(key, enc)).toBe("reader@example.org");
    expect(encrypt(key, "reader@example.org")).not.toBe(enc); // random IV
  });

  it("rejects a tampered ciphertext", () => {
    const enc = Buffer.from(encrypt(key, "x@y.z"), "base64");
    enc[enc.length - 1]! ^= 1;
    expect(() => decrypt(key, enc.toString("base64"))).toThrow();
  });

  it("gives a stable lookup hash per channel and address", () => {
    const pepper = Buffer.alloc(32, 2);
    expect(lookupHash(pepper, "email", normaliseEmail(" Reader@Example.org "))).toBe(lookupHash(pepper, "email", "reader@example.org"));
    expect(lookupHash(pepper, "email", "a@b.c")).not.toBe(lookupHash(pepper, "telegram", "a@b.c"));
  });

  it("hashes tokens and compares in constant time", () => {
    const { token, hash } = newToken();
    expect(sameHash(hashToken(token), hash)).toBe(true);
    expect(sameHash(hashToken(token + "x"), hash)).toBe(false);
  });
});

describe("config", () => {
  it("refuses to run in production without secrets", () => {
    expect(() => loadConfig({ LEDGER_ENV: "production" })).toThrow(/must be set in production/);
  });
  it("runs locally with development fallbacks", () => {
    const c = loadConfig({});
    expect(c.production).toBe(false);
    expect(c.mail.provider).toBe("outbox");
    expect(c.followerCountThreshold).toBe(50);
  });
});

describe("database", () => {
  it("migrates idempotently", async () => {
    const db = await testDb();
    expect(await migrate(db)).toEqual([]);
    const tables = (await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")).map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining(["subscription", "subscription_target", "change_event", "delivery", "submission", "daily_salt", "rate_bucket", "usage_daily", "mail_outbox"]));
    await db.close();
  });

  it("has no column that could hold an IP address or a name", async () => {
    const db = await testDb();
    const cols = (await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'")).map((r) => r.column_name);
    expect(cols.filter((c) => /(^|_)(ip|user_agent|name)($|_)/.test(c))).toEqual([]);
    await db.close();
  });

  it("counts usage as daily aggregates", async () => {
    const db = await testDb();
    const day = new Date("2026-10-06T12:00:00Z");
    await countUsage(db, { event: "follow_started", props: { channel: "email", target_kind: "promise" } }, 1, day);
    await countUsage(db, { event: "follow_started", props: { channel: "email", target_kind: "actor" } }, 1, day);
    const rows = await db.query<{ prop_key: string; prop_value: string; count: string }>("SELECT prop_key, prop_value, count FROM usage_daily WHERE event = 'follow_started' ORDER BY prop_key, prop_value");
    expect(rows.map((r) => [r.prop_key, r.prop_value, Number(r.count)])).toEqual([
      ["", "", 2],
      ["channel", "email", 2],
      ["target_kind", "actor", 1],
      ["target_kind", "promise", 1],
    ]);
    await db.close();
  });
});

describe("mail", () => {
  it("writes to the outbox with the address encrypted and one-click unsubscribe headers", async () => {
    const { outboxMailer } = await import("../src/mail");
    const { decrypt } = await import("../src/crypto");
    const db = await testDb();
    const config = loadConfig({});
    await outboxMailer(db, config).send({ to: "reader@example.org", subject: "S", text: "T", unsubscribeUrl: "http://localhost:3000/follow/manage?t=x" });
    const [row] = await db.query<{ to_enc: string; headers: Record<string, string> }>("SELECT to_enc, headers FROM mail_outbox");
    expect(row!.to_enc).not.toContain("reader");
    expect(decrypt(config.encryptionKey, row!.to_enc)).toBe("reader@example.org");
    expect(row!.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    await db.close();
  });
});

describe("spam controls", () => {
  it("allows up to the limit per client per day and stores no IP", async () => {
    const { rateLimit } = await import("../src/spam");
    const db = await testDb();
    const now = new Date("2026-10-06T10:00:00Z");
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit(db, "203.0.113.9", "submit", 3, now));
    expect(results).toEqual([true, true, true, false]);
    expect(await rateLimit(db, "198.51.100.1", "submit", 3, now)).toBe(true);
    const dump = JSON.stringify(await db.query("SELECT * FROM rate_bucket"));
    expect(dump).not.toContain("203.0.113.9");
    await db.close();
  });

  it("forgets yesterday: salts and buckets are pruned", async () => {
    const { rateLimit, pruneSpamState } = await import("../src/spam");
    const db = await testDb();
    await rateLimit(db, "203.0.113.9", "submit", 3, new Date("2026-10-05T23:00:00Z"));
    await pruneSpamState(db, new Date("2026-10-06T00:30:00Z"));
    expect(await db.query("SELECT * FROM daily_salt")).toEqual([]);
    expect(await db.query("SELECT * FROM rate_bucket")).toEqual([]);
    await db.close();
  });

  it("accepts a solved ALTCHA challenge once and rejects tampering", async () => {
    const { createSpamChallenge, verifySpamCheck } = await import("../src/spam");
    const { solveChallenge } = await import("altcha-lib");
    const { deriveKey } = await import("altcha-lib/algorithms/pbkdf2");
    const db = await testDb();
    const config = loadConfig({});
    const challenge = await createSpamChallenge(config, { cost: 10, counter: [1, 20] });
    const solution = await solveChallenge({ challenge, deriveKey } as never);
    const payload = Buffer.from(JSON.stringify({ challenge, solution })).toString("base64");
    expect(await verifySpamCheck(db, config, payload)).toBe(true);
    expect(await verifySpamCheck(db, config, payload)).toBe(false); // replay
    expect(await verifySpamCheck(db, config, "bm90IGpzb24=")).toBe(false);
    expect(await verifySpamCheck(db, loadConfig({ ALTCHA_HMAC_KEY: "other" }), payload)).toBe(false);
    await db.close();
  });
});
