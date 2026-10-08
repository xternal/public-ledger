import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { mailerFor, resendMailer } from "../src/mail";

const prod = {
  LEDGER_ENV: "production",
  SITE_URL: "https://ledger.example",
  DATABASE_URL: "postgres://x",
  LEDGER_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  LEDGER_LOOKUP_PEPPER: Buffer.alloc(32, 2).toString("base64"),
  ALTCHA_HMAC_KEY: "k",
};

describe("Resend mail", () => {
  it("is chosen by MAIL_PROVIDER=resend and needs a key and a sender in production", () => {
    const c = loadConfig({ ...prod, MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test", MAIL_FROM: "Public Ledger <alerts@ledger.example>" });
    expect(c.mail.provider).toBe("resend");
    expect(c.mail.resendApiKey).toBe("re_test");
    expect(() => loadConfig({ ...prod, MAIL_PROVIDER: "resend", MAIL_FROM: "a@b.example" })).toThrow(/RESEND_API_KEY/);
    expect(() => loadConfig({ ...prod, MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test" })).toThrow(/MAIL_FROM/);
    expect(loadConfig({}).mail.resendApiKey).toBeNull();
  });

  it("sends one plain-text message with the unsubscribe headers, and nothing else", async () => {
    const c = loadConfig({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test", MAIL_FROM: "Public Ledger <alerts@ledger.example>", MAIL_REPLY_TO: "editors@ledger.example" });
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    }) as unknown as typeof fetch;
    await resendMailer(c, fake).send({ to: "reader@example.org", subject: "Status changed", text: "Hello", unsubscribeUrl: "https://ledger.example/follow/manage?t=abc" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toEqual({
      from: "Public Ledger <alerts@ledger.example>",
      to: ["reader@example.org"],
      subject: "Status changed",
      text: "Hello",
      reply_to: "editors@ledger.example",
      headers: { "List-Unsubscribe": "<https://ledger.example/follow/manage?t=abc>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    expect(body.html).toBeUndefined();
  });

  it("fails without echoing the address", async () => {
    const c = loadConfig({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test" });
    const fake = (async () => new Response(JSON.stringify({ name: "validation_error", message: "Invalid `to` field: reader@example.org" }), { status: 422 })) as unknown as typeof fetch;
    const err = await resendMailer(c, fake)
      .send({ to: "reader@example.org", subject: "s", text: "t" })
      .catch((e: Error) => e);
    expect(String(err)).toMatch(/HTTP 422 validation_error/);
    expect(String(err)).not.toMatch(/reader@example\.org/);
  });

  it("is what mailerFor returns for resend", () => {
    const c = loadConfig({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test" });
    expect(typeof mailerFor(c, {} as never).send).toBe("function");
  });
});
