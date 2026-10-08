import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { type Db, testDb } from "../src/db";
import { telegramSender } from "../src/telegram-api";
import { CONSENT_POINTS, CONSENT_VERSION, handleTelegramUpdate, parseUpdate, telegramBotApi, webhookAuth, type BotCall, type BotContext, type Target } from "../src/follow";

const config = loadConfig({ SITE_URL: "https://ledger.test" });
const CHAT = 424242;
const KNOWN = new Set(["promise:uk-bus-cap-2-2026", "actor:andy-burnham", "area:health", "all:*"]);

let db: Db;
let sent: { chatId: string; text: string }[];
let calls: BotCall[];
const now = new Date("2026-10-06T09:00:00Z");

function bot(cfg = config): BotContext {
  return {
    db,
    config: cfg,
    now,
    describe: (t: Target) => `name of ${t.kind} ${t.id}`,
    isKnown: (t) => KNOWN.has(`${t.kind}:${t.id}`),
    sender: telegramSender(cfg, sent),
    bot: telegramBotApi(cfg, calls),
  };
}

let updateId = 1;
const message = (text: string, chat: Record<string, unknown> = { id: CHAT, type: "private" }) => ({ update_id: updateId++, message: { message_id: 1, date: 0, chat, text } });
const callback = (data: string) => ({ update_id: updateId++, callback_query: { id: `cb${updateId}`, from: { id: CHAT }, data, message: { message_id: 2, chat: { id: CHAT, type: "private" } } } });

beforeEach(async () => {
  db = await testDb();
  sent = [];
  calls = [];
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});

describe("webhook secret", () => {
  it("rejects a missing or wrong secret, and is off without one", () => {
    const on = loadConfig({ TELEGRAM_WEBHOOK_SECRET: "s3cret_value-1" });
    expect(webhookAuth(on, "s3cret_value-1")).toBe("ok");
    expect(webhookAuth(on, "s3cret_value-2")).toBe("forbidden");
    expect(webhookAuth(on, "s3cret")).toBe("forbidden");
    expect(webhookAuth(on, null)).toBe("forbidden");
    expect(webhookAuth(config, "anything")).toBe("disabled");
  });
});

