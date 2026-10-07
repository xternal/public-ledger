/**
 * Server configuration, all from environment variables. Production must set
 * every secret; local development falls back to an in-process Postgres
 * (PGlite) and a mail outbox, so every flow runs without accounts.
 *
 * Production choices (docs/OPERATIONS.md): Neon Postgres in the London region,
 * Amazon SES in eu-west-2 (London) with no tracking, Telegram Bot API,
 * ALTCHA (self-hosted proof of work) instead of a third-party CAPTCHA.
 */

export interface Config {
  production: boolean;
  /** "alpha": an early version, labelled on every page. "live": launched. */
  stage: "alpha" | "live";
  /** Optional shared password that closes an alpha to testers only (null: public). */
  alphaPassword: string | null;
  /** Public origin used in links in emails and Telegram messages, e.g. https://publicledger.example */
  siteUrl: string;
  /** Postgres connection string; unset in development means PGlite. */
  databaseUrl: string | null;
  /** Directory for PGlite data in development; ":memory:" for tests. */
  pgliteDir: string;
  /** 32-byte key (base64) for AES-256-GCM encryption of addresses at rest. */
  encryptionKey: Buffer;
  /** Separate secret (base64) for HMAC lookup hashes, so lookups never need decryption. */
  lookupPepper: Buffer;
  /** HMAC key for ALTCHA challenges. */
  altchaKey: string;
  /** "off": no email at all (e.g. an alpha before SES is set up); the site hides email options. */
  mail: { provider: "ses" | "outbox" | "off"; from: string; replyTo?: string; sesRegion: string };
  telegram: { botToken: string | null; botUsername: string | null; webhookSecret: string | null };
  /** Claude API key for pre-filling submissions; unset means no pre-fill. */
  anthropicApiKey: string | null;
  /** GitHub token and repo for opening draft pull requests from triage. */
  github: { token: string | null; repo: string };
  /** Interim admin gate until SSO (Cloudflare Access or Vercel Authentication) is in front. */
  admin: { user: string | null; password: string | null };
  /** Follower counts below this are hidden (PRD F7, privacy rules). */
  followerCountThreshold: number;
}

const DEV_KEY = Buffer.alloc(32, 7); // development only; never used when production is true

function required(name: string, value: string | undefined, production: boolean, fallback: string): string {
  if (value && value.length) return value;
  if (production) throw new Error(`${name} must be set in production`);
  return fallback;
}

function key(name: string, value: string | undefined, production: boolean): Buffer {
  if (!value) {
    if (production) throw new Error(`${name} must be set in production (32 random bytes, base64)`);
    return DEV_KEY;
  }
  const buf = Buffer.from(value, "base64");
  if (buf.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded`);
  return buf;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const production = env.LEDGER_ENV === "production";
  const stage = env.SITE_STAGE === "alpha" ? "alpha" : "live";
  const provider = env.MAIL_PROVIDER === "off" ? "off" : env.MAIL_PROVIDER === "ses" || production ? "ses" : "outbox";
  if (production && !env.DATABASE_URL) throw new Error("DATABASE_URL must be set in production (the local database cannot run on a serverless host)");
  if (env.ALPHA_PASSWORD && env.ALPHA_PASSWORD.length < 12) throw new Error("ALPHA_PASSWORD, when set, must be 12 characters or more");
  return {
    production,
    stage,
    alphaPassword: stage === "alpha" && env.ALPHA_PASSWORD ? env.ALPHA_PASSWORD : null,
    siteUrl: required("SITE_URL", env.SITE_URL, production, "http://localhost:3000").replace(/\/$/, ""),
    databaseUrl: env.DATABASE_URL || null,
    pgliteDir: env.PGLITE_DIR || ".data/pglite",
    encryptionKey: key("LEDGER_ENCRYPTION_KEY", env.LEDGER_ENCRYPTION_KEY, production),
    lookupPepper: key("LEDGER_LOOKUP_PEPPER", env.LEDGER_LOOKUP_PEPPER, production),
    altchaKey: required("ALTCHA_HMAC_KEY", env.ALTCHA_HMAC_KEY, production, "dev-altcha-key"),
    mail: {
      provider,
      from: required("MAIL_FROM", env.MAIL_FROM, production && provider === "ses", "Public Ledger <alerts@localhost>"),
      replyTo: env.MAIL_REPLY_TO || undefined,
      sesRegion: env.SES_REGION || "eu-west-2",
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN || null,
      botUsername: env.TELEGRAM_BOT_USERNAME || null,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || null,
    },
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    github: { token: env.GITHUB_TOKEN || null, repo: env.GITHUB_REPOSITORY || "xternal/public-ledger" },
    admin: { user: env.ADMIN_USER || null, password: env.ADMIN_PASSWORD || null },
    followerCountThreshold: Number(env.FOLLOWER_COUNT_THRESHOLD || 50),
  };
}
