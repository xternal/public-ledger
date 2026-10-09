import { getSeed } from "@/lib/data";
import { OG } from "@/lib/og";
import { figuresImage } from "@/lib/method-og";
import { ownerOf } from "@/lib/promises";

export const alt = "Public Ledger: UK political promises quoted word for word, with where each stands";
export const size = OG.size;
export const contentType = "image/png";

export default async function Image() {
  const cards = getSeed().cards;
  const owners = new Set(cards.map((c) => ownerOf(c).id)).size;
  const costed = cards.filter((c) => c.current.parameters?.how_much_bn_per_year).length;
  return figuresImage({
    kicker: "Promises",
    title: "What UK politicians promised, word for word, and where each stands",
    figures: [
      { value: String(cards.length), label: "promises tracked" },
      { value: String(owners), label: "parties and public bodies" },
      { value: String(costed), label: "with a yearly cost" },
    ],
    foot: "One standard for every party · every status change backed by evidence",
  });
}
