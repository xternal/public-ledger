import "server-only";
import type { PolicyArea, Seed } from "@ledger/schema";
import { loadConfig, errorText } from "@ledger/server";
import { CONSENT_POINTS, CONSENT_VERSION, plainDescribe, type Target } from "@ledger/server/follow";
import { getSeed } from "@/lib/data";
import { AREA_LABEL } from "@/lib/promises";
import type { FollowOptions } from "@/components/FollowPanel";

/**
 * Follow targets resolved against content (names for emails, the bot and the
 * manage page; "does this exist" for requests). Route handlers read content at
 * request time; if content cannot be read, names fall back to plain ids and
 * any well-formed target is accepted, so following never breaks on it.
 */

let warned = false;
function seed(): Seed | null {
  try {
    return getSeed();
  } catch (e) {
    if (!warned) console.error("follow: content not readable, using plain names:", errorText(e));
    warned = true;
    return null;
  }
}

function short(s: string, n = 90): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

export function describeTarget(t: Target): string {
  const s = seed();
  if (!s) return plainDescribe(t);
  switch (t.kind) {
    case "promise": {
      const c = s.cards.find((x) => x.id === t.id);
      return c ? `${c.actor.name}: “${short(c.current.text)}”` : `A promise no longer listed (${t.id})`;
    }
    case "actor": {
      const a = s.actors.find((x) => x.id === t.id);
      return a ? `${a.name}, all promises` : `Someone no longer listed (${t.id})`;
    }
    case "area":
      return `${AREA_LABEL[t.id as PolicyArea] ?? t.id}, all promises`;
    case "all":
      return "Every promise on Public Ledger";
  }
}

export function isKnownTarget(t: Target): boolean {
  if (t.kind === "all") return t.id === "*";
  if (t.kind === "area") return t.id in AREA_LABEL;
  const s = seed();
  if (!s) return true;
  return t.kind === "promise" ? s.cards.some((c) => c.id === t.id) : s.actors.some((a) => a.id === t.id);
}

/** Where a target lives on the site. */
export function targetHref(t: Target): string {
  switch (t.kind) {
    case "promise":
      return `/promise/${t.id}`;
    case "actor":
      return `/actor/${t.id}`;
    case "area":
      return `/promises?area=${t.id}`;
    case "all":
      return "/promises";
  }
}

/** What the follow panel needs from the server: the consent text and the bot's username (Telegram is hidden without it). */
export function followOptions(): FollowOptions {
  let bot: string | null = null;
  let email = false;
  try {
    const config = loadConfig();
    bot = config.telegram.botUsername;
    email = config.mail.provider !== "off";
  } catch {
    bot = null; // misconfigured production: hide Telegram and email rather than break the page
  }
  return {
    telegramBot: bot && /^[A-Za-z0-9_]{5,32}$/.test(bot) ? bot : null,
    email,
    consent: { version: CONSENT_VERSION, points: [...CONSENT_POINTS] },
  };
}
