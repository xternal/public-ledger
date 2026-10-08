/**
 * The consent text shown next to every follow form and in the Telegram bot
 * before anyone follows anything (PRIVACY_AND_ACCOUNTS.md: explicit consent in
 * plain words, because follows can reveal political opinions, UK GDPR Art. 9).
 * It names the controller (Empatiq Limited) and the services that carry the messages, and the
 * web form and the bot link the privacy notice at /privacy under it (DPIA M2).
 *
 * Changing the words means a new version: bump CONSENT_VERSION (the date the
 * text changed). Each subscription records the version it agreed to and when.
 * If MAIL_PROVIDER changes from Resend, change the words and the version too.
 * Legal review is pending (docs/OPERATIONS.md §9).
 */
export const CONSENT_VERSION = "2026-10-08";

/** One point per line; the web form shows them as a list, Telegram as lines. */
export const CONSENT_POINTS: readonly string[] = [
  "Empatiq Limited runs Public Ledger, independently of any party. It holds your data and is responsible for it.",
  "We store your email address (or your Telegram chat), encrypted, and the list of what you follow. Nothing else: no name, no IP address, no tracking.",
  "We use it only to send you alerts when something you follow changes. Resend delivers our emails and Telegram carries the bot's messages, so each sees what an alert is about.",
  "What you follow can reveal your political opinions, so we treat it as sensitive data. We never show who follows what, and we never share or sell our lists.",
  "Every message has a link to stop alerts. Deleting removes everything at once.",
];

export const CONSENT_TEXT = CONSENT_POINTS.join("\n");

/** Where the privacy notice lives, relative to the site. */
export const PRIVACY_PATH = "/privacy";