describe("Telegram bot", () => {
  it("/start p_<id> shows the consent text with a Follow button, and stores nothing yet", async () => {
    expect(await handleTelegramUpdate(bot(), message("/start p_uk-bus-cap-2-2026"))).toBe("handled");
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.method).toBe("sendMessage");
    if (c.method !== "sendMessage") return;
    expect(c.chatId).toBe(String(CHAT));
    expect(c.text).toContain("Follow: name of promise uk-bus-cap-2-2026");
    for (const p of CONSENT_POINTS) expect(c.text).toContain(p);
    expect(c.text).toContain("Full details: https://ledger.test/privacy");
    expect(c.buttons).toEqual([[{ text: "Follow", data: "p_uk-bus-cap-2-2026" }]]);
    expect(await db.query("SELECT 1 FROM subscription")).toHaveLength(0);
  });

  it("pressing Follow creates a confirmed subscription with consent recorded", async () => {
    await handleTelegramUpdate(bot(), callback("p_uk-bus-cap-2-2026"));
    const [sub] = await db.query<{ channel: string; confirmed_at: unknown; consent_text_version: string; address_enc: string; cadence: string }>("SELECT * FROM subscription");
    expect(sub!.channel).toBe("telegram");
    expect(sub!.confirmed_at).toBeTruthy();
    expect(sub!.consent_text_version).toBe(CONSENT_VERSION);
    expect(sub!.address_enc).not.toContain(String(CHAT));
    expect(await db.query("SELECT kind, target_id FROM subscription_target")).toEqual([{ kind: "promise", target_id: "uk-bus-cap-2-2026" }]);
    expect(calls).toContainEqual(expect.objectContaining({ method: "answerCallbackQuery", text: "Following" }));
    expect(sent.at(-1)!.text).toMatch(/^You now follow name of promise uk-bus-cap-2-2026/);

    // Second target extends the same subscription; pressing again changes nothing.
    await handleTelegramUpdate(bot(), callback("a_andy-burnham"));
    await handleTelegramUpdate(bot(), callback("a_andy-burnham"));
    expect(await db.query("SELECT 1 FROM subscription")).toHaveLength(1);
    expect(await db.query("SELECT 1 FROM subscription_target")).toHaveLength(2);
    expect(sent.at(-1)!.text).toMatch(/^You already follow/);
  });

  it("/list, /unfollow and the unfollow buttons", async () => {
    await handleTelegramUpdate(bot(), message("/list"));
    expect(sent.at(-1)!.text).toMatch(/do not follow anything/);
    await handleTelegramUpdate(bot(), callback("p_uk-bus-cap-2-2026"));
    await handleTelegramUpdate(bot(), callback("r_health"));
    await handleTelegramUpdate(bot(), message("/list"));
    expect(sent.at(-1)!.text).toContain("• name of promise uk-bus-cap-2-2026");
    expect(sent.at(-1)!.text).toContain("• name of area health");

    calls.length = 0;
    await handleTelegramUpdate(bot(), message("/unfollow"));
    const c = calls[0]!;
    if (c.method !== "sendMessage") throw new Error("expected buttons");
    expect(c.buttons).toHaveLength(2);
    expect(c.buttons).toEqual(expect.arrayContaining([[{ text: "name of promise uk-bus-cap-2-2026", data: "up_uk-bus-cap-2-2026" }], [{ text: "name of area health", data: "ur_health" }]]));

    await handleTelegramUpdate(bot(), callback("up_uk-bus-cap-2-2026"));
    expect(sent.at(-1)!.text).toBe("You no longer follow name of promise uk-bus-cap-2-2026.");
    await handleTelegramUpdate(bot(), callback("ur_health"));
    expect(sent.at(-1)!.text).toMatch(/deleted your chat id/);
    expect(await db.query("SELECT 1 FROM subscription")).toHaveLength(0);
  });

  it("/stop deletes everything for this chat", async () => {
    await handleTelegramUpdate(bot(), callback("all"));
    await handleTelegramUpdate(bot(), callback("p_uk-bus-cap-2-2026"));
    await handleTelegramUpdate(bot(), message("/stop"));
    expect(sent.at(-1)!.text).toMatch(/^Done. We deleted your chat id/);
    expect(await db.query("SELECT 1 FROM subscription")).toHaveLength(0);
    expect(await db.query("SELECT 1 FROM subscription_target")).toHaveLength(0);
    await handleTelegramUpdate(bot(), message("/stop"));
    expect(sent.at(-1)!.text).toMatch(/nothing to delete/);
    const [d] = await db.query<{ count: string }>("SELECT count FROM usage_daily WHERE event = 'data_deleted' AND prop_key = ''");
    expect(Number(d!.count)).toBe(1);
  });

  it("/follow offers everything; unknown or malformed payloads follow nothing", async () => {
    await handleTelegramUpdate(bot(), message("/follow"));
    const c = calls[0]!;
    if (c.method !== "sendMessage") throw new Error("expected buttons");
    expect(c.buttons).toEqual([[{ text: "Follow", data: "all" }]]);

    await handleTelegramUpdate(bot(), message("/start p_no-such-card"));
    expect(sent.at(-1)!.text).toMatch(/could not find that/);
    await handleTelegramUpdate(bot(), callback("p_no-such-card"));
    await handleTelegramUpdate(bot(), callback("zz"));
    expect(calls.filter((x) => x.method === "answerCallbackQuery").map((x) => (x as { text?: string }).text)).toEqual(["That is no longer available", "That is no longer available"]);
    expect(await db.query("SELECT 1 FROM subscription")).toHaveLength(0);

    await handleTelegramUpdate(bot(), message("/start"));
    expect(sent.at(-1)!.text).toContain("/stop – stop all alerts and delete your chat id");
    await handleTelegramUpdate(bot(), message("hello"));
    expect(sent.at(-1)!.text).toMatch(/only understand commands/);
  });

  it("ignores groups, edits and malformed updates", async () => {
    expect(await handleTelegramUpdate(bot(), message("/start all", { id: -100123, type: "group" }))).toBe("ignored");
    expect(await handleTelegramUpdate(bot(), { update_id: 9, edited_message: { chat: { id: CHAT, type: "private" }, text: "/stop" } })).toBe("ignored");
    expect(await handleTelegramUpdate(bot(), { message: { chat: { id: CHAT, type: "private" }, text: "/stop" } })).toBe("ignored");
    expect(await handleTelegramUpdate(bot(), "nonsense")).toBe("ignored");
    expect(parseUpdate({ update_id: 1, callback_query: { id: "x", data: "a".repeat(65), message: { chat: { id: CHAT, type: "private" } } } })).toBeNull();
    expect(sent).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("calls the Bot API with an inline keyboard when a token is set (network mocked)", async () => {
    const withToken = loadConfig({ SITE_URL: "https://ledger.test", TELEGRAM_BOT_TOKEN: "test-token" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await handleTelegramUpdate(bot(withToken), message("/start r_health"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.telegram.org/bottest-token/sendMessage");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.chat_id).toBe(String(CHAT));
    expect(body.reply_markup).toEqual({ inline_keyboard: [[{ text: "Follow", callback_data: "r_health" }]] });

    await handleTelegramUpdate(bot(withToken), callback("r_health"));
    const methods = fetchMock.mock.calls.map(([u]) => String(u).split("/").at(-1));
    expect(methods).toEqual(["sendMessage", "answerCallbackQuery", "sendMessage"]);
    expect(calls).toHaveLength(0);
  });
});
