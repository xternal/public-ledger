/**
 * The consent text shown next to every follow form and in the Telegram bot
 * before anyone follows anything (PRIVACY_AND_ACCOUNTS.md: explicit consent in
 * plain words, because follows can reveal political opinions, UK GDPR Art. 9).
 *
 * Changing the words means a new version: bump CONSENT_VERSION (the date the
 * text changed). Each subscription records the version it agreed to and when.
 * Legal review is pending (docs/OPERATIONS.md §9).
 */
export const CONSENT_VERSION = "2026-10-06";

/** One point per line; the web form shows them as a list, Telegram as lines. */
export const CONSENT_POINTS: readonly string[] = [
  "We store your email address (or your Telegram chat), encrypted, and the list of what you follow. Nothing else: no name, no IP address, no tracking.",
  "We use it only to send you alerts when something you follow changes.",
  "What you follow can reveal your political opinions, so we treat it as sensitive data.",
  "We never show who follows what, and we never share or sell our lists.",
  "Every message has a link to stop alerts. Deleting removes everything at once.",
];

export const CONSENT_TEXT = CONSENT_POINTS.join("\n");
