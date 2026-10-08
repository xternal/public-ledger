import type { Config } from "../config";
import { sameHash } from "../crypto";
import type { TelegramSender } from "../telegram-api";
import { countUsage } from "../usage";
import { CONSENT_POINTS } from "./consent";
import { type FollowContext, telegramFollow, telegramStop, telegramTargets, telegramUnfollow } from "./service";
import { type KnownTarget, type Target, parseTelegramPayload, plainDescribe, telegramPayload } from "./targets";

/**
 * The Telegram bot (webhook POST /api/telegram). Commands: /start <payload>,
 * /follow, /list, /unfollow, /stop, /help. A follow needs a button press under
 * the consent text; /stop deletes the chat id and everything it follows.
 *
 * Private chats only: in a group, a follow would tell the whole group what one
 * person follows, so the bot ignores groups and channels.
 */

export interface InlineButton {
  text: string;
  data: string;
}

/** The two Bot API calls the follow flow needs beyond plain sendMessage. */
export interface BotApi {
  sendWithButtons(chatId: string, text: string, rows: InlineButton[][]): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
}

export type BotCall =
  | { method: "sendMessage"; chatId: string; text: string; buttons: InlineButton[][] }
  | { method: "answerCallbackQuery"; callbackId: string; text?: string };

/** Without a bot token (development, tests) calls go to `sink` instead of Telegram. */
export function telegramBotApi(config: Config, sink?: BotCall[]): BotApi {
  const call = async (method: string, body: unknown) => {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Telegram ${method} failed: ${res.status}`);
  };
  return {
    async sendWithButtons(chatId, text, rows) {
      if (!config.telegram.botToken) {
        sink?.push({ method: "sendMessage", chatId, text, buttons: rows });
        return;
      }
      await call("sendMessage", {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data }))) },
      });
    },
    async answerCallback(callbackId, text) {
      if (!config.telegram.botToken) {
        sink?.push({ method: "answerCallbackQuery", callbackId, text });
        return;
      }
      await call("answerCallbackQuery", { callback_query_id: callbackId, text });
    },
  };
}

/**
 * Telegram sends our secret in X-Telegram-Bot-Api-Secret-Token on every webhook
 * call (set with setWebhook, docs/OPERATIONS.md §4). No secret configured means
 * the bot is off: the route answers 404.
 */
export function webhookAuth(config: Config, header: string | null): "ok" | "forbidden" | "disabled" {
  const secret = config.telegram.webhookSecret;
  if (!secret) return "disabled";
  return header && sameHash(header, secret) ? "ok" : "forbidden";
}

// ------------------------------------------------------------------ update parsing

export type BotInput =
  | { kind: "command"; chatId: string; command: string; arg: string }
  | { kind: "text"; chatId: string }
  | { kind: "callback"; chatId: string; callbackId: string; data: string };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isChatId = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x);

function privateChat(chat: unknown): string | null {
  if (!isObj(chat) || !isChatId(chat.id) || chat.type !== "private") return null;
  return String(chat.id);
}

/**
 * The parts of a Telegram Update the bot acts on, validated; null for anything
 * else (edited messages, groups, stickers, inline queries…), which the webhook
 * acknowledges with 200 and ignores.
 */
export function parseUpdate(body: unknown): BotInput | null {
  if (!isObj(body) || !isChatId(body.update_id)) return null;
  const m = body.message;
  if (isObj(m)) {
    const chatId = privateChat(m.chat);
    if (!chatId) return null;
    if (typeof m.text !== "string" || m.text.length > 4096) return { kind: "text", chatId };
    const cmd = /^\/([a-z]{1,32})(?:@[A-Za-z0-9_]{1,64})?(?:\s+(\S{1,64}))?\s*$/i.exec(m.text.trim());
    if (!cmd) return { kind: "text", chatId };
    return { kind: "command", chatId, command: cmd[1]!.toLowerCase(), arg: cmd[2] ?? "" };
  }
  const q = body.callback_query;
  if (isObj(q)) {
    if (typeof q.id !== "string" || q.id.length > 128 || typeof q.data !== "string" || q.data.length > 64) return null;
    const chatId = isObj(q.message) ? privateChat(q.message.chat) : null;
    if (!chatId) return null;
    return { kind: "callback", chatId, callbackId: q.id, data: q.data };
  }
  return null;
}

// ------------------------------------------------------------------ handling

export interface BotContext extends Omit<FollowContext, "mail"> {
  /** Plain replies (shared sendMessage client). */
  sender: TelegramSender;
  /** Replies with buttons, and callback answers. */
  bot: BotApi;
  /** Whether a promise, actor or area exists in current content. */
  isKnown: KnownTarget;
}

const UNFOLLOW = "u";

function short(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function helpText(config: Config): string {
  return [
    "Public Ledger tells you here when a promise you follow changes: its status, a deadline, its wording, its cost, or a reply from the people named on it.",
    "",
    `To follow one promise, a politician, a policy area or what is coming due, open it on ${config.siteUrl}/promises, choose Follow, then Telegram.`,
    "",
    "/follow – follow everything",
    "/list – what you follow",
    "/unfollow – stop following one thing",
    "/stop – stop all alerts and delete your chat id",
    "/help – this message",
  ].join("\n");
}

async function offerFollow(ctx: BotContext, chatId: string, target: Target): Promise<void> {
  const name = (ctx.describe ?? plainDescribe)(target);
  await ctx.bot.sendWithButtons(
    chatId,
    [`Follow: ${name}`, "", "Before you follow:", ...CONSENT_POINTS.map((p) => `• ${p}`), "", "Send /stop at any time to delete everything.", "", "Press Follow to agree and start."].join("\n"),
    [[{ text: "Follow", data: telegramPayload(target) }]],
  );
  await countUsage(ctx.db, { event: "follow_started", props: { channel: "telegram", target_kind: target.kind } }, 1, ctx.now ?? new Date());
}

function knownFromPayload(ctx: BotContext, payload: string): Target | null {
  const t = parseTelegramPayload(payload);
  return t && ctx.isKnown(t) ? t : null;
}

async function onCommand(ctx: BotContext, chatId: string, command: string, arg: string): Promise<void> {
  const describe = ctx.describe ?? plainDescribe;
  switch (command) {
    case "start":
    case "follow": {
      if (arg) {
        const target = knownFromPayload(ctx, arg);
        if (!target) {
          await ctx.sender.send(chatId, `We could not find that. It may have been renamed or merged. Open it again on ${ctx.config.siteUrl}/promises and choose Telegram.`);
          return;
        }
        await offerFollow(ctx, chatId, target);
        return;
      }
      if (command === "follow") {
        await offerFollow(ctx, chatId, { kind: "all", id: "*" });
        return;
      }
      await ctx.sender.send(chatId, helpText(ctx.config));
      return;
    }
    case "list": {
      const targets = await telegramTargets(ctx, chatId);
      await ctx.sender.send(
        chatId,
        targets.length ? ["You follow:", ...targets.map((t) => `• ${describe(t)}`), "", "/unfollow removes one. /stop deletes everything."].join("\n") : "You do not follow anything yet. Send /help to see how.",
      );
      return;
    }
    case "unfollow": {
      const targets = await telegramTargets(ctx, chatId);
      if (!targets.length) {
        await ctx.sender.send(chatId, "You do not follow anything yet. Send /help to see how.");
        return;
      }
      await ctx.bot.sendWithButtons(
        chatId,
        "Tap one to stop following it:",
        targets.map((t) => [{ text: short(describe(t)), data: `${UNFOLLOW}${telegramPayload(t)}` }]),
      );
      return;
    }
    case "stop": {
      const deleted = await telegramStop(ctx, chatId);
      await ctx.sender.send(
        chatId,
        deleted
          ? "Done. We deleted your chat id and everything you followed. You will get no more alerts from us."
          : "We have nothing stored for this chat, so there is nothing to delete.",
      );
      return;
    }
    case "help":
      await ctx.sender.send(chatId, helpText(ctx.config));
      return;
    default:
      await ctx.sender.send(chatId, "Sorry, I do not know that command. Send /help to see what I can do.");
  }
}

async function onCallback(ctx: BotContext, chatId: string, callbackId: string, data: string): Promise<void> {
  const describe = ctx.describe ?? plainDescribe;
  if (data.startsWith(UNFOLLOW)) {
    const target = parseTelegramPayload(data.slice(UNFOLLOW.length));
    if (!target) {
      await ctx.bot.answerCallback(callbackId);
      return;
    }
    const r = await telegramUnfollow(ctx, chatId, target);
    await ctx.bot.answerCallback(callbackId, r === "not_following" ? "You were not following that" : "Stopped");
    if (r === "removed") await ctx.sender.send(chatId, `You no longer follow ${describe(target)}.`);
    if (r === "deleted") await ctx.sender.send(chatId, "You no longer follow anything, so we deleted your chat id. Follow again any time from the site.");
    return;
  }
  const target = knownFromPayload(ctx, data);
  if (!target) {
    await ctx.bot.answerCallback(callbackId, "That is no longer available");
    return;
  }
  const r = await telegramFollow(ctx, chatId, target);
  await ctx.bot.answerCallback(callbackId, r === "added" ? "Following" : "Already following");
  await ctx.sender.send(
    chatId,
    r === "added"
      ? `You now follow ${describe(target)}. We will message you here when it changes.\n\n/list shows what you follow. /stop deletes everything.`
      : `You already follow ${describe(target)}.`,
  );
}

/** Handle one webhook update. Returns "ignored" for updates the bot does not act on. */
export async function handleTelegramUpdate(ctx: BotContext, body: unknown): Promise<"handled" | "ignored"> {
  const input = parseUpdate(body);
  if (!input) return "ignored";
  switch (input.kind) {
    case "command":
      await onCommand(ctx, input.chatId, input.command, input.arg);
      return "handled";
    case "callback":
      await onCallback(ctx, input.chatId, input.callbackId, input.data);
      return "handled";
    case "text":
      await ctx.sender.send(input.chatId, "I only understand commands. Send /help to see them.");
      return "handled";
  }
}
