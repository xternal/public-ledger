import { statusCounts } from "@ledger/server/seo";
import { getSeed } from "@/lib/data";
import { OG } from "@/lib/og";
import { figuresImage } from "@/lib/method-og";
import { STATUS_LABEL } from "@/lib/copy";
import { shortName } from "@/lib/promises";

export const alt = "Public Ledger: a party's or politician's tracked promises and how they stand";
export const size = OG.size;
export const contentType = "image/png";

export function generateStaticParams() {
  return getSeed().actors.map((a) => ({ id: a.id }));
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seed = getSeed();
  const actor = seed.actors.find((a) => a.id === id)!;
  // The same cards as the page: a party's page includes its members' cards.
  const cards = seed.cards.filter((c) => c.actor.id === id || (actor.kind === "party" && c.party?.id === id));
  const top = statusCounts(cards)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2);
  return figuresImage({
    kicker: shortName(actor),
    title: `${actor.name}: promises and how they stand`,
    figures: [
      { value: String(cards.length), label: cards.length === 1 ? "promise tracked" : "promises tracked" },
      ...top.map((x) => ({ value: String(x.count), label: STATUS_LABEL[x.status].toLowerCase() })),
    ],
    foot: "Every promise word for word · one standard for every party",
  });
}
