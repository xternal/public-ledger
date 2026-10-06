import type { Config } from "./config";

/**
 * Minimal Telegram Bot API client (sendMessage only). Shared by the bot webhook
 * (follow) and the alert fan-out. Without a bot token (development) messages
 * are returned to the caller instead of sent, so tests can assert on them.
 */
export interface TelegramSender {
  send(chatId: string, text: string): Promise<void>;
}

export function telegramSender(config: Config, sink?: { chatId: string; text: string }[]): TelegramSender {
  return {
    async send(chatId, text) {
      if (!config.telegram.botToken) {
        sink?.push({ chatId, text });
        return;
      }
      const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status}`);
    },
  };
}
