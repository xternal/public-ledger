import type { Config } from "./config";
import type { Db } from "./db";
import { encrypt } from "./crypto";

/**
 * Plain-text transactional mail. No HTML, no images, no tracking pixels, no
 * link rewriting (PRIVACY_AND_ACCOUNTS.md). Every alert carries a one-click
 * unsubscribe header (RFC 8058).
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Manage/unsubscribe link for List-Unsubscribe; required for alerts and digests. */
  unsubscribeUrl?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

function headers(m: MailMessage): Record<string, string> {
  return m.unsubscribeUrl
    ? { "List-Unsubscribe": `<${m.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
    : {};
}

/** Development and tests: write to the mail_outbox table (address encrypted, like everywhere else). */
export function outboxMailer(db: Db, config: Config): Mailer {
  return {
    async send(m) {
      await db.query("INSERT INTO mail_outbox (to_enc, subject, body_text, headers) VALUES ($1, $2, $3, $4)", [
        encrypt(config.encryptionKey, m.to),
        m.subject,
        m.text,
        JSON.stringify(headers(m)),
      ]);
    },
  };
}

/** Production: Amazon SES v2 in eu-west-2 (London). Credentials come from the standard AWS environment variables. */
export function sesMailer(config: Config): Mailer {
  let client: Promise<import("@aws-sdk/client-sesv2").SESv2Client> | null = null;
  return {
    async send(m) {
      const ses = await import("@aws-sdk/client-sesv2");
      client ??= Promise.resolve(new ses.SESv2Client({ region: config.mail.sesRegion }));
      const h = headers(m);
      await (await client).send(
        new ses.SendEmailCommand({
          FromEmailAddress: config.mail.from,
          ReplyToAddresses: config.mail.replyTo ? [config.mail.replyTo] : undefined,
          Destination: { ToAddresses: [m.to] },
          Content: {
            Simple: {
              Subject: { Data: m.subject, Charset: "UTF-8" },
              Body: { Text: { Data: m.text, Charset: "UTF-8" } },
              Headers: Object.entries(h).map(([Name, Value]) => ({ Name, Value })),
            },
          },
        }),
      );
    },
  };
}

export function mailerFor(config: Config, db: Db): Mailer {
  return config.mail.provider === "ses" ? sesMailer(config) : outboxMailer(db, config);
}
