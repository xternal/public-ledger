import { getSeed } from "@/lib/data";
import { OG } from "@/lib/og";
import { figuresImage } from "@/lib/method-og";

export const alt = "Public Ledger: follow changes to UK political promises in a feed reader";
export const size = OG.size;
export const contentType = "image/png";

export default async function Image() {
  const cards = getSeed().cards;
  return figuresImage({
    kicker: "Feeds",
    title: "Follow every change to UK political promises in a feed reader",
    figures: [
      { value: String(cards.length), label: "promises, each with its own feed" },
      { value: String(new Set(cards.map((c) => c.file.policy_area)).size), label: "policy areas" },
    ],
    foot: "Atom feeds · no account, no tracking",
  });
}
