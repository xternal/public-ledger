import { telegramSender } from "@ledger/server";
import { handleTelegramUpdate, telegramBotApi, webhookAuth } from "@ledger/server/follow";
import { getServer } from "@/lib/server";
import { describeTarget, isKnownTarget } from "@/app/follow/targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 64_000;

/**
 * Telegram bot webhook. Telegram sends our secret in a header on every call;
 * without a configured secret the bot is off (404). Every authenticated update
 * gets 200, even ones we ignore, so Telegram does not retry them. Never logs
 * the update (it holds a chat id and message text).
 */
export async function POST(req: Request) {
  const { config, db } = await getServer();
  const auth = webhookAuth(config, req.headers.get("x-telegram-bot-api-secret-token"));
  if (auth === "disabled") return new Response("Not found", { status: 404 });
  if (auth === "forbidden") return new Response("Forbidden", { status: 403 });

  const raw = await req.text();
  let body: unknown = null;
  if (raw.length <= MAX_BODY) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }
  try {
    await handleTelegramUpdate(
      { db, config, describe: describeTarget, isKnown: isKnownTarget, sender: telegramSender(config), bot: telegramBotApi(config) },
      body,
    );
  } catch (e) {
    console.error("telegram update failed:", e instanceof Error ? e.message : "unknown error");
  }
  return Response.json({ ok: true });
}
