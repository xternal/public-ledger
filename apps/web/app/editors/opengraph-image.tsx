import { getSeed } from "@/lib/data";
import { OG } from "@/lib/og";
import { figuresImage } from "@/lib/method-og";
import { ownerOf } from "@/lib/promises";

export const alt = "Public Ledger: volunteer editors wanted to check UK political promise cards";
export const size = OG.size;
export const contentType = "image/png";

export default async function Image() {
  const cards = getSeed().cards;
  return figuresImage({
    kicker: "Editors",
    title: "Volunteer editors wanted: check UK political promises",
    figures: [
      { value: String(cards.length), label: "promise cards so far" },
      { value: String(new Set(cards.map((c) => ownerOf(c).id)).size), label: "parties and public bodies" },
    ],
    foot: "Remote · no coding · any party or none, declared",
  });
}
