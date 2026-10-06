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
