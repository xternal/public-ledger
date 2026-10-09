import { getSeed } from "@/lib/data";
import { OG } from "@/lib/og";
import { figuresImage } from "@/lib/method-og";

export const alt = "Public Ledger: get an email, Telegram message or RSS item when a UK political promise moves";
export const size = OG.size;
export const contentType = "image/png";

export default async function Image() {
  const cards = getSeed().cards;
  return figuresImage({
    kicker: "Alerts",
    title: "Get a message when a promise moves",
    figures: [
      { value: String(cards.length), label: "promises you can follow" },
      { value: String(new Set(cards.map((c) => c.file.policy_area)).size), label: "policy areas" },
    ],
    foot: "By email, Telegram or RSS · no account needed",
  });
}
